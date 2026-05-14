import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEngine } from '@claude-oca/runtime';
import type {
  EngineModelEvent,
  EngineModelMessage,
  EngineModelProvider,
  EngineToolExecutionResult
} from '@claude-oca/runtime';
import { createWorkbenchApp } from '../src/app.js';

const PNG_IMAGE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2pX8sAAAAASUVORK5CYII=',
  'base64'
);

describe('createWorkbenchApp', () => {
  beforeEach(() => {
    vi.stubEnv('SUPPORT_WORKBENCH_SESSION_MODE', 'isolated');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('creates a session and streams session events over SSE', async () => {
    const provider: EngineModelProvider = {
      async healthCheck() {
        return { ok: true, provider: 'fake', model: 'fake-model' };
      },
      async *sendTurn() {
        yield {
          type: 'assistant_delta',
          text: 'streamed text'
        } satisfies EngineModelEvent;
        yield {
          type: 'assistant_done'
        } satisfies EngineModelEvent;
      },
      async cancelTurn() {}
    };

    const engine = createEngine({
      provider,
      executeTool: vi.fn<(...args: never[]) => Promise<EngineToolExecutionResult>>()
    });
    const app = createWorkbenchApp({ engine });
    const client = request.agent(app);
    const sessionResponse = await client.post('/api/session').send({ cwd: process.cwd() });
    expect(sessionResponse.status).toBe(201);

    const sessionId = sessionResponse.body.session.id as string;
    const sseResponse = await client.get(`/api/session/${sessionId}/stream`).buffer(true);
    expect(sseResponse.status).toBe(200);
    expect(sseResponse.text).toContain('session.created');

    const promptResponse = await client
      .post(`/api/session/${sessionId}/prompt`)
      .send({ prompt: 'hello' });

    expect(promptResponse.status).toBe(202);
    expect(promptResponse.body.accepted).toBe(true);
  });

  it('resolves a pending approval through the API', async () => {
    const executeTool = vi.fn(async () => ({
      summary: 'README written',
      metadata: { path: 'README.md' }
    }));
    let sendTurnCount = 0;
    const provider: EngineModelProvider = {
      async healthCheck() {
        return { ok: true, provider: 'fake', model: 'fake-model' };
      },
      async *sendTurn() {
        sendTurnCount += 1;
        if (sendTurnCount === 1) {
          yield {
            type: 'tool_call',
            toolName: 'Write',
            input: { file_path: 'README.md', content: 'hi' }
          } satisfies EngineModelEvent;
          return;
        }

        yield {
          type: 'assistant_delta',
          text: 'README updated.'
        } satisfies EngineModelEvent;
        yield {
          type: 'assistant_done'
        } satisfies EngineModelEvent;
      },
      async cancelTurn() {}
    };
    const engine = createEngine({ provider, executeTool });
    const app = createWorkbenchApp({ engine });
    const client = request.agent(app);

    const sessionResponse = await client.post('/api/session').send({ cwd: process.cwd() });
    const sessionId = sessionResponse.body.session.id as string;
    await client.post(`/api/session/${sessionId}/prompt`).send({ prompt: 'edit the file' });

    const approval = engine.getPendingApprovals(sessionId)[0];
    expect(approval).toBeDefined();

    const approvalResponse = await client
      .post(`/api/session/${sessionId}/approvals/${approval!.requestId}`)
      .send({ decision: 'allow' });

    expect(approvalResponse.status).toBe(202);
    expect(executeTool).toHaveBeenCalledTimes(1);
  });

  it('reports OCA health from the engine provider', async () => {
    const provider: EngineModelProvider = {
      async healthCheck() {
        return { ok: true, provider: 'oracle-code-assist', model: 'oca/gpt-5.4' };
      },
      async *sendTurn() {
        return;
      },
      async cancelTurn() {}
    };
    const engine = createEngine({
      provider,
      executeTool: vi.fn<(...args: never[]) => Promise<EngineToolExecutionResult>>()
    });
    const app = createWorkbenchApp({ engine });

    const healthResponse = await request(app).get('/api/health/oca');

    expect(healthResponse.status).toBe(200);
    expect(healthResponse.body).toMatchObject({
      ok: true,
      provider: 'oracle-code-assist',
      model: 'oca/gpt-5.4'
    });
  });

  it('exposes command catalog and session history endpoints', async () => {
    const provider: EngineModelProvider = {
      async healthCheck() {
        return { ok: true, provider: 'fake', model: 'fake-model' };
      },
      async *sendTurn() {
        yield {
          type: 'assistant_delta',
          text: 'normal turn'
        } satisfies EngineModelEvent;
        yield {
          type: 'assistant_done'
        } satisfies EngineModelEvent;
      },
      async cancelTurn() {}
    };

    const engine = createEngine({ provider });
    const app = createWorkbenchApp({ engine });
    const client = request.agent(app);

    const sessionResponse = await client.post('/api/session').send({ cwd: process.cwd() });
    const sessionId = sessionResponse.body.session.id as string;

    const commandsResponse = await request(app).get('/api/commands');
    expect(commandsResponse.status).toBe(200);
    expect(commandsResponse.body.commands).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: '/tasks' })])
    );

    await client.post(`/api/session/${sessionId}/prompt`).send({ prompt: 'hello' });
    await client.post(`/api/session/${sessionId}/prompt`).send({ prompt: '/compact' });

    const historyResponse = await client.get(`/api/session/${sessionId}/history`);
    expect(historyResponse.status).toBe(200);
    expect(historyResponse.body.history.summaries).toHaveLength(1);

    const sessionsResponse = await client.get('/api/sessions').query({ cwd: process.cwd() });
    expect(sessionsResponse.status).toBe(200);
    expect(sessionsResponse.body.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: sessionId,
          title: 'hello',
          messageCount: expect.any(Number)
        })
      ])
    );
  });

  it('deletes persisted sessions through the session API and reports unknown sessions as 404', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'claude-oca-backend-delete-'));
    const provider: EngineModelProvider = {
      async healthCheck() {
        return { ok: true, provider: 'fake', model: 'fake-model' };
      },
      async *sendTurn() {
        yield {
          type: 'assistant_delta',
          text: 'normal turn'
        } satisfies EngineModelEvent;
        yield {
          type: 'assistant_done'
        } satisfies EngineModelEvent;
      },
      async cancelTurn() {}
    };

    const engine = createEngine({ provider });
    const app = createWorkbenchApp({ engine });
    const client = request.agent(app);

    const sessionResponse = await client.post('/api/session').send({ cwd });
    const sessionId = sessionResponse.body.session.id as string;
    await client.post(`/api/session/${sessionId}/prompt`).send({ prompt: 'hello' });

    const deleteResponse = await client.delete(`/api/session/${sessionId}`).query({ cwd });
    expect(deleteResponse.status).toBe(200);
    expect(deleteResponse.body).toEqual({ accepted: true });

    const sessionsResponse = await client.get('/api/sessions').query({ cwd });
    expect(sessionsResponse.body.sessions).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: sessionId })])
    );

    const unknownResponse = await client.delete('/api/session/missing-session').query({ cwd });
    expect(unknownResponse.status).toBe(404);
  });

  it('rejects unsafe client-supplied session ids before persistence access', async () => {
    const engine = createEngine({
      provider: {
        async healthCheck() {
          return { ok: true, provider: 'fake', model: 'fake-model' };
        },
        async *sendTurn() {
          return;
        },
        async cancelTurn() {}
      }
    });
    const app = createWorkbenchApp({ engine });
    const client = request.agent(app);

    const response = await client.post('/api/session').send({
      cwd: process.cwd(),
      sessionId: '../outside-workspace'
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Invalid session id');
  });

  it('isolates session list, read, prompt, stream, attachment, and delete APIs by browser owner', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'claude-oca-browser-isolation-'));
    const app = createWorkbenchApp({
      engine: createEngine({
        provider: {
          async healthCheck() {
            return { ok: true, provider: 'fake', model: 'fake-model' };
          },
          async *sendTurn() {
            yield {
              type: 'assistant_delta',
              text: 'private answer'
            } satisfies EngineModelEvent;
            yield {
              type: 'assistant_done'
            } satisfies EngineModelEvent;
          },
          async cancelTurn() {}
        }
      })
    });
    const ownerA = request.agent(app);
    const ownerB = request.agent(app);

    const sessionResponse = await ownerA.post('/api/session').send({ cwd });
    expect(sessionResponse.status).toBe(201);
    const sessionId = sessionResponse.body.session.id as string;

    await ownerA.post(`/api/session/${sessionId}/prompt`).send({ prompt: 'owner A private prompt' });
    const uploadResponse = await ownerA
      .post(`/api/session/${sessionId}/attachments`)
      .attach('files', Buffer.from('SECRET=owner-a'), {
        filename: 'private.env',
        contentType: 'text/plain'
      });
    expect(uploadResponse.status).toBe(201);
    const attachmentId = uploadResponse.body.attachments[0].id as string;

    const ownerAList = await ownerA.get('/api/sessions').query({ cwd });
    expect(ownerAList.body.sessions.map((session: { id: string }) => session.id)).toContain(sessionId);

    const ownerBList = await ownerB.get('/api/sessions').query({ cwd });
    expect(ownerBList.status).toBe(200);
    expect(ownerBList.body.sessions).toEqual([]);

    await expect(ownerB.get(`/api/session/${sessionId}`)).resolves.toMatchObject({ status: 404 });
    await expect(ownerB.get(`/api/session/${sessionId}/history`)).resolves.toMatchObject({ status: 404 });
    await expect(ownerB.get(`/api/session/${sessionId}/diff`)).resolves.toMatchObject({ status: 404 });
    await expect(ownerB.get(`/api/session/${sessionId}/stream`).buffer(true)).resolves.toMatchObject({ status: 404 });
    await expect(ownerB.post(`/api/session/${sessionId}/prompt`).send({ prompt: 'cross-user prompt' })).resolves.toMatchObject({ status: 404 });
    await expect(ownerB.get(`/api/session/${sessionId}/attachments/${attachmentId}/content`)).resolves.toMatchObject({ status: 404 });
    await expect(ownerB.delete(`/api/session/${sessionId}/attachments/${attachmentId}`)).resolves.toMatchObject({ status: 404 });
    await expect(ownerB.delete(`/api/session/${sessionId}`).query({ cwd })).resolves.toMatchObject({ status: 404 });

    const ownerAContent = await ownerA.get(`/api/session/${sessionId}/attachments/${attachmentId}/content`);
    expect(ownerAContent.status).toBe(200);
    expect(ownerAContent.text).toContain('SECRET=owner-a');
  });

  it('uploads attachments into a session and includes selected attachment ids in a prompt turn', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'claude-oca-backend-'));
    const capturedTurns: EngineModelMessage[][] = [];
    const provider: EngineModelProvider = {
      async healthCheck() {
        return { ok: true, provider: 'fake', model: 'fake-model' };
      },
      async *sendTurn(messages) {
        capturedTurns.push([...messages]);
        yield {
          type: 'assistant_delta',
          text: 'I checked the uploaded files.'
        } satisfies EngineModelEvent;
        yield {
          type: 'assistant_done'
        } satisfies EngineModelEvent;
      },
      async cancelTurn() {}
    };

    const engine = createEngine({ provider });
    const app = createWorkbenchApp({
      engine,
      extractImageText: vi.fn(async () => ({
        status: 'completed',
        text: 'HTTP 500 on localhost:4317'
      }))
    });
    const client = request.agent(app);

    const sessionResponse = await client.post('/api/session').send({ cwd });
    const sessionId = sessionResponse.body.session.id as string;

    const uploadResponse = await client
      .post(`/api/session/${sessionId}/attachments`)
      .attach('files', Buffer.from('PORT=4317'), {
        filename: 'runtime.env',
        contentType: 'text/plain'
      })
      .attach('files', PNG_IMAGE, {
        filename: 'error.png',
        contentType: 'image/png'
      });

    expect(uploadResponse.status).toBe(201);
    expect(uploadResponse.body.attachments).toHaveLength(2);
    expect(uploadResponse.body.snapshot.attachments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ originalName: 'runtime.env', kind: 'text' }),
        expect.objectContaining({
          originalName: 'error.png',
          kind: 'image',
          ocrStatus: 'completed',
          extractedText: 'HTTP 500 on localhost:4317'
        })
      ])
    );

    const attachmentIds = uploadResponse.body.attachments.map((attachment: { id: string }) => attachment.id);
    const promptResponse = await client
      .post(`/api/session/${sessionId}/prompt`)
      .send({ prompt: 'inspect the attachments', attachmentIds });

    expect(promptResponse.status).toBe(202);
    const userTurn = capturedTurns[0]?.at(-1);
    expect(userTurn?.content).toContain('runtime.env');
    expect(userTurn?.content).toContain('HTTP 500 on localhost:4317');
  });

  it('keeps image uploads when OCR processing throws and records the OCR error', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'claude-oca-backend-ocr-failure-'));
    const engine = createEngine({
      provider: {
        async healthCheck() {
          return { ok: true, provider: 'fake', model: 'fake-model' };
        },
        async *sendTurn() {
          return;
        },
        async cancelTurn() {}
      }
    });
    const app = createWorkbenchApp({
      engine,
      extractImageText: vi.fn(async () => {
        throw new Error('Windows OCR engine unavailable.');
      })
    });
    const client = request.agent(app);

    const sessionResponse = await client.post('/api/session').send({ cwd });
    const sessionId = sessionResponse.body.session.id as string;

    const uploadResponse = await client
      .post(`/api/session/${sessionId}/attachments`)
      .attach('files', PNG_IMAGE, {
        filename: 'error.png',
        contentType: 'image/png'
      });

    expect(uploadResponse.status).toBe(201);
    expect(uploadResponse.body.attachments).toEqual([
      expect.objectContaining({
        originalName: 'error.png',
        kind: 'image',
        ocrStatus: 'failed',
        ocrError: 'Windows OCR engine unavailable.'
      })
    ]);
    expect(uploadResponse.body.snapshot.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'attachment',
          content: 'Uploaded 1 file',
          attachmentIds: [uploadResponse.body.attachments[0].id]
        })
      ])
    );
  });

  it('rejects unsupported attachment types', async () => {
    const engine = createEngine({
      provider: {
        async healthCheck() {
          return { ok: true, provider: 'fake', model: 'fake-model' };
        },
        async *sendTurn() {
          return;
        },
        async cancelTurn() {}
      }
    });
    const app = createWorkbenchApp({ engine });
    const client = request.agent(app);

    const sessionResponse = await client.post('/api/session').send({ cwd: process.cwd() });
    const sessionId = sessionResponse.body.session.id as string;

    const uploadResponse = await client
      .post(`/api/session/${sessionId}/attachments`)
      .attach('files', Buffer.from([0xde, 0xad, 0xbe, 0xef]), {
        filename: 'payload.exe',
        contentType: 'application/octet-stream'
      });

    expect(uploadResponse.status).toBe(400);
    expect(uploadResponse.body.error).toContain('Unsupported attachment type');
  });

  it('extracts supported files from ZIP uploads and records an upload card', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'claude-oca-zip-backend-'));
    const engine = createEngine({
      provider: {
        async healthCheck() {
          return { ok: true, provider: 'fake', model: 'fake-model' };
        },
        async *sendTurn() {
          return;
        },
        async cancelTurn() {}
      }
    });
    const app = createWorkbenchApp({ engine });
    const client = request.agent(app);

    const sessionResponse = await client.post('/api/session').send({ cwd });
    const sessionId = sessionResponse.body.session.id as string;
    const zip = createStoredZip([
      { name: 'logs/server.log', data: Buffer.from('ADF_FACES-30130') },
      { name: '../escape.log', data: Buffer.from('unsafe') },
      { name: 'binary/payload.bin', data: Buffer.from([0xde, 0xad]) }
    ]);

    const uploadResponse = await client
      .post(`/api/session/${sessionId}/attachments`)
      .attach('files', zip, {
        filename: 'diagnostic.zip',
        contentType: 'application/zip'
      });

    expect(uploadResponse.status).toBe(201);
    expect(uploadResponse.body.attachments).toHaveLength(1);
    expect(uploadResponse.body.attachments[0]).toMatchObject({
      originalName: 'server.log',
      kind: 'text',
      sourceArchive: {
        name: 'diagnostic.zip',
        relativePath: 'logs/server.log'
      }
    });
    expect(uploadResponse.body.snapshot.attachments).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ originalName: 'diagnostic.zip' })])
    );
    expect(uploadResponse.body.snapshot.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'attachment',
          content: 'Uploaded 1 file from diagnostic.zip',
          attachmentIds: [uploadResponse.body.attachments[0].id]
        })
      ])
    );
  });

  it('rejects ZIP uploads with no supported files', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'claude-oca-empty-zip-backend-'));
    const engine = createEngine({
      provider: {
        async healthCheck() {
          return { ok: true, provider: 'fake', model: 'fake-model' };
        },
        async *sendTurn() {
          return;
        },
        async cancelTurn() {}
      }
    });
    const app = createWorkbenchApp({ engine });
    const client = request.agent(app);

    const sessionResponse = await client.post('/api/session').send({ cwd });
    const sessionId = sessionResponse.body.session.id as string;
    const uploadResponse = await client
      .post(`/api/session/${sessionId}/attachments`)
      .attach('files', createStoredZip([{ name: 'payload.bin', data: Buffer.from([1, 2, 3]) }]), {
        filename: 'unsupported.zip',
        contentType: 'application/zip'
      });

    expect(uploadResponse.status).toBe(400);
    expect(uploadResponse.body.error).toContain('no supported files');
  });

  it('serves jd-mcp HTML report artifacts and exposes jd-mcp health state', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'claude-oca-jdmcp-backend-'));
    const reportDir = join(cwd, 'reports');
    const reportPath = join(reportDir, 'adflr-report.html');
    mkdirSync(reportDir, { recursive: true });
    writeFileSync(reportPath, '<html><body>ADF report</body></html>');

    let sendTurnCount = 0;
    const provider: EngineModelProvider = {
      async healthCheck() {
        return { ok: true, provider: 'oracle-code-assist', model: 'oca/gpt-5.4' };
      },
      async *sendTurn() {
        sendTurnCount += 1;
        if (sendTurnCount === 1) {
          yield {
            type: 'tool_call',
            toolName: 'analyze_adf_logs',
            input: { log_folder: cwd }
          } satisfies EngineModelEvent;
          return;
        }

        yield {
          type: 'assistant_delta',
          text: 'Generated the jd-mcp report.'
        } satisfies EngineModelEvent;
        yield {
          type: 'assistant_done'
        } satisfies EngineModelEvent;
      },
      async cancelTurn() {}
    };

    const executeTool = vi.fn(async () => ({
      summary: 'Generated 1 jd-mcp HTML report',
      source: 'jd-mcp',
      artifacts: [
        {
          id: 'report-1',
          requestId: 'req-jd-1',
          sessionId: 'pending',
          toolName: 'analyze_adf_logs',
          source: 'jd-mcp',
          kind: 'html-report',
          title: 'ADF Log Review',
          filePath: reportPath,
          fileName: 'adflr-report.html',
          createdAt: '2026-04-24T00:00:00.000Z',
          size: 36
        }
      ]
    }));

    const engine = (createEngine as unknown as (input: Record<string, unknown>) => ReturnType<typeof createEngine>)({
      provider,
      executeTool,
      toolCatalog: [
        {
          name: 'analyze_adf_logs',
          description: 'Analyze ADF logs through jd-mcp.',
          source: 'jd-mcp',
          requiresApproval: true,
          producesReports: true
        }
      ],
      getIntegrationSnapshot: () => ({
        skills: [],
        mcp: {
          available: false,
          servers: [],
          note: 'Not configured'
        },
        lsp: {
          available: false,
          note: 'Not configured'
        },
        jdMcp: {
          available: true,
          connected: true,
          note: 'Connected to jd-mcp',
          tools: ['analyze_adf_logs'],
          categories: ['reports'],
          toolDescriptors: [
            {
              name: 'analyze_adf_logs',
              description: 'Analyze ADF logs through jd-mcp.',
              source: 'jd-mcp',
              requiresApproval: true,
              producesReports: true,
              enabled: true,
              visibility: 'enabled',
              stability: 'stable'
            }
          ]
        }
      })
    });
    const app = (createWorkbenchApp as unknown as (input: Record<string, unknown>) => ReturnType<typeof createWorkbenchApp>)({
      engine,
      jdMcpHealth: async () => ({
        ok: true,
        provider: 'jd-mcp',
        model: null,
        status: 'connected'
      })
    });
    const client = request.agent(app);

    const sessionResponse = await client.post('/api/session').send({ cwd });
    const sessionId = sessionResponse.body.session.id as string;
    await client.post(`/api/session/${sessionId}/prompt`).send({ prompt: 'analyze logs' });

    const approval = engine.getPendingApprovals(sessionId)[0];
    await client
      .post(`/api/session/${sessionId}/approvals/${approval!.requestId}`)
      .send({ decision: 'allow' });

    const snapshotResponse = await client.get(`/api/session/${sessionId}`);
    const reportId = snapshotResponse.body.snapshot.reports?.artifacts?.[0]?.id;

    expect(reportId).toBe('report-1');

    const reportResponse = await client.get(
      `/api/session/${sessionId}/reports/${reportId}/content`
    );
    expect(reportResponse.status).toBe(200);
    expect(reportResponse.text).toContain('ADF report');

    const healthResponse = await request(app).get('/api/health/jd-mcp');
    expect(healthResponse.status).toBe(200);
    expect(healthResponse.body).toMatchObject({
      ok: true,
      provider: 'jd-mcp',
      status: 'connected'
    });
    expect(snapshotResponse.body.snapshot.reports.artifacts[0]).toMatchObject({
      requestId: approval!.requestId
    });
  });

  it('isolates report artifact content by browser owner', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'claude-oca-report-isolation-'));
    const reportDir = join(cwd, 'reports');
    const reportPath = join(reportDir, 'private-report.html');
    mkdirSync(reportDir, { recursive: true });
    writeFileSync(reportPath, '<html><body>Owner A report</body></html>');

    let sendTurnCount = 0;
    const provider: EngineModelProvider = {
      async healthCheck() {
        return { ok: true, provider: 'oracle-code-assist', model: 'oca/gpt-5.4' };
      },
      async *sendTurn() {
        sendTurnCount += 1;
        if (sendTurnCount === 1) {
          yield {
            type: 'tool_call',
            toolName: 'analyze_private_logs',
            input: { log_folder: cwd }
          } satisfies EngineModelEvent;
          return;
        }

        yield {
          type: 'assistant_delta',
          text: 'Generated the private report.'
        } satisfies EngineModelEvent;
        yield {
          type: 'assistant_done'
        } satisfies EngineModelEvent;
      },
      async cancelTurn() {}
    };
    const engine = createEngine({
      provider,
      executeTool: vi.fn(async () => ({
        summary: 'Generated 1 private HTML report',
        source: 'jd-mcp',
        artifacts: [
          {
            id: 'private-report',
            sessionId: 'pending',
            toolName: 'analyze_private_logs',
            source: 'jd-mcp',
            kind: 'html-report',
            title: 'Private Report',
            filePath: reportPath,
            fileName: 'private-report.html',
            createdAt: '2026-05-14T00:00:00.000Z',
            size: 40
          }
        ]
      })),
      toolCatalog: [
        {
          name: 'analyze_private_logs',
          description: 'Analyze private logs.',
          source: 'jd-mcp',
          requiresApproval: true,
          producesReports: true
        }
      ]
    });
    const app = createWorkbenchApp({ engine });
    const ownerA = request.agent(app);
    const ownerB = request.agent(app);

    const sessionResponse = await ownerA.post('/api/session').send({ cwd });
    const sessionId = sessionResponse.body.session.id as string;
    await ownerA.post(`/api/session/${sessionId}/prompt`).send({ prompt: 'make report' });

    const approval = engine.getPendingApprovals(sessionId)[0];
    await ownerA
      .post(`/api/session/${sessionId}/approvals/${approval!.requestId}`)
      .send({ decision: 'allow' });

    const ownerAReport = await ownerA.get(`/api/session/${sessionId}/reports/private-report/content`);
    expect(ownerAReport.status).toBe(200);
    expect(ownerAReport.text).toContain('Owner A report');

    const ownerBReport = await ownerB.get(`/api/session/${sessionId}/reports/private-report/content`);
    expect(ownerBReport.status).toBe(404);
  });
});

function createStoredZip(files: Array<{ name: string; data: Buffer }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(file.data.byteLength, 18);
    local.writeUInt32LE(file.data.byteLength, 22);
    local.writeUInt16LE(name.byteLength, 26);
    localParts.push(local, name, file.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(file.data.byteLength, 20);
    central.writeUInt32LE(file.data.byteLength, 24);
    central.writeUInt16LE(name.byteLength, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);

    offset += local.byteLength + name.byteLength + file.data.byteLength;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDirectory.byteLength, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...localParts, centralDirectory, eocd]);
}
