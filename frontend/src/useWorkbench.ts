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
import type { WorkbenchHealth, WorkbenchSessionSnapshot, WorkbenchSessionSummary } from './types';

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

      const response = await uploadAttachments(snapshot.sessionId, files);
      setSnapshot(response.snapshot);
      setQueuedAttachmentIds((current) =>
        Array.from(new Set([...current, ...response.attachments.map((attachment) => attachment.id)]))
      );
      void refreshSessions(response.snapshot.workspace.cwd);
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
