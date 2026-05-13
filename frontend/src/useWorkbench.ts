import { startTransition, useEffect, useRef, useState } from 'react';
import {
  createSession,
  deleteSession as deleteSessionApi,
  fetchHealth,
  fetchSessions,
  fetchSnapshot,
  removeAttachment,
  resolveApproval,
  submitPrompt,
  uploadAttachments
} from './api';
import { reduceEngineEvent } from './state';
import type {
  WorkbenchHealth,
  WorkbenchSessionSnapshot,
  WorkbenchSessionSummary,
  WorkbenchUploadItem,
  WorkbenchUploadProgressUpdate
} from './types';

const EMPTY_SNAPSHOT: WorkbenchSessionSnapshot = {
  sessionId: '',
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
    cwd: '',
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

export function useWorkbench() {
  const [snapshot, setSnapshot] = useState<WorkbenchSessionSnapshot>(EMPTY_SNAPSHOT);
  const [health, setHealth] = useState<WorkbenchHealth>({
    ok: false,
    provider: 'oracle-code-assist',
    model: null
  });
  const [isBooting, setIsBooting] = useState(true);
  const [isSwitchingSession, setIsSwitchingSession] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queuedAttachmentIds, setQueuedAttachmentIds] = useState<string[]>([]);
  const [uploadItems, setUploadItems] = useState<WorkbenchUploadItem[]>([]);
  const [sessions, setSessions] = useState<WorkbenchSessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  function connectSession(sessionId: string): EventSource {
    eventSourceRef.current?.close();
    const eventSource = new EventSource(`/api/session/${sessionId}/stream`);
    eventSource.onmessage = (message) => {
      const event = JSON.parse(message.data);
      startTransition(() => {
        setSnapshot((current) => reduceEngineEvent(current, event));
      });
    };
    eventSource.onerror = async () => {
      try {
        const refreshed = await fetchSnapshot(sessionId);
        setSnapshot(refreshed);
      } catch (refreshError) {
        setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
      }
    };
    eventSourceRef.current = eventSource;
    return eventSource;
  }

  async function refreshSessions(cwd?: string) {
    try {
      setSessions(await fetchSessions(cwd));
    } catch (sessionsError) {
      setError(sessionsError instanceof Error ? sessionsError.message : String(sessionsError));
    }
  }

  useEffect(() => {
    let cancelled = false;
    let eventSource: EventSource | null = null;

    async function bootstrap() {
      try {
        const [sessionResponse, initialHealth] = await Promise.all([
          createSession(),
          fetchHealth()
        ]);

        if (cancelled) {
          return;
        }

        setHealth(initialHealth);
        setSnapshot(sessionResponse.snapshot);
        setActiveSessionId(sessionResponse.session.id);
        setIsBooting(false);
        void refreshSessions(sessionResponse.session.cwd);

        eventSource = connectSession(sessionResponse.session.id);
      } catch (bootstrapError) {
        if (!cancelled) {
          setError(bootstrapError instanceof Error ? bootstrapError.message : String(bootstrapError));
          setIsBooting(false);
        }
      }
    }

    void bootstrap();

    return () => {
      cancelled = true;
      eventSource?.close();
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
    };
  }, []);

  return {
    snapshot,
    sessions,
    activeSessionId,
    queuedAttachmentIds,
    uploadItems,
    health,
    isBooting: isBooting || isSwitchingSession,
    error,
    async onNewSession() {
      const cwd = snapshot.workspace.cwd || undefined;
      setIsSwitchingSession(true);
      setError(null);
      try {
        const response = await createSession({ cwd });
        setSnapshot(response.snapshot);
        setQueuedAttachmentIds([]);
        setUploadItems([]);
        setActiveSessionId(response.session.id);
        connectSession(response.session.id);
        await refreshSessions(response.session.cwd);
      } catch (newSessionError) {
        setError(newSessionError instanceof Error ? newSessionError.message : String(newSessionError));
      } finally {
        setIsSwitchingSession(false);
      }
    },
    async onSelectSession(sessionId: string) {
      if (sessionId === activeSessionId) {
        return;
      }
      const cwd = snapshot.workspace.cwd || undefined;
      setIsSwitchingSession(true);
      setError(null);
      try {
        const response = await createSession({ cwd, sessionId });
        setSnapshot(response.snapshot);
        setQueuedAttachmentIds([]);
        setUploadItems([]);
        setActiveSessionId(response.session.id);
        connectSession(response.session.id);
        await refreshSessions(response.session.cwd);
      } catch (selectError) {
        setError(selectError instanceof Error ? selectError.message : String(selectError));
      } finally {
        setIsSwitchingSession(false);
      }
    },
    async onDeleteSession(sessionId: string) {
      const cwd = snapshot.workspace.cwd || undefined;
      const isActiveDelete = sessionId === activeSessionId;
      setIsSwitchingSession(true);
      setError(null);
      try {
        await deleteSessionApi(sessionId, cwd);
        if (isActiveDelete) {
          eventSourceRef.current?.close();
          eventSourceRef.current = null;
          const response = await createSession({ cwd });
          setSnapshot(response.snapshot);
          setQueuedAttachmentIds([]);
          setUploadItems([]);
          setActiveSessionId(response.session.id);
          connectSession(response.session.id);
          await refreshSessions(response.session.cwd);
          return;
        }

        await refreshSessions(cwd);
      } catch (deleteError) {
        setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
      } finally {
        setIsSwitchingSession(false);
      }
    },
    async onPromptSubmit(prompt: string, attachmentIds: string[] = queuedAttachmentIds) {
      const trimmed = prompt.trim();
      if (!trimmed || !snapshot.sessionId) {
        return;
      }

      const response = await submitPrompt(snapshot.sessionId, trimmed, attachmentIds);
      setSnapshot(response.snapshot);
      setQueuedAttachmentIds([]);
      void refreshSessions(response.snapshot.workspace.cwd);
    },
    async onApprove(requestId: string, decision: 'allow' | 'deny') {
      if (!snapshot.sessionId) {
        return;
      }

      const pending = snapshot.pendingApprovals.find((approval) => approval.requestId === requestId);
      const nextSnapshot = await resolveApproval(snapshot.sessionId, requestId, decision, pending);
      setSnapshot(nextSnapshot);
    },
    async onAttachFiles(files: File[]) {
      if (!snapshot.sessionId || !files.length) {
        return;
      }

      const uploadBatch = createUploadItems(files);
      const uploadIds = new Set(uploadBatch.map((item) => item.id));
      setError(null);
      setUploadItems((current) => [
        ...current.filter((item) => item.stage !== 'ready'),
        ...uploadBatch
      ]);

      try {
        const response = await uploadAttachments(snapshot.sessionId, files, (progress) => {
          setUploadItems((current) => updateUploadProgress(current, uploadIds, progress));
        });
        setSnapshot(response.snapshot);
        setQueuedAttachmentIds((current) =>
          Array.from(new Set([...current, ...response.attachments.map((attachment) => attachment.id)]))
        );
        setUploadItems((current) => markUploadBatchReady(current, uploadIds));
        void refreshSessions(response.snapshot.workspace.cwd);
      } catch (uploadError) {
        const message = uploadError instanceof Error ? uploadError.message : String(uploadError);
        setError(message);
        setUploadItems((current) => markUploadBatchFailed(current, uploadIds, message));
      }
    },
    async onRemoveAttachment(attachmentId: string) {
      if (!snapshot.sessionId) {
        return;
      }

      const response = await removeAttachment(snapshot.sessionId, attachmentId);
      setSnapshot(response.snapshot);
      setQueuedAttachmentIds((current) => current.filter((id) => id !== attachmentId));
      void refreshSessions(response.snapshot.workspace.cwd);
    },
    onQueueAttachment(attachmentId: string) {
      setQueuedAttachmentIds((current) =>
        current.includes(attachmentId) ? current : [...current, attachmentId]
      );
    },
    onUnqueueAttachment(attachmentId: string) {
      setQueuedAttachmentIds((current) => current.filter((id) => id !== attachmentId));
    }
  };
}

function createUploadItems(files: File[]): WorkbenchUploadItem[] {
  const batchId = createUploadBatchId();
  return files.map((file, index) => ({
    id: `${batchId}-${index}`,
    name: file.name || 'attachment',
    size: file.size,
    stage: 'uploading',
    progress: 0,
    message: 'Waiting to upload'
  }));
}

function createUploadBatchId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `upload-${globalThis.crypto.randomUUID()}`;
  }

  return `upload-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function updateUploadProgress(
  items: WorkbenchUploadItem[],
  uploadIds: Set<string>,
  progress: WorkbenchUploadProgressUpdate
): WorkbenchUploadItem[] {
  const stage = progress.phase === 'processing' ? 'processing' : 'uploading';
  const message = stage === 'processing'
    ? 'Processing OCR and indexing'
    : `Uploading ${progress.percent}%`;

  return items.map((item) => {
    if (!uploadIds.has(item.id)) {
      return item;
    }

    return {
      ...item,
      stage,
      progress: Math.max(item.progress ?? 0, progress.percent),
      message,
      error: undefined
    };
  });
}

function markUploadBatchReady(
  items: WorkbenchUploadItem[],
  uploadIds: Set<string>
): WorkbenchUploadItem[] {
  return items.map((item) => {
    if (!uploadIds.has(item.id)) {
      return item;
    }

    return {
      ...item,
      stage: 'ready',
      progress: 100,
      message: 'Ready for analysis',
      error: undefined
    };
  });
}

function markUploadBatchFailed(
  items: WorkbenchUploadItem[],
  uploadIds: Set<string>,
  error: string
): WorkbenchUploadItem[] {
  return items.map((item) => {
    if (!uploadIds.has(item.id)) {
      return item;
    }

    return {
      ...item,
      stage: 'failed',
      progress: item.progress ?? 100,
      message: 'Upload failed',
      error
    };
  });
}
