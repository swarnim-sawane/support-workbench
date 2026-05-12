import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from './api';
import type { WorkbenchSessionSnapshot } from './types';
import { useWorkbench } from './useWorkbench';

vi.mock('./api', () => ({
  createSession: vi.fn(),
  deleteSession: vi.fn(),
  fetchHealth: vi.fn(),
  fetchSessions: vi.fn(),
  fetchSnapshot: vi.fn(),
  removeAttachment: vi.fn(),
  resolveApproval: vi.fn(),
  submitPrompt: vi.fn(),
  cancelTurn: vi.fn(),
  uploadAttachments: vi.fn()
}));

class MockEventSource {
  static instances: MockEventSource[] = [];
  onmessage: ((message: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();

  constructor(public url: string) {
    MockEventSource.instances.push(this);
  }
}

describe('useWorkbench', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockEventSource.instances = [];
    vi.stubGlobal('EventSource', MockEventSource);
    vi.mocked(api.fetchHealth).mockResolvedValue({
      ok: true,
      provider: 'oracle-code-assist',
      model: 'oca/gpt-5.4'
    });
    vi.mocked(api.fetchSessions).mockResolvedValue([]);
  });

  it('deletes the active chat and opens a fresh session', async () => {
    const activeSnapshot = buildSnapshot('session-active');
    const freshSnapshot = buildSnapshot('session-fresh');
    vi.mocked(api.createSession)
      .mockResolvedValueOnce({
        session: {
          id: 'session-active',
          cwd: 'C:/repo',
          status: 'idle'
        },
        snapshot: activeSnapshot
      })
      .mockResolvedValueOnce({
        session: {
          id: 'session-fresh',
          cwd: 'C:/repo',
          status: 'idle'
        },
        snapshot: freshSnapshot
      });
    vi.mocked(api.deleteSession).mockResolvedValue(undefined);

    const { result } = renderHook(() => useWorkbench());
    await waitFor(() => expect(result.current.activeSessionId).toBe('session-active'));

    act(() => {
      result.current.onQueueAttachment('att-1');
    });
    expect(result.current.queuedAttachmentIds).toEqual(['att-1']);

    await act(async () => {
      await result.current.onDeleteSession('session-active');
    });

    expect(api.deleteSession).toHaveBeenCalledWith('session-active', 'C:/repo');
    expect(MockEventSource.instances[0]?.close).toHaveBeenCalled();
    expect(api.createSession).toHaveBeenLastCalledWith({ cwd: 'C:/repo' });
    expect(result.current.activeSessionId).toBe('session-fresh');
    expect(result.current.snapshot.sessionId).toBe('session-fresh');
    expect(result.current.queuedAttachmentIds).toEqual([]);
  });

  it('cancels the active turn and applies the returned snapshot', async () => {
    const activeSnapshot = {
      ...buildSnapshot('session-active'),
      status: 'running' as const
    };
    const stoppedSnapshot = {
      ...buildSnapshot('session-active'),
      status: 'completed' as const,
      messages: [
        {
          id: 'message-stopped',
          role: 'system' as const,
          content: 'Run stopped by user.'
        }
      ]
    };
    vi.mocked(api.createSession).mockResolvedValueOnce({
      session: {
        id: 'session-active',
        cwd: 'C:/repo',
        status: 'running'
      },
      snapshot: activeSnapshot
    });
    vi.mocked(api.cancelTurn).mockResolvedValue(stoppedSnapshot);

    const { result } = renderHook(() => useWorkbench());
    await waitFor(() => expect(result.current.activeSessionId).toBe('session-active'));

    await act(async () => {
      await result.current.onCancelTurn();
    });

    expect(api.cancelTurn).toHaveBeenCalledWith('session-active');
    expect(result.current.snapshot.status).toBe('completed');
    expect(result.current.snapshot.messages.at(-1)?.content).toBe('Run stopped by user.');
  });
});

function buildSnapshot(sessionId: string): WorkbenchSessionSnapshot {
  return {
    sessionId,
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
    toolActivity: [],
    attachments: [],
    reports: {
      artifacts: []
    },
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
        tools: [],
        categories: [],
        toolDescriptors: []
      }
    }
  };
}
