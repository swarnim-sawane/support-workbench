import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from './api';
import type { WorkbenchSessionSnapshot, WorkbenchSessionSummary } from './types';
import { resetWorkbenchBootstrapForTests, useWorkbench } from './useWorkbench';

vi.mock('./api', () => ({
  createSession: vi.fn(),
  deleteSession: vi.fn(),
  fetchHealth: vi.fn(),
  fetchSessions: vi.fn(),
  fetchSnapshot: vi.fn(),
  removeAttachment: vi.fn(),
  resolveApproval: vi.fn(),
  submitPrompt: vi.fn(),
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
    resetWorkbenchBootstrapForTests();
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

  it('deduplicates and sorts session history snapshots by most recent activity', async () => {
    const activeSnapshot = buildSnapshot('session-active');
    vi.mocked(api.createSession).mockResolvedValue({
      session: {
        id: 'session-active',
        cwd: 'C:/repo',
        status: 'idle'
      },
      snapshot: activeSnapshot
    });
    vi.mocked(api.fetchSessions).mockResolvedValue([
      buildSessionSummary('session-old', '2026-04-24T10:00:00.000Z'),
      buildSessionSummary('session-active', '2026-04-24T09:00:00.000Z', {
        title: 'Older active duplicate'
      }),
      buildSessionSummary('session-active', '2026-04-24T12:00:00.000Z', {
        title: 'Latest active'
      }),
      buildSessionSummary('session-middle', '2026-04-24T11:00:00.000Z')
    ]);

    const { result } = renderHook(() => useWorkbench());

    await waitFor(() =>
      expect(result.current.sessions.map((session) => session.id)).toEqual([
        'session-active',
        'session-middle',
        'session-old'
      ])
    );
    expect(result.current.sessions[0]?.title).toBe('Latest active');
  });

  it('creates only one chat when new chat is requested repeatedly before the first request settles', async () => {
    const activeSnapshot = buildSnapshot('session-active');
    const freshSnapshot = buildSnapshot('session-fresh');
    let finishNewSession!: () => void;
    vi.mocked(api.createSession)
      .mockResolvedValueOnce({
        session: {
          id: 'session-active',
          cwd: 'C:/repo',
          status: 'idle'
        },
        snapshot: activeSnapshot
      })
      .mockImplementationOnce(async () => {
        await new Promise<void>((resolve) => {
          finishNewSession = resolve;
        });
        return {
          session: {
            id: 'session-fresh',
            cwd: 'C:/repo',
            status: 'idle'
          },
          snapshot: freshSnapshot
        };
      });

    const { result } = renderHook(() => useWorkbench());
    await waitFor(() => expect(result.current.activeSessionId).toBe('session-active'));

    let firstNewSession!: Promise<void>;
    let secondNewSession!: Promise<void>;
    act(() => {
      firstNewSession = result.current.onNewSession() as Promise<void>;
      secondNewSession = result.current.onNewSession() as Promise<void>;
    });

    await act(async () => {
      finishNewSession();
      await Promise.all([firstNewSession, secondNewSession]);
    });

    expect(api.createSession).toHaveBeenCalledTimes(2);
    expect(result.current.activeSessionId).toBe('session-fresh');
    expect(result.current.sessions.map((session) => session.id)).toEqual(['session-fresh']);
  });

  it('switches to an existing chat only once when selection is requested repeatedly', async () => {
    const activeSnapshot = buildSnapshot('session-active');
    const existingSnapshot = buildSnapshot('session-existing');
    let finishSelectSession!: () => void;
    vi.mocked(api.createSession)
      .mockResolvedValueOnce({
        session: {
          id: 'session-active',
          cwd: 'C:/repo',
          status: 'idle'
        },
        snapshot: activeSnapshot
      })
      .mockImplementationOnce(async () => {
        await new Promise<void>((resolve) => {
          finishSelectSession = resolve;
        });
        return {
          session: {
            id: 'session-existing',
            cwd: 'C:/repo',
            status: 'completed'
          },
          snapshot: existingSnapshot
        };
      });
    vi.mocked(api.fetchSessions).mockResolvedValue([
      buildSessionSummary('session-active', '2026-04-24T10:00:00.000Z'),
      buildSessionSummary('session-existing', '2026-04-24T11:00:00.000Z')
    ]);

    const { result } = renderHook(() => useWorkbench());
    await waitFor(() => expect(result.current.activeSessionId).toBe('session-active'));

    let firstSelect!: Promise<void>;
    let secondSelect!: Promise<void>;
    act(() => {
      firstSelect = result.current.onSelectSession('session-existing') as Promise<void>;
      secondSelect = result.current.onSelectSession('session-existing') as Promise<void>;
    });

    await act(async () => {
      finishSelectSession();
      await Promise.all([firstSelect, secondSelect]);
    });

    expect(api.createSession).toHaveBeenCalledTimes(2);
    expect(api.createSession).toHaveBeenLastCalledWith({
      cwd: 'C:/repo',
      sessionId: 'session-existing'
    });
    expect(result.current.activeSessionId).toBe('session-existing');
    expect(result.current.sessions.map((session) => session.id)).toEqual([
      'session-existing',
      'session-active'
    ]);
  });

  it('moves a selected existing chat to the top without duplicating an older history row', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-04-24T10:05:00.000Z'));
    try {
      const activeSnapshot = buildSnapshot('session-active');
      const existingSnapshot = buildSnapshot('session-existing');
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
            id: 'session-existing',
            cwd: 'C:/repo',
            status: 'idle'
          },
          snapshot: existingSnapshot
        });
      vi.mocked(api.fetchSessions).mockResolvedValue([
        buildSessionSummary('session-active', '2026-04-24T10:00:00.000Z'),
        buildSessionSummary('session-existing', '2026-04-24T09:00:00.000Z')
      ]);

      const { result } = renderHook(() => useWorkbench());
      await waitFor(() => expect(result.current.activeSessionId).toBe('session-active'));
      await waitFor(() =>
        expect(result.current.sessions.map((session) => session.id)).toEqual([
          'session-active',
          'session-existing'
        ])
      );

      await act(async () => {
        await result.current.onSelectSession('session-existing');
      });

      expect(result.current.activeSessionId).toBe('session-existing');
      expect(result.current.sessions.map((session) => session.id)).toEqual([
        'session-existing',
        'session-active'
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('tracks attachment uploads from uploading to processing to ready', async () => {
    const activeSnapshot = buildSnapshot('session-active');
    const uploadedAttachment = {
      id: 'att-uploaded',
      originalName: 'trace.log',
      storedName: 'trace.log',
      mediaType: 'text/plain',
      kind: 'text',
      localPath: 'C:/repo/.claude-oca/uploads/session-active/trace.log',
      size: 1024,
      promptVisibility: 'available',
      ocrStatus: 'unavailable',
      uploadedAt: '2026-04-24T00:00:00.000Z'
    } as const;
    const snapshotWithAttachment: WorkbenchSessionSnapshot = {
      ...activeSnapshot,
      attachments: [uploadedAttachment]
    };
    let finishUpload!: () => void;

    vi.mocked(api.createSession).mockResolvedValue({
      session: {
        id: 'session-active',
        cwd: 'C:/repo',
        status: 'idle'
      },
      snapshot: activeSnapshot
    });
    vi.mocked(api.uploadAttachments).mockImplementation(async (_sessionId, _files, onProgress) => {
      onProgress?.({
        phase: 'uploading',
        loaded: 512,
        total: 1024,
        percent: 50
      });
      onProgress?.({
        phase: 'processing',
        loaded: 1024,
        total: 1024,
        percent: 100
      });
      await new Promise<void>((resolve) => {
        finishUpload = resolve;
      });
      return {
        attachments: [uploadedAttachment],
        snapshot: snapshotWithAttachment
      };
    });

    const { result } = renderHook(() => useWorkbench());
    await waitFor(() => expect(result.current.activeSessionId).toBe('session-active'));

    const file = new File(['trace data'], 'trace.log', { type: 'text/plain' });
    let attachPromise!: Promise<void>;
    act(() => {
      attachPromise = result.current.onAttachFiles([file]) as Promise<void>;
    });

    await waitFor(() =>
      expect(result.current.uploadItems).toEqual([
        expect.objectContaining({
          name: 'trace.log',
          stage: 'processing',
          progress: 100,
          message: 'Processing OCR and indexing'
        })
      ])
    );

    await act(async () => {
      finishUpload();
      await attachPromise;
    });

    expect(api.uploadAttachments).toHaveBeenCalledWith('session-active', [file], expect.any(Function));
    expect(result.current.uploadItems).toEqual([
      expect.objectContaining({
        name: 'trace.log',
        stage: 'ready',
        progress: 100,
        message: 'Ready for analysis'
      })
    ]);
    expect(result.current.snapshot.attachments).toEqual([uploadedAttachment]);
    expect(result.current.queuedAttachmentIds).toEqual(['att-uploaded']);
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
    progressActivity: [],
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

function buildSessionSummary(
  id: string,
  updatedAt: string,
  overrides: Partial<WorkbenchSessionSummary> = {}
): WorkbenchSessionSummary {
  return {
    id,
    title: id,
    preview: 'Preview',
    status: 'idle',
    cwd: 'C:/repo',
    createdAt: '2026-04-24T08:00:00.000Z',
    updatedAt,
    messageCount: 0,
    attachmentCount: 0,
    reportCount: 0,
    ...overrides
  };
}
