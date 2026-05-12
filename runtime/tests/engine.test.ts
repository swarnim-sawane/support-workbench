import { describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEngine } from '../src/index.js';
import { buildLeakedRuntimeSystemPrompt } from '../src/leakedRuntimePrompt.js';
import type {
  EngineEvent,
  EngineModelEvent,
  EngineModelProvider,
  EngineToolExecutionResult
} from '../src/types.js';

function collectEvents() {
  const events: EngineEvent[] = [];
  return {
    events,
    push(event: EngineEvent) {
      events.push(event);
    }
  };
}

describe('createEngine', () => {
  it('assembles a leaked-style system prompt with dedicated tool guidance', () => {
    const prompt = buildLeakedRuntimeSystemPrompt();

    expect(prompt).toContain('# System');
    expect(prompt).toContain('# Doing tasks');
    expect(prompt).toContain('# Executing actions with care');
    expect(prompt).toContain('# Using your tools');
    expect(prompt).toContain('To read files use Read instead of cat, head, tail, or sed');
    expect(prompt).toContain('To edit files use Edit instead of sed or awk');
    expect(prompt).toContain('To create files use Write instead of cat with heredoc or echo redirection');
    expect(prompt).toContain('To search for files use Glob instead of find or ls');
    expect(prompt).toContain('To search the content of files, use Grep instead of grep or rg');
    expect(prompt).toContain('Reserve using the Bash exclusively for system commands');
    expect(prompt).not.toContain('"tool":"read_file|write_file|shell_command"');
  });

  it('includes expanded jd-mcp tools in the model tool reference when enabled', () => {
    const prompt = buildLeakedRuntimeSystemPrompt([
      {
        name: 'Read',
        description: 'Read a file from the local filesystem.',
        source: 'builtin',
        requiresApproval: false
      },
      {
        name: 'analyze_har_file',
        description: 'Analyze a HAR file through jd-mcp.',
        source: 'jd-mcp',
        requiresApproval: true,
        category: 'diagnostics',
        producesReports: false,
        enabled: true,
        visibility: 'enabled',
        stability: 'stable'
      },
      {
        name: 'list_directory',
        description: 'List a diagnostic directory through jd-mcp.',
        source: 'jd-mcp',
        requiresApproval: true,
        category: 'helpers',
        producesReports: false,
        enabled: true,
        visibility: 'enabled',
        stability: 'stable'
      }
    ]);

    expect(prompt).toContain('analyze_har_file(input): Analyze a HAR file through jd-mcp.');
    expect(prompt).toContain('list_directory(input): List a diagnostic directory through jd-mcp.');
  });

  it('streams an assistant turn from the provider through the engine session', async () => {
    const provider: EngineModelProvider = {
      async healthCheck() {
        return { ok: true, provider: 'fake', model: 'fake-model' };
      },
      async *sendTurn() {
        yield {
          type: 'assistant_delta',
          text: 'Hello from OCA'
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
    const session = engine.createSession({ cwd: process.cwd() });
    const log = collectEvents();
    const unsubscribe = engine.subscribe(session.id, log.push);

    await engine.submitPrompt(session.id, 'Say hello');

    unsubscribe();

    expect(log.events.map((event) => event.type)).toEqual([
      'session.created',
      'turn.started',
      'message.user',
      'message.assistant.delta',
      'message.assistant.done',
      'turn.completed'
    ]);
    expect(log.events.at(-1)).toMatchObject({
      type: 'turn.completed',
      status: 'completed'
    });
  });

  it('emits a permission request and pauses before a mutating tool executes', async () => {
    const executeTool = vi.fn(async () => ({
      summary: 'README.md updated',
      metadata: {
        path: 'README.md'
      }
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
            type: 'assistant_delta',
            text: 'I can update the README for you.'
          } satisfies EngineModelEvent;
          yield {
            type: 'tool_call',
            toolName: 'Write',
            input: {
              file_path: 'README.md',
              content: '# Updated'
            },
            reasoning: 'Need to update the documentation.'
          } satisfies EngineModelEvent;
          return;
        }

        yield {
          type: 'assistant_delta',
          text: 'The README has been updated.'
        } satisfies EngineModelEvent;
        yield {
          type: 'assistant_done'
        } satisfies EngineModelEvent;
      },
      async cancelTurn() {}
    };

    const engine = createEngine({
      provider,
      executeTool
    });
    const session = engine.createSession({ cwd: process.cwd() });
    const log = collectEvents();
    engine.subscribe(session.id, log.push);

    await engine.submitPrompt(session.id, 'Update the README');

    expect(executeTool).not.toHaveBeenCalled();
    expect(log.events.map((event) => event.type)).toEqual([
      'session.created',
      'turn.started',
      'message.user',
      'message.assistant.delta',
      'message.assistant.done',
      'permission.requested'
    ]);
    expect(log.events.at(-1)).toMatchObject({
      type: 'permission.requested',
      toolName: 'Write',
      toolUseId: expect.any(String),
      input: {
        file_path: 'README.md',
        content: '# Updated'
      }
    });

    const pending = engine.getPendingApprovals(session.id);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      toolName: 'Write',
      toolUseId: expect.any(String)
    });

    await engine.resolveApproval(session.id, pending[0]!.requestId, {
      decision: 'allow'
    });

    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(log.events.map((event) => event.type)).toContain('tool.execution.started');
    expect(log.events.map((event) => event.type)).toContain('tool.execution.completed');
    expect(log.events.at(-2)).toMatchObject({
      type: 'message.assistant.done',
      message: {
        content: 'The README has been updated.'
      }
    });
    expect(log.events.at(-1)).toMatchObject({
      type: 'turn.completed',
      status: 'completed'
    });
    expect(engine.getSnapshot(session.id).toolActivity).toEqual([
      expect.objectContaining({
        requestId: pending[0]!.requestId,
        toolName: 'Write',
        status: 'completed'
      })
    ]);
  });

  it('keeps session state valid when a tool approval is denied', async () => {
    const executeTool = vi.fn(async () => ({
      summary: 'should not run'
    }));

    const provider: EngineModelProvider = {
      async healthCheck() {
        return { ok: true, provider: 'fake', model: 'fake-model' };
      },
      async *sendTurn() {
        yield {
          type: 'tool_call',
          toolName: 'PowerShell',
          input: {
            command: 'Remove-Item README.md -Confirm:$false'
          }
        } satisfies EngineModelEvent;
      },
      async cancelTurn() {}
    };

    const engine = createEngine({
      provider,
      executeTool
    });
    const session = engine.createSession({ cwd: process.cwd() });
    const log = collectEvents();
    engine.subscribe(session.id, log.push);

    await engine.submitPrompt(session.id, 'Delete the README');

    const pending = engine.getPendingApprovals(session.id);
    await engine.resolveApproval(session.id, pending[0]!.requestId, {
      decision: 'deny',
      reason: 'Not allowed'
    });

    expect(executeTool).not.toHaveBeenCalled();
    expect(log.events.map((event) => event.type)).toContain('tool.denied');
    expect(log.events.at(-1)).toMatchObject({
      type: 'turn.completed',
      status: 'blocked'
    });
    expect(engine.getPendingApprovals(session.id)).toHaveLength(0);
    expect(engine.getSnapshot(session.id).toolActivity).toEqual([
      expect.objectContaining({
        requestId: pending[0]!.requestId,
        toolName: 'PowerShell',
        status: 'denied'
      })
    ]);
  });

  it('handles local slash commands for tasks and memory without hitting the provider', async () => {
    const provider: EngineModelProvider = {
      healthCheck: vi.fn(async () => ({ ok: true, provider: 'fake', model: 'fake-model' })),
      sendTurn: vi.fn(async function* () {
        return;
      }),
      cancelTurn: vi.fn(async () => {})
    };

    const engine = createEngine({
      provider,
      executeTool: vi.fn<(...args: never[]) => Promise<EngineToolExecutionResult>>()
    });
    const session = engine.createSession({ cwd: process.cwd() });
    const log = collectEvents();
    engine.subscribe(session.id, log.push);

    await engine.submitPrompt(session.id, '/tasks add Map parity gaps');
    await engine.submitPrompt(session.id, '/memory remember Prefer dedicated tools before shell');

    expect(provider.sendTurn).not.toHaveBeenCalled();
    expect(log.events.map((event) => event.type)).toContain('task.updated');
    expect(log.events.map((event) => event.type)).toContain('memory.updated');

    const snapshot = engine.getSnapshot(session.id);
    expect(snapshot.tasks).toEqual([
      expect.objectContaining({
        content: 'Map parity gaps',
        status: 'pending'
      })
    ]);
    expect(snapshot.memory.entries).toEqual([
      expect.objectContaining({
        content: 'Prefer dedicated tools before shell'
      })
    ]);
  });

  it('injects runtime capability context into model turns for grounded capability answers', async () => {
    const capturedPrompts: string[] = [];
    const provider: EngineModelProvider = {
      async healthCheck() {
        return { ok: true, provider: 'fake', model: 'fake-model' };
      },
      async *sendTurn(_messages, options) {
        capturedPrompts.push(options.systemPrompt);
        yield {
          type: 'assistant_delta',
          text: 'I can use /commands, Read, Write, and I need approval for mutating tools.'
        } satisfies EngineModelEvent;
        yield {
          type: 'assistant_done'
        } satisfies EngineModelEvent;
      },
      async cancelTurn() {}
    };

    const engine = createEngine({ provider });
    const session = engine.createSession({ cwd: process.cwd() });

    await engine.submitPrompt(session.id, '/tasks add Audit runtime capabilities');
    await engine.submitPrompt(session.id, '/memory remember Mutating tools require approval');
    await engine.submitPrompt(session.id, 'what can you do autonomously');

    expect(capturedPrompts).toHaveLength(1);
    expect(capturedPrompts[0]).toContain('# Runtime capability context');
    expect(capturedPrompts[0]).toContain('/commands');
    expect(capturedPrompts[0]).toContain('Read, Write, Edit, Glob, Grep');
    expect(capturedPrompts[0]).toContain('Mutating tools require explicit approval');
    expect(capturedPrompts[0]).toContain('Audit runtime capabilities');
  });

  it('rejects unknown slash commands locally and suggests nearby valid commands', async () => {
    const provider: EngineModelProvider = {
      healthCheck: vi.fn(async () => ({ ok: true, provider: 'fake', model: 'fake-model' })),
      sendTurn: vi.fn(async function* () {
        return;
      }),
      cancelTurn: vi.fn(async () => {})
    };

    const engine = createEngine({ provider });
    const session = engine.createSession({ cwd: process.cwd() });
    const log = collectEvents();
    engine.subscribe(session.id, log.push);

    await engine.submitPrompt(session.id, '/commads');

    expect(provider.sendTurn).not.toHaveBeenCalled();
    expect(log.events.map((event) => event.type)).toContain('command.error');
    expect(log.events.at(-2)).toMatchObject({
      type: 'command.error',
      commandName: '/commads',
      suggestions: ['/commands']
    });
    expect(log.events.at(-1)).toMatchObject({
      type: 'turn.completed',
      status: 'completed'
    });
    expect(engine.getSnapshot(session.id).messages.at(-1)?.content).toContain('/commands');
  });

  it('reports the last stable session status inside /session output', async () => {
    const provider: EngineModelProvider = {
      async healthCheck() {
        return { ok: true, provider: 'fake', model: 'fake-model' };
      },
      async *sendTurn() {
        yield {
          type: 'assistant_delta',
          text: 'Finished a normal assistant turn.'
        } satisfies EngineModelEvent;
        yield {
          type: 'assistant_done'
        } satisfies EngineModelEvent;
      },
      async cancelTurn() {}
    };

    const engine = createEngine({ provider });
    const session = engine.createSession({ cwd: process.cwd() });

    await engine.submitPrompt(session.id, 'hello');
    await engine.submitPrompt(session.id, '/session');

    expect(engine.getSnapshot(session.id).messages.at(-1)?.content).toContain('status=completed');
    expect(engine.getSnapshot(session.id).messages.at(-1)?.content).not.toContain('status=running');
  });

  it('compacts session history and can reattach a persisted session snapshot', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'claude-oca-engine-'));
    const provider: EngineModelProvider = {
      async healthCheck() {
        return { ok: true, provider: 'fake', model: 'fake-model' };
      },
      async *sendTurn() {
        yield {
          type: 'assistant_delta',
          text: 'Generated output for compaction.'
        } satisfies EngineModelEvent;
        yield {
          type: 'assistant_done'
        } satisfies EngineModelEvent;
      },
      async cancelTurn() {}
    };

    const engine = createEngine({ provider });
    const session = engine.createSession({ cwd });

    await engine.submitPrompt(session.id, 'First prompt');
    await engine.submitPrompt(session.id, '/compact');

    const compacted = engine.getSnapshot(session.id);
    expect(compacted.history.summaries).toHaveLength(1);
    expect(compacted.history.summaries[0]).toMatchObject({
      title: 'Session summary',
      preview: expect.stringContaining('First prompt'),
      transcript: expect.arrayContaining([expect.stringContaining('First prompt')]),
      openTasks: [],
      rememberedNotes: [],
      changedFiles: []
    });

    const reattached = engine.createSession({ cwd, sessionId: session.id });
    const resumed = engine.getSnapshot(reattached.id);
    expect(resumed.history.summaries).toHaveLength(1);
    expect(resumed.history.summaries[0]?.preview).toContain('First prompt');
  });

  it('persists session attachments and injects local file refs plus OCR context into model turns', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'claude-oca-attachments-'));
    const sessionId = 'session-with-attachments';
    const uploadDir = join(cwd, '.claude-oca', 'uploads', sessionId);
    mkdirSync(uploadDir, { recursive: true });

    const textPath = join(uploadDir, 'trace.log');
    const imagePath = join(uploadDir, 'error.png');
    writeFileSync(textPath, 'Unhandled exception from local log');
    writeFileSync(imagePath, 'png');

    const capturedTurns: EngineModelMessage[][] = [];
    const provider: EngineModelProvider = {
      async healthCheck() {
        return { ok: true, provider: 'fake', model: 'fake-model' };
      },
      async *sendTurn(messages) {
        capturedTurns.push([...messages]);
        yield {
          type: 'assistant_delta',
          text: 'I inspected the uploaded artifacts.'
        } satisfies EngineModelEvent;
        yield {
          type: 'assistant_done'
        } satisfies EngineModelEvent;
      },
      async cancelTurn() {}
    };

    const engine = createEngine({ provider });
    const session = engine.createSession({ cwd, sessionId });
    engine.addAttachment(session.id, {
      id: 'att-text',
      originalName: 'trace.log',
      storedName: 'trace.log',
      mediaType: 'text/plain',
      kind: 'text',
      localPath: textPath,
      size: 33,
      promptVisibility: 'available',
      ocrStatus: 'unavailable',
      uploadedAt: '2026-04-24T00:00:00.000Z'
    });
    engine.addAttachment(session.id, {
      id: 'att-image',
      originalName: 'error.png',
      storedName: 'error.png',
      mediaType: 'image/png',
      kind: 'image',
      localPath: imagePath,
      size: 12,
      promptVisibility: 'available',
      ocrStatus: 'completed',
      extractedText: 'Fatal: port 4317 already in use',
      uploadedAt: '2026-04-24T00:00:00.000Z'
    });

    await engine.submitPrompt(session.id, 'inspect the uploaded files', {
      attachmentIds: ['att-text', 'att-image']
    });

    const userTurn = capturedTurns[0]?.at(-1);
    expect(userTurn).toMatchObject({
      role: 'user'
    });
    expect(userTurn?.content).toContain(`@"${textPath}"`);
    expect(userTurn?.content).toContain(`@"${imagePath}"`);
    expect(userTurn?.content).toContain('OCR extracted text');
    expect(userTurn?.content).toContain('Fatal: port 4317 already in use');

    const reattachedEngine = createEngine({ provider });
    reattachedEngine.createSession({ cwd, sessionId });
    expect(reattachedEngine.getSnapshot(sessionId).attachments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'att-text', originalName: 'trace.log' }),
        expect.objectContaining({ id: 'att-image', originalName: 'error.png' })
      ])
    );
  });

  it('permanently deletes persisted sessions, uploads, and workspace-owned report artifacts', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'claude-oca-delete-session-'));
    const sessionId = 'delete-session';
    const uploadDir = join(cwd, '.claude-oca', 'uploads', sessionId);
    const reportDir = join(cwd, 'reports');
    const reportPath = join(reportDir, 'delete-session-report.html');
    const sessionPath = join(cwd, '.claude-oca', 'sessions', `${sessionId}.json`);
    mkdirSync(uploadDir, { recursive: true });
    mkdirSync(reportDir, { recursive: true });
    writeFileSync(join(uploadDir, 'trace.log'), 'trace');
    writeFileSync(reportPath, '<html><body>report</body></html>');

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
            toolName: 'analyze_adf_logs',
            input: {
              log_folder: cwd
            }
          } satisfies EngineModelEvent;
          return;
        }

        yield {
          type: 'assistant_delta',
          text: 'Report ready.'
        } satisfies EngineModelEvent;
        yield {
          type: 'assistant_done'
        } satisfies EngineModelEvent;
      },
      async cancelTurn() {}
    };
    const executeTool = vi.fn(async () => ({
      summary: 'Generated report',
      source: 'jd-mcp',
      artifacts: [
        {
          id: 'delete-report',
          sessionId: 'pending',
          toolName: 'analyze_adf_logs',
          source: 'jd-mcp',
          kind: 'html-report',
          title: 'Delete Session Report',
          filePath: reportPath,
          fileName: 'delete-session-report.html',
          createdAt: '2026-04-24T00:00:00.000Z',
          size: 32
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
      ]
    });

    const session = engine.createSession({ cwd, sessionId });
    engine.addAttachment(session.id, {
      id: 'att-delete',
      originalName: 'trace.log',
      storedName: 'trace.log',
      mediaType: 'text/plain',
      kind: 'text',
      localPath: join(uploadDir, 'trace.log'),
      size: 5,
      promptVisibility: 'available',
      ocrStatus: 'unavailable',
      uploadedAt: '2026-04-24T00:00:00.000Z'
    });
    await engine.submitPrompt(session.id, 'analyze logs');
    const approval = engine.getPendingApprovals(session.id)[0];
    await engine.resolveApproval(session.id, approval!.requestId, { decision: 'allow' });

    expect(existsSync(sessionPath)).toBe(true);
    expect(existsSync(uploadDir)).toBe(true);
    expect(existsSync(reportPath)).toBe(true);

    expect(engine.deleteSession(session.id, cwd)).toBe(true);

    expect(engine.listSessions(cwd).some((summary) => summary.id === session.id)).toBe(false);
    expect(existsSync(sessionPath)).toBe(false);
    expect(existsSync(uploadDir)).toBe(false);
    expect(existsSync(reportPath)).toBe(false);
    expect(engine.deleteSession('unknown-session', cwd)).toBe(false);

    const unsafeSessionId = join('..', 'outside-session');
    const outsideSessionPath = join(cwd, '.claude-oca', 'outside-session.json');
    const outsideUploadDir = join(cwd, '.claude-oca', 'outside-session');
    writeFileSync(
      outsideSessionPath,
      JSON.stringify({
        session: { id: 'outside-session', cwd, status: 'idle' },
        reports: []
      }),
      'utf8'
    );
    mkdirSync(outsideUploadDir, { recursive: true });

    expect(engine.deleteSession(unsafeSessionId, cwd)).toBe(false);
    expect(existsSync(outsideSessionPath)).toBe(true);
    expect(existsSync(outsideUploadDir)).toBe(true);
  });

  it('excludes removed attachments from later turns', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'claude-oca-attachments-'));
    const sessionId = 'removed-attachments';
    const uploadDir = join(cwd, '.claude-oca', 'uploads', sessionId);
    mkdirSync(uploadDir, { recursive: true });

    const textPath = join(uploadDir, 'debug.txt');
    writeFileSync(textPath, 'debug output');

    const capturedTurns: EngineModelMessage[][] = [];
    const provider: EngineModelProvider = {
      async healthCheck() {
        return { ok: true, provider: 'fake', model: 'fake-model' };
      },
      async *sendTurn(messages) {
        capturedTurns.push([...messages]);
        yield {
          type: 'assistant_delta',
          text: 'Handled.'
        } satisfies EngineModelEvent;
        yield {
          type: 'assistant_done'
        } satisfies EngineModelEvent;
      },
      async cancelTurn() {}
    };

    const engine = createEngine({ provider });
    const session = engine.createSession({ cwd, sessionId });
    engine.addAttachment(session.id, {
      id: 'att-debug',
      originalName: 'debug.txt',
      storedName: 'debug.txt',
      mediaType: 'text/plain',
      kind: 'text',
      localPath: textPath,
      size: 12,
      promptVisibility: 'available',
      ocrStatus: 'unavailable',
      uploadedAt: '2026-04-24T00:00:00.000Z'
    });

    engine.removeAttachment(session.id, 'att-debug');
    await engine.submitPrompt(session.id, 'should ignore removed attachment', {
      attachmentIds: ['att-debug']
    });

    const userTurn = capturedTurns[0]?.at(-1);
    expect(userTurn?.content).not.toContain(textPath);
    expect(engine.getSnapshot(session.id).attachments).toEqual([
      expect.objectContaining({
        id: 'att-debug',
        promptVisibility: 'removed'
      })
    ]);
  });

  it('registers jd-mcp report artifacts and exposes external tool metadata through the runtime snapshot', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'claude-oca-jdmcp-'));
    const reportPath = join(cwd, 'reports', 'adflr-sample-report.html');
    mkdirSync(join(cwd, 'reports'), { recursive: true });
    writeFileSync(reportPath, '<html><body>ADF report</body></html>');

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
            toolName: 'analyze_adf_logs',
            input: {
              log_folder: cwd
            },
            reasoning: 'The jd-mcp analyzer can generate the HTML report directly.'
          } satisfies EngineModelEvent;
          return;
        }

        yield {
          type: 'assistant_delta',
          text: 'The jd-mcp report is ready.'
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
      metadata: {
        provider: 'jd-mcp'
      },
      artifacts: [
        {
          id: 'report-1',
          sessionId: 'pending',
          toolName: 'analyze_adf_logs',
          source: 'jd-mcp',
          kind: 'html-report',
          title: 'ADF Log Review',
          filePath: reportPath,
          fileName: 'adflr-sample-report.html',
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
          name: 'Read',
          description: 'Read a file from the local filesystem.',
          source: 'builtin',
          requiresApproval: false
        },
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
    const session = engine.createSession({ cwd });

    await engine.submitPrompt(session.id, 'analyze these logs');
    const approval = engine.getPendingApprovals(session.id)[0];

    expect(approval).toMatchObject({
      toolName: 'analyze_adf_logs',
      source: 'jd-mcp'
    });

    await engine.resolveApproval(session.id, approval!.requestId, {
      decision: 'allow'
    });

    const snapshot = engine.getSnapshot(session.id) as typeof engine.getSnapshot extends (
      sessionId: string
    ) => infer T
      ? T & {
          reports?: {
            artifacts: Array<Record<string, unknown>>;
          };
          integrations?: Record<string, unknown>;
        }
      : never;

    expect(snapshot.reports?.artifacts).toEqual([
      expect.objectContaining({
        requestId: approval!.requestId,
        toolName: 'analyze_adf_logs',
        source: 'jd-mcp',
        filePath: reportPath
      })
    ]);
    expect(snapshot.toolActivity).toEqual([
      expect.objectContaining({
        requestId: approval!.requestId,
        toolName: 'analyze_adf_logs',
        status: 'completed',
        artifacts: [
          expect.objectContaining({
            requestId: approval!.requestId,
            filePath: reportPath
          })
        ]
      })
    ]);
    expect(snapshot.integrations?.jdMcp).toMatchObject({
      available: true,
      connected: true,
      toolDescriptors: [
        expect.objectContaining({
          name: 'analyze_adf_logs',
          visibility: 'enabled'
        })
      ]
    });
  });

  it('records why jd-mcp report mode was skipped for a single attached log by default', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'claude-oca-report-routing-'));
    const sessionId = 'single-log-routing';
    const uploadDir = join(cwd, '.claude-oca', 'uploads', sessionId);
    mkdirSync(uploadDir, { recursive: true });

    const logPath = join(uploadDir, 'DefaultServer-diagnostic.log');
    writeFileSync(logPath, 'ADF diagnostic log');

    const provider: EngineModelProvider = {
      async healthCheck() {
        return { ok: true, provider: 'fake', model: 'fake-model' };
      },
      async *sendTurn() {
        yield {
          type: 'assistant_delta',
          text: 'I analyzed the attached log directly.'
        } satisfies EngineModelEvent;
        yield {
          type: 'assistant_done'
        } satisfies EngineModelEvent;
      },
      async cancelTurn() {}
    };

    const engine = (createEngine as unknown as (input: Record<string, unknown>) => ReturnType<typeof createEngine>)({
      provider,
      toolCatalog: [
        {
          name: 'Read',
          description: 'Read a file from the local filesystem.',
          source: 'builtin',
          requiresApproval: false
        },
        {
          name: 'analyze_adf_logs',
          description: 'Analyze ADF logs through jd-mcp.',
          source: 'jd-mcp',
          requiresApproval: true,
          producesReports: true,
          category: 'reports',
          enabled: true,
          visibility: 'enabled',
          stability: 'stable'
        }
      ]
    });
    const session = engine.createSession({ cwd, sessionId });
    engine.addAttachment(session.id, {
      id: 'att-log',
      originalName: 'DefaultServer-diagnostic.log',
      storedName: 'DefaultServer-diagnostic.log',
      mediaType: 'text/plain',
      kind: 'text',
      localPath: logPath,
      size: 18,
      promptVisibility: 'available',
      ocrStatus: 'unavailable',
      uploadedAt: '2026-04-24T00:00:00.000Z'
    });

    await engine.submitPrompt(session.id, 'analyse this file', {
      attachmentIds: ['att-log']
    });

    const snapshot = engine.getSnapshot(session.id) as ReturnType<typeof engine.getSnapshot> & {
      skippedTools?: Array<Record<string, unknown>>;
      reportSuggestion?: Record<string, unknown> | null;
    };

    expect(snapshot.reports.artifacts).toEqual([]);
    expect(snapshot.skippedTools).toEqual([
      expect.objectContaining({
        toolName: 'analyze_adf_logs',
        reasonCode: 'builtin_better_for_single_file',
        canOverride: true
      })
    ]);
    expect(snapshot.reportSuggestion).toMatchObject({
      available: true,
      canRun: true,
      suggestedToolName: 'analyze_adf_logs',
      attachmentIds: ['att-log']
    });
  });

  it('fills missing jd-mcp triage input paths from the current attached diagnostic log', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'claude-oca-triage-input-'));
    const sessionId = 'triage-input-session';
    const uploadDir = join(cwd, '.claude-oca', 'uploads', sessionId);
    mkdirSync(uploadDir, { recursive: true });

    const logPath = join(uploadDir, 'DefaultServer-diagnostic.log');
    writeFileSync(logPath, 'ADF diagnostic log');

    let turnCount = 0;
    const provider: EngineModelProvider = {
      async healthCheck() {
        return { ok: true, provider: 'fake', model: 'fake-model' };
      },
      async *sendTurn() {
        turnCount += 1;
        if (turnCount === 1) {
          yield {
            type: 'tool_call',
            toolName: 'triage_text_diagnostics',
            input: {
              input_path: 'undefined'
            },
            reasoning: 'Triage the attached ADF diagnostic log and identify likely issues'
          } satisfies EngineModelEvent;
          return;
        }

        yield {
          type: 'assistant_delta',
          text: 'Triage completed.'
        } satisfies EngineModelEvent;
        yield {
          type: 'assistant_done'
        } satisfies EngineModelEvent;
      },
      async cancelTurn() {}
    };
    const executeTool = vi.fn(async () => ({
      summary: 'triage complete',
      source: 'jd-mcp' as const
    }));

    const engine = createEngine({
      provider,
      executeTool,
      toolCatalog: [
        {
          name: 'triage_text_diagnostics',
          description: 'Quickly triage text logs and recommend the next specialized analyzer.',
          source: 'jd-mcp',
          requiresApproval: false,
          producesReports: false,
          category: 'diagnostics',
          enabled: true,
          visibility: 'enabled',
          stability: 'stable'
        }
      ]
    });
    const session = engine.createSession({ cwd, sessionId });
    engine.addAttachment(session.id, {
      id: 'att-log',
      originalName: 'DefaultServer-diagnostic.log',
      storedName: 'DefaultServer-diagnostic.log',
      mediaType: 'text/plain',
      kind: 'text',
      localPath: logPath,
      size: 18,
      promptVisibility: 'available',
      ocrStatus: 'unavailable',
      uploadedAt: '2026-04-24T00:00:00.000Z'
    });

    await engine.submitPrompt(session.id, 'analyse this', {
      attachmentIds: ['att-log']
    });

    expect(executeTool).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'triage_text_diagnostics',
        input: {
          input_path: logPath
        }
      })
    );
    expect(engine.getSnapshot(session.id).toolActivity).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolName: 'triage_text_diagnostics',
          status: 'completed',
          input: {
            input_path: logPath
          }
        })
      ])
    );
  });

  it('prefers analyze_adf_logs for explicit analyzer requests with an attached diagnostic log', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'claude-oca-explicit-report-'));
    const sessionId = 'explicit-report-session';
    const uploadDir = join(cwd, '.claude-oca', 'uploads', sessionId);
    mkdirSync(uploadDir, { recursive: true });

    const logPath = join(uploadDir, 'DefaultServer-diagnostic.log');
    writeFileSync(logPath, 'ADF diagnostic log');

    const provider: EngineModelProvider = {
      async healthCheck() {
        return { ok: true, provider: 'fake', model: 'fake-model' };
      },
      async *sendTurn(messages) {
        expect(messages.at(-1)?.content).toContain('Prefer calling analyze_adf_logs with exactly this input');
        yield {
          type: 'assistant_delta',
          text: 'I will run the analyzer.'
        } satisfies EngineModelEvent;
        yield {
          type: 'tool_call',
          toolName: 'analyze_adf_logs',
          input: {
            log_folder: 'wrong-folder'
          }
        } satisfies EngineModelEvent;
      },
      async cancelTurn() {}
    };

    const engine = createEngine({
      provider,
      toolCatalog: [
        {
          name: 'analyze_adf_logs',
          description: 'Analyze ADF logs through jd-mcp.',
          source: 'jd-mcp',
          requiresApproval: true,
          producesReports: true,
          category: 'reports',
          enabled: true,
          visibility: 'enabled',
          stability: 'stable'
        }
      ]
    });
    const session = engine.createSession({ cwd, sessionId });
    engine.addAttachment(session.id, {
      id: 'att-log',
      originalName: 'DefaultServer-diagnostic.log',
      storedName: 'DefaultServer-diagnostic.log',
      mediaType: 'text/plain',
      kind: 'text',
      localPath: logPath,
      size: 18,
      promptVisibility: 'available',
      ocrStatus: 'unavailable',
      uploadedAt: '2026-04-24T00:00:00.000Z'
    });

    await engine.submitPrompt(session.id, 'analyse this using analyse log tool', {
      attachmentIds: ['att-log']
    });

    expect(engine.getPendingApprovals(session.id)).toEqual([
      expect.objectContaining({
        toolName: 'analyze_adf_logs',
        source: 'jd-mcp',
        input: {
          log_folder: uploadDir
        }
      })
    ]);
    expect(
      engine
        .getSnapshot(session.id)
        .messages.some(
          (message) =>
            message.role === 'assistant' && message.content.includes('I will run the analyzer.')
        )
    ).toBe(false);
  });

  it('falls back to direct analysis when analyze_adf_logs is unavailable for explicit analyzer requests', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'claude-oca-explicit-unavailable-'));
    const sessionId = 'explicit-unavailable-session';
    const uploadDir = join(cwd, '.claude-oca', 'uploads', sessionId);
    mkdirSync(uploadDir, { recursive: true });

    const logPath = join(uploadDir, 'DefaultServer-diagnostic.log');
    writeFileSync(logPath, 'ADF diagnostic log');

    let sendTurnCount = 0;
    const provider: EngineModelProvider = {
      healthCheck: vi.fn(async () => ({ ok: true, provider: 'fake', model: 'fake-model' })),
      sendTurn: vi.fn(async function* (messages) {
        sendTurnCount += 1;
        if (sendTurnCount === 1) {
          expect(messages.at(-1)?.content).toContain('analyze_adf_logs cannot run in this environment');
          yield {
            type: 'tool_call',
            toolName: 'Grep',
            input: {
              pattern: '(',
              glob: '**/*.log',
              output_mode: 'content'
            }
          } satisfies EngineModelEvent;
          return;
        }

        expect(String(messages.at(-1)?.content)).toContain('recoveryInstruction');
        yield {
          type: 'assistant_delta',
          text: 'Direct analysis fallback: the log has no SEVERE entries.'
        } satisfies EngineModelEvent;
      }),
      cancelTurn: vi.fn(async () => {})
    };

    const engine = createEngine({
      provider,
      toolCatalog: [
        {
          name: 'analyze_adf_logs',
          description: 'Analyze ADF logs through jd-mcp.',
          source: 'jd-mcp',
          requiresApproval: true,
          producesReports: true,
          category: 'reports',
          enabled: false,
          visibility: 'unsupported',
          stability: 'stable',
          reason: 'JD_MCP_ROOT is not configured.'
        }
      ]
    });
    const session = engine.createSession({ cwd, sessionId });
    engine.addAttachment(session.id, {
      id: 'att-log',
      originalName: 'DefaultServer-diagnostic.log',
      storedName: 'DefaultServer-diagnostic.log',
      mediaType: 'text/plain',
      kind: 'text',
      localPath: logPath,
      size: 18,
      promptVisibility: 'available',
      ocrStatus: 'unavailable',
      uploadedAt: '2026-04-24T00:00:00.000Z'
    });

    await engine.submitPrompt(session.id, 'run jd-mcp on this log', {
      attachmentIds: ['att-log']
    });

    const snapshot = engine.getSnapshot(session.id);
    expect(provider.sendTurn).toHaveBeenCalledTimes(2);
    expect(sendTurnCount).toBe(2);
    expect(snapshot.status).toBe('completed');
    expect(snapshot.pendingApprovals).toEqual([]);
    expect(snapshot.messages).toEqual([
      expect.objectContaining({
        role: 'user'
      }),
      expect.objectContaining({
        role: 'system',
        kind: 'command-error',
        content: expect.stringContaining('analyze_adf_logs unavailable: JD_MCP_ROOT is not configured.')
      }),
      expect.objectContaining({
        role: 'system',
        kind: 'command-error',
        content: expect.stringContaining('Grep failed (recoverable attempt 1/3)')
      }),
      expect.objectContaining({
        role: 'assistant',
        content: expect.stringContaining('Direct analysis fallback')
      })
    ]);
    expect(snapshot.skippedTools).toEqual([
      expect.objectContaining({
        toolName: 'analyze_adf_logs',
        reasonCode: 'analyzer_unavailable_direct_analysis_used',
        canOverride: false
      })
    ]);
    expect(snapshot.reportSuggestion).toMatchObject({
      canRun: false,
      reasonCode: 'analyzer_unavailable_direct_analysis_used'
    });
  });

  it('continues with direct analysis when the model ignores an explicit analyzer request', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'claude-oca-explicit-ignored-'));
    const sessionId = 'explicit-ignored-session';
    const uploadDir = join(cwd, '.claude-oca', 'uploads', sessionId);
    mkdirSync(uploadDir, { recursive: true });

    const logPath = join(uploadDir, 'DefaultServer-diagnostic.log');
    writeFileSync(logPath, 'ADF diagnostic log');

    let sendTurnCount = 0;
    const provider: EngineModelProvider = {
      async healthCheck() {
        return { ok: true, provider: 'fake', model: 'fake-model' };
      },
      async *sendTurn() {
        sendTurnCount += 1;
        if (sendTurnCount === 1) {
          yield {
            type: 'assistant_delta',
            text: 'I will answer without the analyzer.'
          } satisfies EngineModelEvent;
          yield {
            type: 'assistant_done'
          } satisfies EngineModelEvent;
          return;
        }

        yield {
          type: 'assistant_delta',
          text: 'Direct fallback analysis: the REST request completed with HTTP 200.'
        } satisfies EngineModelEvent;
        yield {
          type: 'assistant_done'
        } satisfies EngineModelEvent;
      },
      async cancelTurn() {}
    };

    const engine = createEngine({
      provider,
      toolCatalog: [
        {
          name: 'analyze_adf_logs',
          description: 'Analyze ADF logs through jd-mcp.',
          source: 'jd-mcp',
          requiresApproval: true,
          producesReports: true,
          category: 'reports',
          enabled: true,
          visibility: 'enabled',
          stability: 'stable'
        }
      ]
    });
    const session = engine.createSession({ cwd, sessionId });
    engine.addAttachment(session.id, {
      id: 'att-log',
      originalName: 'DefaultServer-diagnostic.log',
      storedName: 'DefaultServer-diagnostic.log',
      mediaType: 'text/plain',
      kind: 'text',
      localPath: logPath,
      size: 18,
      promptVisibility: 'available',
      ocrStatus: 'unavailable',
      uploadedAt: '2026-04-24T00:00:00.000Z'
    });

    await engine.submitPrompt(session.id, 'please generate report for this ADF diagnostic log', {
      attachmentIds: ['att-log']
    });

    const snapshot = engine.getSnapshot(session.id);
    expect(sendTurnCount).toBe(2);
    expect(snapshot.status).toBe('completed');
    expect(
      snapshot.messages.some(
        (message) =>
          message.role === 'assistant' &&
          message.content.includes('I will answer without the analyzer.')
      )
    ).toBe(false);
    expect(snapshot.messages).toEqual([
      expect.objectContaining({
        role: 'user'
      }),
      expect.objectContaining({
        role: 'system',
        kind: 'command-error',
        content: expect.stringContaining('Direct analysis was used as a fallback')
      }),
      expect.objectContaining({
        role: 'assistant',
        content: expect.stringContaining('Direct fallback analysis')
      })
    ]);
    expect(snapshot.skippedTools).toEqual([
      expect.objectContaining({
        reasonCode: 'explicit_tool_request_not_honored',
        canOverride: true
      })
    ]);
    expect(snapshot.reportSuggestion).toMatchObject({
      canRun: true,
      reasonCode: 'explicit_tool_request_not_honored',
      input: {
        log_folder: uploadDir
      }
    });
  });

  it('forces the jd-mcp report path through /report without routing the command to the provider', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'claude-oca-report-command-'));
    const sessionId = 'report-command-session';
    const uploadDir = join(cwd, '.claude-oca', 'uploads', sessionId);
    mkdirSync(uploadDir, { recursive: true });

    const logPath = join(uploadDir, 'DefaultServer-diagnostic.log');
    writeFileSync(logPath, 'ADF diagnostic log');

    const provider: EngineModelProvider = {
      healthCheck: vi.fn(async () => ({ ok: true, provider: 'fake', model: 'fake-model' })),
      sendTurn: vi.fn(async function* () {
        return;
      }),
      cancelTurn: vi.fn(async () => {})
    };
    const executeTool = vi.fn(async () => ({
      summary: 'Generated 1 jd-mcp HTML report',
      source: 'jd-mcp'
    }));

    const engine = (createEngine as unknown as (input: Record<string, unknown>) => ReturnType<typeof createEngine>)({
      provider,
      executeTool,
      toolCatalog: [
        {
          name: 'Read',
          description: 'Read a file from the local filesystem.',
          source: 'builtin',
          requiresApproval: false
        },
        {
          name: 'analyze_adf_logs',
          description: 'Analyze ADF logs through jd-mcp.',
          source: 'jd-mcp',
          requiresApproval: true,
          producesReports: true,
          category: 'reports',
          enabled: true,
          visibility: 'enabled',
          stability: 'stable'
        }
      ]
    });
    const session = engine.createSession({ cwd, sessionId });
    engine.addAttachment(session.id, {
      id: 'att-log',
      originalName: 'DefaultServer-diagnostic.log',
      storedName: 'DefaultServer-diagnostic.log',
      mediaType: 'text/plain',
      kind: 'text',
      localPath: logPath,
      size: 18,
      promptVisibility: 'available',
      ocrStatus: 'unavailable',
      uploadedAt: '2026-04-24T00:00:00.000Z'
    });

    await engine.submitPrompt(session.id, '/report', {
      attachmentIds: ['att-log']
    });

    expect(provider.sendTurn).not.toHaveBeenCalled();
    expect(engine.getPendingApprovals(session.id)).toEqual([
      expect.objectContaining({
        toolName: 'analyze_adf_logs',
        source: 'jd-mcp',
        input: {
          log_folder: uploadDir
        }
      })
    ]);

    const approval = engine.getPendingApprovals(session.id)[0];
    await engine.resolveApproval(session.id, approval!.requestId, {
      decision: 'allow'
    });

    expect(executeTool).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'analyze_adf_logs',
        input: {
          log_folder: uploadDir
        }
      })
    );
    expect(provider.sendTurn).not.toHaveBeenCalled();
    expect(engine.getSnapshot(session.id).status).toBe('completed');
  });

  it('surfaces failed /report executions and clears the stale report suggestion', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'claude-oca-report-command-failure-'));
    const sessionId = 'report-command-failure-session';
    const uploadDir = join(cwd, '.claude-oca', 'uploads', sessionId);
    mkdirSync(uploadDir, { recursive: true });

    const logPath = join(uploadDir, 'DefaultServer-diagnostic.log');
    writeFileSync(logPath, 'ADF diagnostic log');

    const provider: EngineModelProvider = {
      healthCheck: vi.fn(async () => ({ ok: true, provider: 'fake', model: 'fake-model' })),
      sendTurn: vi.fn(async function* () {
        yield {
          type: 'assistant_delta',
          text: 'Direct analysis result'
        } satisfies EngineModelEvent;
      }),
      cancelTurn: vi.fn(async () => {})
    };
    const executeTool = vi.fn(async () => {
      throw new Error(
        'Exception in thread "main" java.lang.NullPointerException: Cannot invoke "oracle.jtech.la.LogMessage.setMsg(String)" because "logM" is null'
      );
    });

    const engine = createEngine({
      provider,
      executeTool,
      toolCatalog: [
        {
          name: 'analyze_adf_logs',
          description: 'Analyze ADF logs through jd-mcp.',
          source: 'jd-mcp',
          requiresApproval: true,
          producesReports: true,
          category: 'reports',
          enabled: true,
          visibility: 'enabled',
          stability: 'stable'
        }
      ]
    });
    const session = engine.createSession({ cwd, sessionId });
    engine.addAttachment(session.id, {
      id: 'att-log',
      originalName: 'DefaultServer-diagnostic.log',
      storedName: 'DefaultServer-diagnostic.log',
      mediaType: 'text/plain',
      kind: 'text',
      localPath: logPath,
      size: 18,
      promptVisibility: 'available',
      ocrStatus: 'unavailable',
      uploadedAt: '2026-04-24T00:00:00.000Z'
    });

    await engine.submitPrompt(session.id, 'analyze this log', {
      attachmentIds: ['att-log']
    });
    expect(engine.getSnapshot(session.id).reportSuggestion).toMatchObject({
      canRun: true,
      suggestedToolName: 'analyze_adf_logs'
    });

    await engine.submitPrompt(session.id, '/report', {
      attachmentIds: ['att-log']
    });
    const approval = engine.getPendingApprovals(session.id)[0];
    await engine.resolveApproval(session.id, approval!.requestId, {
      decision: 'allow'
    });

    const snapshot = engine.getSnapshot(session.id);
    expect(snapshot.status).toBe('blocked');
    expect(snapshot.reportSuggestion).toBeNull();
    expect(snapshot.toolActivity[0]).toMatchObject({
      toolName: 'analyze_adf_logs',
      status: 'failed'
    });
    expect(snapshot.messages.at(-1)).toMatchObject({
      role: 'system',
      kind: 'command-error',
      content: expect.stringContaining('analyze_adf_logs failed: Exception in thread "main"')
    });
  });

  it('keeps /report strict when analyze_adf_logs is unavailable', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'claude-oca-report-strict-unavailable-'));
    const sessionId = 'report-strict-unavailable-session';
    const uploadDir = join(cwd, '.claude-oca', 'uploads', sessionId);
    mkdirSync(uploadDir, { recursive: true });

    const logPath = join(uploadDir, 'DefaultServer-diagnostic.log');
    writeFileSync(logPath, 'ADF diagnostic log');

    const provider: EngineModelProvider = {
      healthCheck: vi.fn(async () => ({ ok: true, provider: 'fake', model: 'fake-model' })),
      sendTurn: vi.fn(async function* () {
        yield {
          type: 'assistant_delta',
          text: 'manual fallback'
        } satisfies EngineModelEvent;
      }),
      cancelTurn: vi.fn(async () => {})
    };

    const engine = createEngine({
      provider,
      toolCatalog: [
        {
          name: 'analyze_adf_logs',
          description: 'Analyze ADF logs through jd-mcp.',
          source: 'jd-mcp',
          requiresApproval: true,
          producesReports: true,
          category: 'reports',
          enabled: false,
          visibility: 'unsupported',
          stability: 'stable',
          reason: 'JD_MCP_ROOT is not configured.'
        }
      ]
    });
    const session = engine.createSession({ cwd, sessionId });
    engine.addAttachment(session.id, {
      id: 'att-log',
      originalName: 'DefaultServer-diagnostic.log',
      storedName: 'DefaultServer-diagnostic.log',
      mediaType: 'text/plain',
      kind: 'text',
      localPath: logPath,
      size: 18,
      promptVisibility: 'available',
      ocrStatus: 'unavailable',
      uploadedAt: '2026-04-24T00:00:00.000Z'
    });

    await engine.submitPrompt(session.id, '/report', {
      attachmentIds: ['att-log']
    });

    const snapshot = engine.getSnapshot(session.id);
    expect(provider.sendTurn).not.toHaveBeenCalled();
    expect(snapshot.status).toBe('completed');
    expect(snapshot.pendingApprovals).toEqual([]);
    expect(snapshot.messages).toEqual([
      expect.objectContaining({
        role: 'user'
      }),
      expect.objectContaining({
        role: 'system',
        kind: 'command-error',
        content: expect.stringContaining('No jd-mcp report was generated because analyze_adf_logs is unavailable here')
      })
    ]);
  });

  it('continues the model loop after a recoverable Grep failure', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'claude-oca-recover-grep-'));
    writeFileSync(join(cwd, 'app.log'), 'WARNING startup\n');
    let sendTurnCount = 0;

    const provider: EngineModelProvider = {
      async healthCheck() {
        return { ok: true, provider: 'fake', model: 'fake-model' };
      },
      async *sendTurn(messages) {
        sendTurnCount += 1;
        if (sendTurnCount === 1) {
          yield {
            type: 'tool_call',
            toolName: 'Grep',
            input: {
              pattern: '(',
              glob: '*.log',
              output_mode: 'content'
            }
          } satisfies EngineModelEvent;
          return;
        }

        expect(messages.at(-1)).toMatchObject({
          role: 'tool',
          toolName: 'Grep'
        });
        expect(String(messages.at(-1)?.content)).toContain('recoveryInstruction');
        yield {
          type: 'assistant_delta',
          text: 'Recovered by switching to a simpler log search.'
        } satisfies EngineModelEvent;
        yield {
          type: 'assistant_done'
        } satisfies EngineModelEvent;
      },
      async cancelTurn() {}
    };

    const engine = createEngine({ provider });
    const session = engine.createSession({ cwd });

    await engine.submitPrompt(session.id, 'inspect the log');

    const snapshot = engine.getSnapshot(session.id);
    expect(sendTurnCount).toBe(2);
    expect(snapshot.status).toBe('completed');
    expect(snapshot.toolActivity).toEqual([
      expect.objectContaining({
        toolName: 'Grep',
        status: 'failed',
        recoverable: true,
        recoveryAttempt: 1,
        recoveryInstruction: expect.stringContaining('simpler JavaScript-compatible regex')
      })
    ]);
    expect(snapshot.messages.at(-1)).toMatchObject({
      role: 'assistant',
      content: expect.stringContaining('Recovered')
    });
  });

  it('lets the model retry successfully after a recoverable Grep failure', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'claude-oca-retry-grep-'));
    writeFileSync(join(cwd, 'app.log'), 'ERROR failed\n');
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
            toolName: 'Grep',
            input: {
              pattern: '(',
              glob: '*.log',
              output_mode: 'content'
            }
          } satisfies EngineModelEvent;
          return;
        }
        if (sendTurnCount === 2) {
          yield {
            type: 'tool_call',
            toolName: 'Grep',
            input: {
              pattern: 'ERROR',
              glob: '*.log',
              output_mode: 'content'
            }
          } satisfies EngineModelEvent;
          return;
        }

        yield {
          type: 'assistant_delta',
          text: 'The repaired search found the error line.'
        } satisfies EngineModelEvent;
        yield {
          type: 'assistant_done'
        } satisfies EngineModelEvent;
      },
      async cancelTurn() {}
    };

    const engine = createEngine({ provider });
    const session = engine.createSession({ cwd });

    await engine.submitPrompt(session.id, 'search the log');

    const snapshot = engine.getSnapshot(session.id);
    expect(sendTurnCount).toBe(3);
    expect(snapshot.status).toBe('completed');
    expect(snapshot.toolActivity).toEqual([
      expect.objectContaining({
        toolName: 'Grep',
        status: 'completed'
      }),
      expect.objectContaining({
        toolName: 'Grep',
        status: 'failed',
        recoverable: true
      })
    ]);
  });

  it('blocks after the recoverable tool failure budget is exhausted', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'claude-oca-recover-budget-'));
    writeFileSync(join(cwd, 'app.log'), 'WARNING startup\n');
    let sendTurnCount = 0;

    const provider: EngineModelProvider = {
      async healthCheck() {
        return { ok: true, provider: 'fake', model: 'fake-model' };
      },
      async *sendTurn() {
        sendTurnCount += 1;
        yield {
          type: 'tool_call',
          toolName: 'Grep',
          input: {
            pattern: '(',
            glob: '*.log',
            output_mode: 'content'
          }
        } satisfies EngineModelEvent;
      },
      async cancelTurn() {}
    };

    const engine = createEngine({ provider });
    const session = engine.createSession({ cwd });

    await engine.submitPrompt(session.id, 'search the log');

    const snapshot = engine.getSnapshot(session.id);
    expect(sendTurnCount).toBe(3);
    expect(snapshot.status).toBe('blocked');
    expect(snapshot.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'system',
          content: expect.stringContaining('Recovery budget exhausted after 3 recoverable tool failures')
        })
      ])
    );
  });

  it('executes multiple non-mutating tools from one provider response before asking the model again', async () => {
    const executeTool = vi.fn(async ({ toolName, input }: { toolName: string; input: Record<string, unknown> }) => ({
      summary:
        toolName === 'Read'
          ? `Read ${String(input.file_path ?? '')}`
          : `Grep ${String(input.pattern ?? '')}`,
      metadata: {
        echoed: input
      }
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
            type: 'assistant_delta',
            text: 'I am going to inspect the codebase first.'
          } satisfies EngineModelEvent;
          yield {
            type: 'tool_call',
            toolName: 'Read',
            input: {
              file_path: 'README.md'
            },
            reasoning: 'Need the project overview.'
          } satisfies EngineModelEvent;
          yield {
            type: 'tool_call',
            toolName: 'Grep',
            input: {
              pattern: 'createSession',
              glob: '*.ts'
            },
            reasoning: 'Need to find the session entrypoint.'
          } satisfies EngineModelEvent;
          yield {
            type: 'assistant_done'
          } satisfies EngineModelEvent;
          return;
        }

        yield {
          type: 'assistant_delta',
          text: 'I found the relevant entrypoints after reading and searching.'
        } satisfies EngineModelEvent;
        yield {
          type: 'assistant_done'
        } satisfies EngineModelEvent;
      },
      async cancelTurn() {}
    };

    const engine = createEngine({
      provider,
      executeTool
    });
    const session = engine.createSession({ cwd: process.cwd() });
    const log = collectEvents();
    engine.subscribe(session.id, log.push);

    await engine.submitPrompt(session.id, 'Find the session entrypoint');

    expect(sendTurnCount).toBe(2);
    expect(executeTool).toHaveBeenCalledTimes(2);
    expect(executeTool).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        toolName: 'Read',
        input: {
          file_path: 'README.md'
        }
      })
    );
    expect(executeTool).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        toolName: 'Grep',
        input: {
          pattern: 'createSession',
          glob: '*.ts'
        }
      })
    );
    expect(log.events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        'tool.execution.started',
        'tool.execution.completed',
        'message.assistant.done',
        'turn.completed'
      ])
    );
    expect(engine.getSnapshot(session.id).toolActivity).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ toolName: 'Read', status: 'completed' }),
        expect.objectContaining({ toolName: 'Grep', status: 'completed' })
      ])
    );
  });

  it('spawns a background agent, restricts its tools, and lets the main agent read its output through TaskOutput', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'claude-oca-agents-'));
    const sendTurnCalls: Array<{ tools: string[]; lastMessage: string }> = [];
    let mainTurnPhase = 0;

    const provider: EngineModelProvider = {
      async healthCheck() {
        return { ok: true, provider: 'fake', model: 'fake-model' };
      },
      async *sendTurn(messages, options) {
        sendTurnCalls.push({
          tools: options.tools.map((tool) => tool.name),
          lastMessage: messages.at(-1)?.content ?? ''
        });

        const lastMessage = messages.at(-1)?.content ?? '';
        if (lastMessage.includes('Investigate the repo structure')) {
          yield {
            type: 'tool_call',
            toolName: 'Glob',
            input: {
              pattern: 'src/**/*.ts'
            },
            reasoning: 'Need to inspect the TypeScript source layout.'
          } satisfies EngineModelEvent;
          yield {
            type: 'assistant_delta',
            text: 'I inspected the repo structure and found the source layout.'
          } satisfies EngineModelEvent;
          yield {
            type: 'assistant_done'
          } satisfies EngineModelEvent;
          return;
        }

        if (mainTurnPhase === 0) {
          mainTurnPhase += 1;
          yield {
            type: 'tool_call',
            toolName: 'Agent',
            input: {
              task: 'Investigate the repo structure',
              subagent_type: 'research'
            },
            reasoning: 'A research subagent can inspect the codebase in the background.'
          } satisfies EngineModelEvent;
          return;
        }

        if (mainTurnPhase === 1) {
          mainTurnPhase += 1;
          yield {
            type: 'assistant_delta',
            text: 'The background agent is running now.'
          } satisfies EngineModelEvent;
          yield {
            type: 'assistant_done'
          } satisfies EngineModelEvent;
          return;
        }

        const taskOutputMatch = lastMessage.match(/"agent_id":\s*"([^"]+)"/);
        if (taskOutputMatch) {
          yield {
            type: 'assistant_delta',
            text: 'I read the agent output and can summarize it.'
          } satisfies EngineModelEvent;
          yield {
            type: 'assistant_done'
          } satisfies EngineModelEvent;
          return;
        }

        yield {
          type: 'assistant_done'
        } satisfies EngineModelEvent;
      },
      async cancelTurn() {}
    };

    const executeTool = vi.fn(async ({ toolName, input }: { toolName: string; input: Record<string, unknown> }) => ({
      summary:
        toolName === 'Glob'
          ? `Glob matched ${String(input.pattern ?? '')}`
          : `Executed ${toolName}`,
      metadata: {
        toolName,
        input
      }
    }));

    const engine = createEngine({
      provider,
      executeTool
    });
    const session = engine.createSession({ cwd });

    await engine.submitPrompt(session.id, 'Use a background agent to inspect the repo');
    const approval = engine.getPendingApprovals(session.id)[0];
    expect(approval).toMatchObject({
      toolName: 'Agent'
    });

    await engine.resolveApproval(session.id, approval!.requestId, {
      decision: 'allow'
    });

    await new Promise((resolve) => setTimeout(resolve, 25));

    const withAgent = engine.getSnapshot(session.id) as ReturnType<typeof engine.getSnapshot> & {
      agents?: Array<Record<string, unknown>>;
    };
    expect(withAgent.agents).toEqual([
      expect.objectContaining({
        agentType: 'research',
        status: 'completed',
        resultSummary: expect.stringContaining('repo structure')
      })
    ]);

    const agentId = String(withAgent.agents?.[0]?.id ?? '');
    expect(agentId).not.toBe('');

    const agentCall = sendTurnCalls.find((call) => call.lastMessage.includes('Investigate the repo structure'));
    expect(agentCall?.tools).toEqual(
      expect.arrayContaining(['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Skill', 'TodoWrite'])
    );
    expect(agentCall?.tools).not.toEqual(expect.arrayContaining(['Write', 'Edit', 'Bash', 'PowerShell']));

    const agentMessagesBeforeTaskOutput = engine.getSnapshot(session.id).messages.length;
    let taskOutputPhase = 0;
    provider.sendTurn = vi.fn(async function* () {
      if (taskOutputPhase === 0) {
        taskOutputPhase += 1;
        yield {
          type: 'tool_call',
          toolName: 'TaskOutput',
          input: {
            agent_id: agentId
          },
          reasoning: 'Need to inspect the completed background agent output.'
        } satisfies EngineModelEvent;
        yield {
          type: 'assistant_done'
        } satisfies EngineModelEvent;
        return;
      }

      yield {
        type: 'assistant_delta',
        text: 'The background agent found the repo structure successfully.'
      } satisfies EngineModelEvent;
      yield {
        type: 'assistant_done'
      } satisfies EngineModelEvent;
    });

    await engine.submitPrompt(session.id, 'What did the background agent find?');

    const afterTaskOutput = engine.getSnapshot(session.id);
    expect(afterTaskOutput.messages.length).toBeGreaterThan(agentMessagesBeforeTaskOutput);
    expect(afterTaskOutput.toolActivity).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolName: 'TaskOutput',
          status: 'completed',
          summary: expect.stringContaining(agentId)
        })
      ])
    );
  });

  it('continues a turn after approved background agents finish and merges their outputs', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'claude-oca-agent-continuation-'));
    let mainPhase = 0;

    const provider: EngineModelProvider = {
      async healthCheck() {
        return { ok: true, provider: 'fake', model: 'fake-model' };
      },
      async *sendTurn(messages) {
        const lastMessage = messages.at(-1)?.content ?? '';

        if (lastMessage.includes('"result_content"')) {
          yield {
            type: 'assistant_delta',
            text: 'Merged result: the diagnostics subagent found the root cause.'
          } satisfies EngineModelEvent;
          yield {
            type: 'assistant_done'
          } satisfies EngineModelEvent;
          return;
        }

        if (lastMessage.includes('Your previous response was not enough to complete this background task.')) {
          yield {
            type: 'tool_call',
            toolName: 'Glob',
            input: {
              pattern: '**/*.log'
            },
            reasoning: 'Need actual file evidence before returning a subagent result.'
          } satisfies EngineModelEvent;
          yield {
            type: 'assistant_delta',
            text: 'After inspecting the available logs, the subagent found the diagnostic root cause.'
          } satisfies EngineModelEvent;
          yield {
            type: 'assistant_done'
          } satisfies EngineModelEvent;
          return;
        }

        if (lastMessage.includes('Inspect the attached diagnostic log in a background agent')) {
          yield {
            type: 'assistant_delta',
            text: 'I’ll inspect the attached diagnostic log and summarize the root cause.'
          } satisfies EngineModelEvent;
          yield {
            type: 'assistant_done'
          } satisfies EngineModelEvent;
          return;
        }

        if (mainPhase === 0) {
          mainPhase += 1;
          yield {
            type: 'tool_call',
            toolName: 'Agent',
            input: {
              task: 'Inspect the attached diagnostic log in a background agent',
              subagent_type: 'diagnostics'
            },
            reasoning: 'Use a focused diagnostics subagent.'
          } satisfies EngineModelEvent;
          return;
        }

        if (lastMessage.includes('The background agents spawned for this turn have now settled.')) {
          const agentId = lastMessage.match(/- ([\w-]+) \(diagnostics, completed\):/)?.[1];
          expect(agentId).toBeTruthy();
          yield {
            type: 'tool_call',
            toolName: 'TaskOutput',
            input: {
              agent_id: agentId
            },
            reasoning: 'Read the completed diagnostics subagent output before answering.'
          } satisfies EngineModelEvent;
          return;
        }

        yield {
          type: 'assistant_done'
        } satisfies EngineModelEvent;
      },
      async cancelTurn() {}
    };

    const engine = createEngine({
      provider,
      executeTool: vi.fn(async () => ({
        summary: 'Glob matched diagnostic logs'
      }))
    });
    const session = engine.createSession({ cwd });

    await engine.submitPrompt(session.id, 'run subagents');
    const approval = engine.getPendingApprovals(session.id)[0];
    expect(approval).toMatchObject({
      toolName: 'Agent'
    });

    await engine.resolveApproval(session.id, approval!.requestId, {
      decision: 'allow'
    });

    const snapshot = engine.getSnapshot(session.id);
    expect(snapshot.agents).toEqual([
      expect.objectContaining({
        agentType: 'diagnostics',
        status: 'completed',
        resultSummary: expect.stringContaining('diagnostic root cause'),
        toolActivity: expect.arrayContaining([
          expect.objectContaining({
            toolName: 'Glob',
            status: 'completed'
          })
        ])
      })
    ]);
    expect(snapshot.toolActivity).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolName: 'TaskOutput',
          status: 'completed'
        })
      ])
    );
    expect(snapshot.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'assistant',
          content: 'Merged result: the diagnostics subagent found the root cause.'
        })
      ])
    );
  });
});
