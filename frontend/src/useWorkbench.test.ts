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
