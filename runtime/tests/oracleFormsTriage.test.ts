import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createEngine } from '../src/index.js';
import type {
  EngineEvent,
  EngineModelEvent,
  EngineModelProvider,
  EngineToolExecutionResult
} from '../src/types.js';

describe('Oracle Forms Support Triage Autonomous Flow', () => {
  let cwd: string;
  let ocaProvider: EngineModelProvider;
  const originalAutoApprove = process.env.AUTO_APPROVE_TOOLS;
  const originalOracleFormsTriage = process.env.ORACLE_FORMS_TRIAGE;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'claude-oca-triage-test-'));
    process.env.AUTO_APPROVE_TOOLS = 'true';
    process.env.ORACLE_FORMS_TRIAGE = 'true';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env.AUTO_APPROVE_TOOLS = originalAutoApprove;
    process.env.ORACLE_FORMS_TRIAGE = originalOracleFormsTriage;
  });

  it('detects an Oracle Forms session, loads guide prompts, and auto-initializes folders and tasks', async () => {
    // Create a mock skills folder structure in the workspace to test guides loading
    const skillsDir = resolve(cwd, '.agents/skills/oracle-forms-support-triage');
    mkdirSync(resolve(skillsDir, 'references'), { recursive: true });
    mkdirSync(resolve(skillsDir, 'assets/case_template'), { recursive: true });
    
    // Write fake guide markdown files
    writeFileSync(resolve(skillsDir, 'oracle_forms_runtime_analysis_prompt.md'), '# Main Guide');
    writeFileSync(resolve(skillsDir, 'references/customer_intake.md'), '# Intake Reference');
    writeFileSync(resolve(skillsDir, 'references/artifact_map.md'), '# Artifact Map Reference');
    writeFileSync(resolve(skillsDir, 'references/output_format.md'), '# Output Format Reference');
    writeFileSync(resolve(skillsDir, 'assets/case_template/README.md'), 'Welcome to Oracle Forms Triage Template');

    const capturedTurns: { systemPrompt: string }[] = [];

    const provider: EngineModelProvider = {
      async healthCheck() {
        return { ok: true, provider: 'fake', model: 'fake-model' };
      },
      async *sendTurn(_messages, options) {
        capturedTurns.push({ systemPrompt: options.systemPrompt });
        yield {
          type: 'assistant_delta',
          text: 'Triage initialized.'
        } satisfies EngineModelEvent;
        yield {
          type: 'assistant_done'
        } satisfies EngineModelEvent;
      },
      async cancelTurn() {}
    };

    const engine = createEngine({
      provider,
      executeTool: vi.fn()
    });

    const session = engine.createSession({ cwd });
    
    // Attach an intake log file
    const attachmentPath = resolve(cwd, 'test-diagnostic.log');
    writeFileSync(attachmentPath, 'FRM-92101 server crashed');
    
    engine.addAttachment(session.id, {
      id: 'att-diag-log',
      originalName: 'test-diagnostic.log',
      storedName: 'test-diagnostic.log',
      mediaType: 'text/plain',
      kind: 'text',
      localPath: attachmentPath,
      size: 26,
      promptVisibility: 'available',
      ocrStatus: 'unavailable',
      uploadedAt: new Date().toISOString()
    });

    await engine.submitPrompt(session.id, 'Help triage for customer Acme with case 3-123456789', {
      attachmentIds: ['att-diag-log']
    });

    // Check system prompt injection
    expect(capturedTurns.length).toBe(1);
    expect(capturedTurns[0]?.systemPrompt).toContain('Oracle Forms Support Triage Guidelines');
    expect(capturedTurns[0]?.systemPrompt).toContain('# Main Guide');
    expect(capturedTurns[0]?.systemPrompt).toContain('# Intake Reference');
    expect(capturedTurns[0]?.systemPrompt).toContain('# Artifact Map Reference');
    expect(capturedTurns[0]?.systemPrompt).toContain('# Output Format Reference');

    // Check folder structure initialization
    const caseFolder = resolve(cwd, 'customers/Acme/3-123456789');
    expect(existsSync(caseFolder)).toBe(true);
    expect(existsSync(resolve(caseFolder, '00_intake/test-diagnostic.log'))).toBe(true);
    expect(existsSync(resolve(caseFolder, 'README.md'))).toBe(true); // Copied to case template root

    // Check tasks list auto-setup
    const snapshot = engine.getSnapshot(session.id);
    expect(snapshot.tasks.length).toBe(5);
    expect(snapshot.tasks[0]?.content).toContain('Initialize customer workspace folder');
    expect(snapshot.tasks[0]?.status).toBe('completed');
    expect(snapshot.tasks[1]?.status).toBe('pending');
  });

  it('parses and executes assistant slash commands in assistant messages', async () => {
    const provider: EngineModelProvider = {
      async healthCheck() {
        return { ok: true, provider: 'fake', model: 'fake-model' };
      },
      async *sendTurn() {
        yield {
          type: 'assistant_delta',
          text: 'Updating tasks.\n/tasks add Run JVM analysis\n/memory remember Check classpaths'
        } satisfies EngineModelEvent;
        yield {
          type: 'assistant_done'
        } satisfies EngineModelEvent;
      },
      async cancelTurn() {}
    };

    const engine = createEngine({
      provider,
      executeTool: vi.fn()
    });

    const session = engine.createSession({ cwd });
    await engine.submitPrompt(session.id, 'Let us start triage');

    const snapshot = engine.getSnapshot(session.id);
    
    // Check that tasks have been updated
    const task = snapshot.tasks.find((t) => t.content === 'Run JVM analysis');
    expect(task).toBeDefined();
    expect(task?.status).toBe('pending');

    // Check that memory has been updated
    const memory = snapshot.memory.entries.find((m) => m.content === 'Check classpaths');
    expect(memory).toBeDefined();
  });

  it('runs autonomously in a continuous loop when AUTO_APPROVE_TOOLS is true', async () => {
    let turnCount = 0;
    const provider: EngineModelProvider = {
      async healthCheck() {
        return { ok: true, provider: 'fake', model: 'fake-model' };
      },
      async *sendTurn() {
        turnCount += 1;
        if (turnCount === 1) {
          yield {
            type: 'assistant_delta',
            text: 'Let me read the log.'
          } satisfies EngineModelEvent;
          yield {
            type: 'tool_call',
            toolName: 'Read',
            input: {
              file_path: 'test.log'
            },
            reasoning: 'Need to inspect the log contents.'
          } satisfies EngineModelEvent;
          return;
        }

        if (turnCount === 2) {
          yield {
            type: 'assistant_delta',
            text: 'Now let me run a command.'
          } satisfies EngineModelEvent;
          yield {
            type: 'tool_call',
            toolName: 'PowerShell',
            input: {
              command: 'echo Done'
            },
            reasoning: 'Running a status check command.'
          } satisfies EngineModelEvent;
          return;
        }

        yield {
          type: 'assistant_delta',
          text: 'Triage complete. The server crashed due to JVM out of memory.'
        } satisfies EngineModelEvent;
        yield {
          type: 'assistant_done'
        } satisfies EngineModelEvent;
      },
      async cancelTurn() {}
    };

    const executeTool = vi.fn(async ({ toolName }) => {
      if (toolName === 'Read') {
        return {
          summary: 'Read test.log successfully',
          metadata: { content: 'FRM-92101' }
        };
      }
      return {
        summary: 'Command ran successfully',
        metadata: { stdout: 'Done' }
      };
    });

    const engine = createEngine({
      provider,
      executeTool
    });

    const session = engine.createSession({ cwd });
    writeFileSync(resolve(cwd, 'test.log'), 'FRM-92101');

    await engine.submitPrompt(session.id, 'Triage the log');

    const snapshot = engine.getSnapshot(session.id);
    expect(snapshot.status).toBe('completed');
    expect(turnCount).toBe(3);
    expect(executeTool).toHaveBeenCalledTimes(2);
  });
});
