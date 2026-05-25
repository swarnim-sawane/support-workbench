import { startTransition, useEffect, useRef, useState } from 'react';
import {
  createSession,
  cancelTurn,
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

type SessionResponse = Awaited<ReturnType<typeof createSession>>;

type SessionAction = {
  kind: 'new' | 'select';
  sessionId?: string;
  promise: Promise<void>;
};

type BootstrapResult = SessionResponse & {
  health: WorkbenchHealth;
};

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
  progressActivity: [],
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

let bootstrapPromise: Promise<BootstrapResult> | null = null;

function getInitialSessionId(): string | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }

  const sessionId = new URLSearchParams(window.location.search).get('sessionId')?.trim();
  return sessionId || undefined;
}

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
  const sessionActionRef = useRef<SessionAction | null>(null);

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
      const fetchedSessions = await fetchSessions(cwd);
      setSessions(mergeSessionSummaries([], fetchedSessions));
    } catch (sessionsError) {
      setError(sessionsError instanceof Error ? sessionsError.message : String(sessionsError));
    }
  }

  function upsertSnapshotSession(session: SessionResponse['session'], nextSnapshot: WorkbenchSessionSnapshot) {
    setSessions((current) =>
      mergeSessionSummaries(current, [buildSessionSummary(session, nextSnapshot)])
    );
  }

  useEffect(() => {
    let cancelled = false;
    let eventSource: EventSource | null = null;

    async function bootstrap() {
      try {
        const initialSessionId = getInitialSessionId();
        bootstrapPromise ??= Promise.all([
          initialSessionId ? createSession({ sessionId: initialSessionId }) : createSession(),
          fetchHealth()
        ]).then(([sessionResponse, initialHealth]) => ({
          ...sessionResponse,
          health: initialHealth
        })).catch((bootstrapError) => {
          bootstrapPromise = null;
          throw bootstrapError;
        });
        const sessionResponse = await bootstrapPromise;

        if (cancelled) {
          return;
        }

        setHealth(sessionResponse.health);
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
      if (isBlankWorkbenchSession(snapshot)) {
        setError(null);
        setQueuedAttachmentIds([]);
        setUploadItems([]);
        void refreshSessions(snapshot.workspace.cwd || undefined);
        return;
      }

      const pendingAction = sessionActionRef.current;
      if (pendingAction?.kind === 'new') {
        return pendingAction.promise;
      }

      const cwd = snapshot.workspace.cwd || undefined;
      setIsSwitchingSession(true);
      setError(null);
      const promise = (async () => {
        const response = await createSession({ cwd });
        setSnapshot(response.snapshot);
        setQueuedAttachmentIds([]);
        setUploadItems([]);
        setActiveSessionId(response.session.id);
        upsertSnapshotSession(response.session, response.snapshot);
        connectSession(response.session.id);
        await refreshSessions(response.session.cwd);
      })();
      sessionActionRef.current = {
        kind: 'new',
        promise
      };
      try {
        await promise;
      } catch (newSessionError) {
        setError(newSessionError instanceof Error ? newSessionError.message : String(newSessionError));
      } finally {
        if (sessionActionRef.current?.promise === promise) {
          sessionActionRef.current = null;
        }
        setIsSwitchingSession(false);
      }
    },
    async onSelectSession(sessionId: string) {
      if (sessionId === activeSessionId) {
        return;
      }
      const pendingAction = sessionActionRef.current;
      if (pendingAction?.kind === 'select' && pendingAction.sessionId === sessionId) {
        return pendingAction.promise;
      }

      const cwd = snapshot.workspace.cwd || undefined;
      setIsSwitchingSession(true);
      setError(null);
      const promise = (async () => {
        const response = await createSession({ cwd, sessionId });
        setSnapshot(response.snapshot);
        setQueuedAttachmentIds([]);
        setUploadItems([]);
        setActiveSessionId(response.session.id);
        upsertSnapshotSession(response.session, response.snapshot);
        connectSession(response.session.id);
        await refreshSessions(response.session.cwd);
      })();
      sessionActionRef.current = {
        kind: 'select',
        sessionId,
        promise
      };
      try {
        await promise;
      } catch (selectError) {
        setError(selectError instanceof Error ? selectError.message : String(selectError));
      } finally {
        if (sessionActionRef.current?.promise === promise) {
          sessionActionRef.current = null;
        }
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
        setSessions((current) => current.filter((session) => session.id !== sessionId));
        if (isActiveDelete) {
          eventSourceRef.current?.close();
          eventSourceRef.current = null;
          const response = await createSession({ cwd });
          setSnapshot(response.snapshot);
          setQueuedAttachmentIds([]);
          setUploadItems([]);
          setActiveSessionId(response.session.id);
          upsertSnapshotSession(response.session, response.snapshot);
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
    async onPromptSubmit(
      prompt: string,
      attachmentIds: string[] = queuedAttachmentIds,
      options: { jdMcpToolName?: string } = {}
    ) {
      const trimmed = prompt.trim();
      if (!trimmed || !snapshot.sessionId) {
        return;
      }

      const response = await submitPrompt(snapshot.sessionId, trimmed, attachmentIds, options);
      setSnapshot(response.snapshot);
      setQueuedAttachmentIds([]);
      setSessions((current) =>
        mergeSessionSummaries(current, [
          buildSessionSummary(
            {
              id: response.snapshot.sessionId,
              cwd: response.snapshot.workspace.cwd,
              status: response.snapshot.status
            },
            response.snapshot
          )
        ])
      );
      void refreshSessions(response.snapshot.workspace.cwd);
    },
    async onCancelTurn() {
      if (!snapshot.sessionId) {
        return;
      }

      try {
        const nextSnapshot = await cancelTurn(snapshot.sessionId);
        setSnapshot(nextSnapshot);
        void refreshSessions(nextSnapshot.workspace.cwd);
      } catch (cancelError) {
        setError(cancelError instanceof Error ? cancelError.message : String(cancelError));
      }
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
        ...current.filter((item) => item.stage === 'uploading' || item.stage === 'processing'),
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

export function resetWorkbenchBootstrapForTests() {
  bootstrapPromise = null;
}

function mergeSessionSummaries(
  current: WorkbenchSessionSummary[],
  incoming: WorkbenchSessionSummary[]
): WorkbenchSessionSummary[] {
  const summaries = new Map<string, WorkbenchSessionSummary>();
  for (const summary of [...current, ...incoming].filter(isMeaningfulSessionSummary)) {
    const existing = summaries.get(summary.id);
    if (!existing || compareSessionActivity(summary, existing) <= 0) {
      summaries.set(summary.id, summary);
    }
  }

  return [...summaries.values()].sort(compareSessionActivity);
}

function isBlankWorkbenchSession(snapshot: WorkbenchSessionSnapshot): boolean {
  return (
    Boolean(snapshot.sessionId) &&
    snapshot.messages.length === 0 &&
    snapshot.pendingApprovals.length === 0 &&
    snapshot.progressActivity.length === 0 &&
    snapshot.toolActivity.length === 0 &&
    snapshot.agents.length === 0 &&
    snapshot.tasks.length === 0 &&
    snapshot.memory.entries.length === 0 &&
    snapshot.history.summaries.length === 0 &&
    snapshot.attachments.every((attachment) => attachment.promptVisibility !== 'available') &&
    snapshot.reports.artifacts.length === 0
  );
}

function isMeaningfulSessionSummary(summary: WorkbenchSessionSummary): boolean {
  return summary.messageCount > 0 || summary.attachmentCount > 0 || summary.reportCount > 0;
}

function compareSessionActivity(left: WorkbenchSessionSummary, right: WorkbenchSessionSummary): number {
  const timeDifference = sessionActivityTime(right) - sessionActivityTime(left);
  if (timeDifference !== 0) {
    return timeDifference;
  }

  return left.id.localeCompare(right.id);
}

function sessionActivityTime(session: WorkbenchSessionSummary): number {
  return parseStableTime(session.updatedAt) ?? parseStableTime(session.createdAt) ?? 0;
}

function parseStableTime(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function buildSessionSummary(
  session: SessionResponse['session'],
  snapshot: WorkbenchSessionSnapshot
): WorkbenchSessionSummary {
  const messages = snapshot.messages as Array<WorkbenchSessionSnapshot['messages'][number] & {
    createdAt?: string;
  }>;
  const createdAt = firstStableDate(messages[0]?.createdAt, new Date().toISOString());
  const updatedAt = firstStableDate(messages.at(-1)?.createdAt, createdAt);
  const firstUserMessage = snapshot.messages.find((message) => message.role === 'user');
  const firstAssistantMessage = snapshot.messages.find((message) => message.role === 'assistant');

  return {
    id: session.id,
    title: firstUserMessage ? truncateSessionText(firstUserMessage.content, 56) : 'New chat',
    preview: firstAssistantMessage ? truncateSessionText(firstAssistantMessage.content, 120) : 'No messages yet',
    status: session.status,
    cwd: session.cwd,
    createdAt,
    updatedAt,
    messageCount: snapshot.messages.length,
    attachmentCount: snapshot.attachments.filter((attachment) => attachment.promptVisibility === 'available').length,
    reportCount: snapshot.reports.artifacts.length
  };
}

function firstStableDate(...values: Array<string | undefined>): string {
  for (const value of values) {
    if (value && !Number.isNaN(Date.parse(value))) {
      return value;
    }
  }
  return new Date().toISOString();
}

function truncateSessionText(content: string, maxLength: number): string {
  const cleaned = content
    .replace(/\n\nAttachments:[\s\S]*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) {
    return '';
  }
  return cleaned.length <= maxLength ? cleaned : `${cleaned.slice(0, maxLength - 1).trimEnd()}...`;
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
    ? 'Processing and indexing'
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
