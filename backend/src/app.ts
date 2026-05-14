import cors from 'cors';
import express, { type Request, type Response } from 'express';
import type { EngineApprovalResolution, WorkbenchEngine } from '@claude-oca/runtime';
import { deleteAttachmentFile, ingestAttachments, readMultipartFiles } from './attachments.js';
import { extractImageTextLocal, type ImageOcrResult } from './ocr.js';

function writeSse(res: Response, event: unknown): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function wantsLiveSse(req: Request): boolean {
  const accept = req.headers.accept ?? '';
  return accept.includes('text/event-stream');
}

export function createWorkbenchApp(input: {
  engine: WorkbenchEngine;
  extractImageText?: (imagePath: string) => Promise<ImageOcrResult>;
  jdMcpHealth?: () => Promise<Record<string, unknown>>;
}) {
  const app = express();
  const extractImageText = input.extractImageText ?? extractImageTextLocal;
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));

  app.post('/api/session', (req, res) => {
    const cwd = typeof req.body?.cwd === 'string' ? req.body.cwd : process.cwd();
    const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId : undefined;
    const session = input.engine.createSession({ cwd, sessionId });

    res.status(201).json({
      session,
      snapshot: input.engine.getSnapshot(session.id)
    });
  });

  app.get('/api/sessions', (req, res) => {
    const cwd = typeof req.query.cwd === 'string' && req.query.cwd.trim()
      ? req.query.cwd
      : process.cwd();
    res.json({
      sessions: input.engine.listSessions(cwd)
    });
  });

  app.get('/api/session/:sessionId', (req, res) => {
    res.json({
      snapshot: input.engine.getSnapshot(req.params.sessionId)
    });
  });

  app.delete('/api/session/:sessionId', (req, res) => {
    const cwd = typeof req.query.cwd === 'string' && req.query.cwd.trim()
      ? req.query.cwd
      : process.cwd();
    const deleted = input.engine.deleteSession(req.params.sessionId, cwd);
    if (!deleted) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    res.json({ accepted: true });
  });

  app.get('/api/commands', (_req, res) => {
    res.json({
      commands: input.engine.getCommandCatalog()
    });
  });

  app.get('/api/session/:sessionId/history', (req, res) => {
    res.json({
      history: {
        summaries: input.engine.getHistory(req.params.sessionId)
      }
    });
  });

  app.get('/api/session/:sessionId/diff', (req, res) => {
    res.json({
      workspace: {
        diffs: input.engine.getWorkspaceDiff(req.params.sessionId)
      }
    });
  });

  app.post('/api/session/:sessionId/attachments', async (req, res, next) => {
    try {
      const sessionId = req.params.sessionId;
      const snapshot = input.engine.getSnapshot(sessionId);
      const files = await readMultipartFiles(req);
      const attachments = await ingestAttachments({
        cwd: snapshot.workspace.cwd,
        sessionId,
        files,
        extractImageText
      });
      const registered = attachments.map((attachment) => input.engine.addAttachment(sessionId, attachment));
      input.engine.recordAttachmentUpload(sessionId, registered.map((attachment) => attachment.id));

      res.status(201).json({
        accepted: true,
        attachments: registered,
        snapshot: input.engine.getSnapshot(sessionId)
      });
    } catch (error) {
      next(error);
    }
  });

  app.delete('/api/session/:sessionId/attachments/:attachmentId', async (req, res, next) => {
    try {
      const attachment = input.engine.getAttachment(
        req.params.sessionId,
        req.params.attachmentId
      );
      if (!attachment) {
        res.status(404).json({ error: 'Attachment not found' });
        return;
      }

      await deleteAttachmentFile(attachment);
      input.engine.removeAttachment(req.params.sessionId, req.params.attachmentId);

      res.json({
        accepted: true,
        snapshot: input.engine.getSnapshot(req.params.sessionId)
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/session/:sessionId/attachments/:attachmentId/content', (req, res, next) => {
    try {
      const attachment = input.engine.getAttachment(
        req.params.sessionId,
        req.params.attachmentId
      );
      if (!attachment || attachment.promptVisibility !== 'available') {
        res.status(404).json({ error: 'Attachment not found' });
        return;
      }

      res.type(attachment.mediaType);
      res.sendFile(attachment.localPath);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/session/:sessionId/reports/:reportId/content', (req, res, next) => {
    try {
      const artifact = input.engine.getReportArtifact(req.params.sessionId, req.params.reportId);
      if (!artifact) {
        res.status(404).json({ error: 'Report artifact not found' });
        return;
      }

      res.type('text/html');
      res.sendFile(artifact.filePath);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/session/:sessionId/prompt', async (req, res, next) => {
    try {
      const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt : '';
      const attachmentIds = Array.isArray(req.body?.attachmentIds)
        ? req.body.attachmentIds.filter((value: unknown): value is string => typeof value === 'string')
        : [];
      const jdMcpToolName =
        typeof req.body?.jdMcpToolName === 'string' && req.body.jdMcpToolName.trim()
          ? req.body.jdMcpToolName.trim()
          : undefined;
      if (!prompt.trim()) {
        res.status(400).json({ error: 'prompt is required' });
        return;
      }

      await input.engine.submitPrompt(req.params.sessionId, prompt, { attachmentIds, jdMcpToolName });
      res.status(202).json({
        accepted: true,
        snapshot: input.engine.getSnapshot(req.params.sessionId)
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/session/:sessionId/stream', (req, res, next) => {
    try {
      const sessionId = req.params.sessionId;
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      if (!wantsLiveSse(req)) {
        const history = input.engine.getEventHistory(sessionId);
        for (const event of history) {
          writeSse(res, event);
        }
        res.end();
        return;
      }

      const unsubscribe = input.engine.subscribe(sessionId, (event) => {
        writeSse(res, event);
      });

      req.on('close', () => {
        unsubscribe();
        res.end();
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/session/:sessionId/approvals/:requestId', async (req, res, next) => {
    try {
      const body = req.body as EngineApprovalResolution;
      await input.engine.resolveApproval(req.params.sessionId, req.params.requestId, body);
      res.status(202).json({
        accepted: true,
        snapshot: input.engine.getSnapshot(req.params.sessionId)
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/health/oca', async (_req, res, next) => {
    try {
      const health = await input.engine.healthCheck();
      res.status(health.ok ? 200 : 503).json(health);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/health/jd-mcp', async (_req, res, next) => {
    try {
      if (!input.jdMcpHealth) {
        res.status(503).json({
          ok: false,
          provider: 'jd-mcp',
          status: 'unavailable',
          error: 'jd-mcp bridge not configured'
        });
        return;
      }

      const health = await input.jdMcpHealth();
      const ok = health.ok !== false;
      res.status(ok ? 200 : 503).json(health);
    } catch (error) {
      next(error);
    }
  });

  app.use((error: unknown, _req: Request, res: Response, _next: express.NextFunction) => {
    const message = error instanceof Error ? error.message : String(error);
    const statusCode =
      message.includes('Unsupported attachment type') ||
      message.includes('At least one attachment') ||
      message.includes('ZIP')
        ? 400
        : 500;
    res.status(statusCode).json({ error: message });
  });

  return app;
}
