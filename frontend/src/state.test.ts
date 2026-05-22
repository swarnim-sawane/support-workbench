import { afterEach, describe, expect, it, vi } from 'vitest';
import { reduceEngineEvent } from './state';
import type { WorkbenchSessionSnapshot } from './types';

const EMPTY_SNAPSHOT: WorkbenchSessionSnapshot = {
  sessionId: 'session-1',
  status: 'idle',
  messages: [],
  tasks: [],
  memory: {
    entries: []
  },
  history: {
    summaries: []
  },
  agents: [],
  skippedTools: [],
  reportSuggestion: null,
  pendingApprovals: [],
  progressActivity: [],
  attachments: [],
  reports: {
    artifacts: []
  },
  toolActivity: [],
  workspace: {
    cwd: 'C:/repo',
    changedFiles: [],
    diffs: []
  },
  commands: [],
  session: {
    branch: null
  },
  integrations: {
    skills: [],
    mcp: {
      available: false,
      servers: []
    },
    lsp: {
      available: false,
      note: 'Not configured'
    },
    jdMcp: {
      available: false,
      connected: false,
      note: 'Not configured',
      tools: [],
      categories: [],
      toolDescriptors: []
    }
  }
};

describe('reduceEngineEvent', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates assistant draft messages when crypto.randomUUID is unavailable', () => {
    vi.stubGlobal('crypto', {});

    const next = reduceEngineEvent(EMPTY_SNAPSHOT, {
      type: 'message.assistant.delta',
      sessionId: 'session-1',
      text: 'Hello'
    });

    expect(next.messages).toEqual([
      expect.objectContaining({
        id: expect.stringMatching(/^assistant-draft-/),
        role: 'assistant',
        content: 'Hello'
      })
    ]);
  });

  it('tracks and clears active turn start time from stream events', () => {
    const started = reduceEngineEvent(EMPTY_SNAPSHOT, {
      type: 'turn.started',
      sessionId: 'session-1',
      prompt: 'Analyze this log',
      startedAt: '2026-04-24T00:00:00.000Z'
    });

    expect(started.status).toBe('running');
    expect(started.session.activeTurnStartedAt).toBe('2026-04-24T00:00:00.000Z');

    const completed = reduceEngineEvent(started, {
      type: 'turn.completed',
      sessionId: 'session-1',
      status: 'completed'
    });

    expect(completed.status).toBe('completed');
    expect(completed.session.activeTurnStartedAt).toBeUndefined();
  });

  it('preserves leaked tool names and metadata in approvals and transcript messages', () => {
    const awaitingApproval = reduceEngineEvent(EMPTY_SNAPSHOT, {
      type: 'permission.requested',
      sessionId: 'session-1',
      requestId: 'req-1',
      toolUseId: 'toolu_1',
      toolName: 'PowerShell',
      input: {
        command: 'Get-ChildItem'
      },
      reasoning: 'Inspect the current directory.'
    });

    expect(awaitingApproval.pendingApprovals).toEqual([
      expect.objectContaining({
        requestId: 'req-1',
        toolUseId: 'toolu_1',
        toolName: 'PowerShell',
        input: {
          command: 'Get-ChildItem'
        },
        reasoning: 'Inspect the current directory.'
      })
    ]);

    const completed = reduceEngineEvent(awaitingApproval, {
      type: 'tool.execution.started',
      sessionId: 'session-1',
      requestId: 'req-1',
      toolUseId: 'toolu_1',
      toolName: 'Write',
      source: 'builtin',
      input: {
        file_path: 'README.md'
      }
    });

    expect(completed.pendingApprovals).toEqual([]);
    expect(completed.toolActivity).toEqual([
      expect.objectContaining({
        requestId: 'req-1',
        toolName: 'Write',
        status: 'running'
      })
    ]);

    const settled = reduceEngineEvent(completed, {
      type: 'tool.execution.completed',
      sessionId: 'session-1',
      requestId: 'req-1',
      toolUseId: 'toolu_1',
      toolName: 'Write',
      source: 'builtin',
      summary: 'Wrote README.md'
    });

    expect(settled.messages.at(-1)?.content).toContain('Write: Wrote README.md');
    expect(settled.toolActivity).toEqual([
      expect.objectContaining({
        requestId: 'req-1',
        toolName: 'Write',
        status: 'completed',
        summary: 'Wrote README.md'
      })
    ]);
  });

  it('updates tasks and history summaries from Claude Code style runtime events', () => {
    const taskSnapshot = reduceEngineEvent(EMPTY_SNAPSHOT, {
      type: 'task.updated',
      sessionId: 'session-1',
      tasks: [
        {
          id: 'task-1',
          content: 'Audit runtime parity',
          status: 'pending'
        }
      ]
    });

    expect(taskSnapshot.tasks).toEqual([
      {
        id: 'task-1',
        content: 'Audit runtime parity',
        status: 'pending'
      }
    ]);

    const compacted = reduceEngineEvent(taskSnapshot, {
      type: 'history.compacted',
      sessionId: 'session-1',
      summary: {
        id: 'summary-1',
        title: 'Session summary',
        preview: 'Condensed context',
        transcript: ['user: /compact'],
        openTasks: [],
        rememberedNotes: [],
        changedFiles: [],
        createdAt: '2026-04-23T00:00:00.000Z'
      }
    });

    expect(compacted.history.summaries).toEqual([
      {
        id: 'summary-1',
        title: 'Session summary',
        preview: 'Condensed context',
        transcript: ['user: /compact'],
        openTasks: [],
        rememberedNotes: [],
        changedFiles: [],
        createdAt: '2026-04-23T00:00:00.000Z'
      }
    ]);
    expect(compacted.messages.at(-1)?.content).toContain('/compact');
  });

  it('renders command errors as distinct system transcript entries', () => {
    const errored = reduceEngineEvent(EMPTY_SNAPSHOT, {
      type: 'command.error',
      sessionId: 'session-1',
      commandName: '/commads',
      message: 'Unknown slash command /commads.',
      suggestions: ['/commands']
    });

    expect(errored.messages.at(-1)).toMatchObject({
      role: 'system',
      kind: 'command-error'
    });
    expect(errored.messages.at(-1)?.content).toContain('/commands');
  });

  it('tracks attachment add and remove events from the runtime stream', () => {
    const withAttachment = reduceEngineEvent(EMPTY_SNAPSHOT, {
      type: 'attachment.added',
      sessionId: 'session-1',
      attachment: {
        id: 'att-1',
        originalName: 'trace.log',
        storedName: 'trace.log',
        mediaType: 'text/plain',
        kind: 'text',
        localPath: 'C:/repo/.claude-oca/uploads/session-1/trace.log',
        size: 64,
        promptVisibility: 'available',
        ocrStatus: 'unavailable',
        uploadedAt: '2026-04-24T00:00:00.000Z'
      }
    });

    expect(withAttachment.attachments).toEqual([
      expect.objectContaining({
        id: 'att-1',
        originalName: 'trace.log'
      })
    ]);

    const removed = reduceEngineEvent(withAttachment, {
      type: 'attachment.removed',
      sessionId: 'session-1',
      attachmentId: 'att-1'
    });

    expect(removed.attachments).toEqual([
      expect.objectContaining({
        id: 'att-1',
        promptVisibility: 'removed'
      })
    ]);
  });

  it('tracks generated specialized HTML report artifacts separately from attachments', () => {
    const next = reduceEngineEvent(EMPTY_SNAPSHOT as typeof EMPTY_SNAPSHOT & Record<string, unknown>, {
      type: 'report.generated',
      sessionId: 'session-1',
      artifacts: [
        {
          id: 'report-1',
          requestId: 'req-1',
          toolName: 'analyze_adf_logs',
          source: 'jd-mcp',
          kind: 'html-report',
          title: 'ADF Log Review',
          filePath: 'C:/repo/reports/adflr-report.html',
          fileName: 'adflr-report.html',
          createdAt: '2026-04-24T00:00:00.000Z',
          size: 512
        }
      ]
    } as never) as typeof EMPTY_SNAPSHOT & {
      reports?: {
        artifacts: Array<Record<string, unknown>>;
      };
    };

    expect(next.reports?.artifacts).toEqual([
      expect.objectContaining({
        id: 'report-1',
        toolName: 'analyze_adf_logs',
        source: 'jd-mcp'
      })
    ]);
    expect(next.attachments).toEqual([]);
  });

  it('marks denied and failed tool executions distinctly in tool activity', () => {
    const started = reduceEngineEvent(EMPTY_SNAPSHOT, {
      type: 'tool.execution.started',
      sessionId: 'session-1',
      requestId: 'req-2',
      toolUseId: 'toolu_2',
      toolName: 'analyze_adf_logs',
      source: 'jd-mcp',
      category: 'reports',
      producesReports: true,
      input: {
        log_folder: 'C:/logs'
      }
    });

    const failed = reduceEngineEvent(started, {
      type: 'tool.execution.failed',
      sessionId: 'session-1',
      requestId: 'req-2',
      toolUseId: 'toolu_2',
      toolName: 'analyze_adf_logs',
      source: 'jd-mcp',
      category: 'reports',
      producesReports: true,
      error: 'jdtools.jar missing'
    });

    expect(failed.toolActivity).toEqual([
      expect.objectContaining({
        requestId: 'req-2',
        status: 'failed',
        error: 'jdtools.jar missing'
      })
    ]);
  });

  it('tracks concise progress activity from runtime progress events', () => {
    const started = reduceEngineEvent(EMPTY_SNAPSHOT, {
      type: 'progress.started',
      sessionId: 'session-1',
      id: 'progress-1',
      phase: 'attachments.classifying',
      label: 'Classifying uploaded files',
      detail: '2 logs, 1 text file',
      status: 'running',
      startedAt: '2026-04-24T00:00:00.000Z'
    });

    expect(started.progressActivity).toEqual([
      expect.objectContaining({
        id: 'progress-1',
        phase: 'attachments.classifying',
        label: 'Classifying uploaded files',
        detail: '2 logs, 1 text file',
        status: 'running'
      })
    ]);

    const completed = reduceEngineEvent(started, {
      type: 'progress.completed',
      sessionId: 'session-1',
      id: 'progress-1',
      phase: 'attachments.classifying',
      label: 'Classifying uploaded files',
      detail: '2 logs, 1 text file',
      status: 'completed',
      startedAt: '2026-04-24T00:00:00.000Z',
      completedAt: '2026-04-24T00:00:01.000Z'
    });

    expect(completed.progressActivity).toEqual([
      expect.objectContaining({
        id: 'progress-1',
        status: 'completed',
        completedAt: '2026-04-24T00:00:01.000Z'
      })
    ]);
  });

  it('clears stale report suggestions when a report-producing tool fails', () => {
    const snapshotWithSuggestion: WorkbenchSessionSnapshot = {
      ...EMPTY_SNAPSHOT,
      reportSuggestion: {
        available: true,
        canRun: true,
        suggestedToolName: 'analyze_adf_logs',
        source: 'jd-mcp',
        explanation: 'This turn used direct file analysis.',
        attachmentIds: ['att-log'],
        input: {
          log_folder: 'C:/logs'
        },
        reasonCode: 'builtin_better_for_single_file'
      }
    };

    const failed = reduceEngineEvent(snapshotWithSuggestion, {
      type: 'tool.execution.failed',
      sessionId: 'session-1',
      requestId: 'req-report-failed',
      toolUseId: 'toolu_report_failed',
      toolName: 'analyze_adf_logs',
      source: 'jd-mcp',
      category: 'reports',
      producesReports: true,
      error: 'Analyzer crashed'
    });

    expect(failed.reportSuggestion).toBeNull();
  });

  it('does not mark the session blocked for recoverable tool failures', () => {
    const started = reduceEngineEvent(
      {
        ...EMPTY_SNAPSHOT,
        status: 'running'
      },
      {
        type: 'tool.execution.started',
        sessionId: 'session-1',
        requestId: 'req-recoverable',
        toolUseId: 'toolu_recoverable',
        toolName: 'Grep',
        source: 'builtin',
        category: 'search',
        input: {
          pattern: '('
        }
      }
    );

    const failed = reduceEngineEvent(started, {
      type: 'tool.execution.failed',
      sessionId: 'session-1',
      requestId: 'req-recoverable',
      toolUseId: 'toolu_recoverable',
      toolName: 'Grep',
      source: 'builtin',
      category: 'search',
      error: 'Invalid Grep regular expression',
      recoverable: true,
      recoveryAttempt: 1,
      recoveryInstruction: 'Use a simpler pattern',
      metadata: {
        recoverable: true,
        recoveryAttempt: 1,
        recoveryInstruction: 'Use a simpler pattern'
      }
    });

    expect(failed.status).toBe('running');
    expect(failed.toolActivity).toEqual([
      expect.objectContaining({
        requestId: 'req-recoverable',
        status: 'failed',
        recoverable: true,
        recoveryAttempt: 1,
        recoveryInstruction: 'Use a simpler pattern'
      })
    ]);
  });

  it('stores background agent lifecycle events without polluting transcript messages', () => {
    const next = reduceEngineEvent(EMPTY_SNAPSHOT, {
      type: 'agent.completed',
      sessionId: 'session-1',
      agent: {
        id: 'agent-1',
        parentSessionId: 'session-1',
        parentToolUseId: 'toolu_agent_1',
        agentType: 'research',
        status: 'completed',
        prompt: 'Inspect the repo structure',
        messages: [
          {
            id: 'agent-message-1',
            role: 'assistant',
            content: 'I inspected the repo structure.'
          }
        ],
        toolActivity: [],
        resultSummary: 'I inspected the repo structure.',
        resultContent: 'I inspected the repo structure.',
        createdAt: '2026-04-24T00:00:00.000Z',
        updatedAt: '2026-04-24T00:01:00.000Z',
        completedAt: '2026-04-24T00:01:00.000Z'
      }
    });

    expect(next.agents).toEqual([
      expect.objectContaining({
        id: 'agent-1',
        agentType: 'research',
        status: 'completed',
        resultSummary: 'I inspected the repo structure.'
      })
    ]);
    expect(next.messages).toEqual([]);
  });
});
