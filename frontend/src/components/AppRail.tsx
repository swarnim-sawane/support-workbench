import {
  FileText,
  MessageSquarePlus,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Trash2
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type { WorkbenchSessionSummary } from '../types';

type AppRailProps = {
  sessions: WorkbenchSessionSummary[];
  activeSessionId: string | null;
  leftRailOpen: boolean;
  isLoading: boolean;
  onToggleLeftRail: () => void;
  onNewSession: () => void | Promise<void>;
  onSelectSession: (sessionId: string) => void | Promise<void>;
  onDeleteSession: (sessionId: string) => void | Promise<void>;
};

export function AppRail({
  sessions,
  activeSessionId,
  leftRailOpen,
  isLoading,
  onToggleLeftRail,
  onNewSession,
  onSelectSession,
  onDeleteSession
}: AppRailProps) {
  const [query, setQuery] = useState('');
  const [pendingDelete, setPendingDelete] = useState<WorkbenchSessionSummary | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const filteredSessions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return sessions;
    }
    return sessions.filter((session) =>
      `${session.title} ${session.preview}`.toLowerCase().includes(normalized)
    );
  }, [query, sessions]);

  async function confirmDelete() {
    if (!pendingDelete) {
      return;
    }

    setIsDeleting(true);
    try {
      await onDeleteSession(pendingDelete.id);
      setPendingDelete(null);
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <aside
      className={`app-left-rail session-sidebar ${leftRailOpen ? 'is-open' : 'is-collapsed'}`}
      aria-label="Session history"
    >
      <div className="session-sidebar-top">
        <button
          type="button"
          className="rail-icon-button rail-toggle"
          aria-label={leftRailOpen ? 'Hide sidebar' : 'Show sidebar'}
          aria-expanded={leftRailOpen}
          onClick={onToggleLeftRail}
          title={leftRailOpen ? 'Hide sidebar' : 'Show sidebar'}
        >
          {leftRailOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
        </button>
        <button
          type="button"
          className={leftRailOpen ? 'new-chat-button' : 'rail-icon-button'}
          aria-label="New chat"
          onClick={() => void onNewSession()}
          disabled={isLoading}
          title="New chat"
        >
          <MessageSquarePlus size={17} />
          {leftRailOpen ? <span>New chat</span> : null}
        </button>
      </div>

      {leftRailOpen ? (
        <>
          <label className="session-search">
            <Search size={15} aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search chats"
              aria-label="Search chats"
            />
          </label>

          <nav className="session-history-list" aria-label="Chats">
            {filteredSessions.length ? (
              filteredSessions.map((session) => (
                <div
                  key={session.id}
                  className={`session-history-item ${session.id === activeSessionId ? 'is-active' : ''}`}
                >
                  <button
                    type="button"
                    className={`session-history-row ${session.id === activeSessionId ? 'is-active' : ''}`}
                    aria-current={session.id === activeSessionId ? 'page' : undefined}
                    onClick={() => void onSelectSession(session.id)}
                    disabled={isLoading}
                  >
                    <FileText size={15} aria-hidden="true" />
                    <span>
                      <strong>{session.title}</strong>
                      <small>
                        {formatSessionMeta(session)}
                      </small>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="session-delete-button"
                    aria-label={`Delete ${session.title}`}
                    title={
                      canDeleteSession(session)
                        ? `Delete ${session.title}`
                        : 'Cannot delete chats while running or awaiting approval'
                    }
                    onClick={(event) => {
                      event.stopPropagation();
                      setPendingDelete(session);
                    }}
                    disabled={isLoading || !canDeleteSession(session)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))
            ) : (
              <div className="session-empty">
                <strong>No chats yet</strong>
                <p>Start a new chat to save it here.</p>
                <button type="button" className="secondary-action inline" onClick={() => void onNewSession()}>
                  Start a new chat
                </button>
              </div>
            )}
          </nav>

          {pendingDelete ? (
            <div className="session-delete-overlay">
              <div
                className="session-delete-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="session-delete-title"
              >
                <h2 id="session-delete-title">Delete this chat?</h2>
                <p>
                  This permanently deletes <strong>{pendingDelete.title}</strong> and its uploaded files.
                </p>
                <div className="session-delete-actions">
                  <button
                    type="button"
                    className="secondary-action ghost"
                    onClick={() => setPendingDelete(null)}
                    disabled={isDeleting}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="secondary-action danger"
                    onClick={() => void confirmDelete()}
                    disabled={isDeleting}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </aside>
  );
}

function canDeleteSession(session: WorkbenchSessionSummary): boolean {
  return session.status !== 'running' && session.status !== 'awaiting_approval';
}

function formatSessionMeta(session: WorkbenchSessionSummary): string {
  const counts = [
    `${session.messageCount} msg`,
    session.attachmentCount ? `${session.attachmentCount} files` : '',
    session.reportCount ? `${session.reportCount} reports` : ''
  ].filter(Boolean);
  return counts.join(' - ') || session.preview;
}
