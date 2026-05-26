import { useDeferredValue, useEffect, useRef, useState, type DragEvent } from 'react';
import { AlertTriangle, CheckCircle2, MessageSquare, PanelRightOpen, X } from 'lucide-react';
import { AppRail } from './components/AppRail';
import { ApprovalOverlay } from './components/ApprovalOverlay';
import { ChatHeader, type WorkbenchTheme } from './components/ChatHeader';
import { Composer } from './components/Composer';
import { DocumentationPage } from './components/DocumentationPage';
import { HelpDrawer } from './components/HelpDrawer';
import { MessageList } from './components/MessageList';
import { WorkspaceSidebar, type WorkspaceTab } from './components/WorkspaceSidebar';
import { buildChatReportCardId, formatBytes } from './components/utils';
import type {
  WorkbenchHealth,
  WorkbenchSessionSnapshot,
  WorkbenchSessionSummary,
  WorkbenchUploadItem
} from './types';

type AppProps = {
  snapshot: WorkbenchSessionSnapshot;
  sessions?: WorkbenchSessionSummary[];
  activeSessionId?: string | null;
  queuedAttachmentIds: string[];
  uploadItems?: WorkbenchUploadItem[];
  health: WorkbenchHealth;
  onPromptSubmit: (
    prompt: string,
    attachmentIds: string[],
    options?: { jdMcpToolName?: string; jdMcpToolLabel?: string }
  ) => void | Promise<void>;
  onApprove: (requestId: string, decision: 'allow' | 'deny') => void | Promise<void>;
  onAttachFiles: (files: File[]) => void | Promise<void>;
  onRemoveAttachment: (attachmentId: string) => void | Promise<void>;
  onQueueAttachment: (attachmentId: string) => void | Promise<void>;
  onUnqueueAttachment: (attachmentId: string) => void | Promise<void>;
  onNewSession?: () => void | Promise<void>;
  onSelectSession?: (sessionId: string) => void | Promise<void>;
  onDeleteSession?: (sessionId: string) => void | Promise<void>;
  onCancelTurn?: () => void | Promise<void>;
  isBooting?: boolean;
  error?: string | null;
};

type UploadToast = {
  id: string;
  name: string;
  size: number;
  message: string;
  tone: 'ok' | 'danger';
};

const UPLOAD_TOAST_TIMEOUT_MS = 5600;
const SHELL_THEME_MESSAGE_TYPE = 'support-workbench:set-theme';

function isEmbeddedWorkbench(): boolean {
  return new URLSearchParams(window.location.search).get('embedded') === '1';
}

function isWorkbenchTheme(value: unknown): value is WorkbenchTheme {
  return value === 'light' || value === 'dark' || value === 'redwood';
}

function readThemeFromUrl(): WorkbenchTheme | null {
  const themeParam = new URLSearchParams(window.location.search).get('theme');
  return isWorkbenchTheme(themeParam) ? themeParam : null;
}

function readThemeFromShellMessage(event: MessageEvent): WorkbenchTheme | null {
  if (!event.data || typeof event.data !== 'object') return null;

  const data = event.data as { type?: unknown; theme?: unknown };
  if (data.type !== SHELL_THEME_MESSAGE_TYPE || !isWorkbenchTheme(data.theme)) {
    return null;
  }

  return data.theme;
}

export function App({
  snapshot,
  sessions = [],
  activeSessionId = snapshot.sessionId || null,
  queuedAttachmentIds,
  uploadItems = [],
  health,
  onPromptSubmit,
  onApprove,
  onAttachFiles,
  onRemoveAttachment,
  onQueueAttachment,
  onUnqueueAttachment,
  onNewSession = () => undefined,
  onSelectSession = () => undefined,
  onDeleteSession = () => undefined,
  onCancelTurn = () => undefined,
  isBooting = false,
  error = null
}: AppProps) {
  const isEmbedded = isEmbeddedWorkbench();
  const deferredMessages = useDeferredValue(snapshot.messages);
  const availableAttachments = snapshot.attachments.filter(
    (attachment) => attachment.promptVisibility === 'available'
  );
  const queuedAttachments = availableAttachments.filter((attachment) =>
    queuedAttachmentIds.includes(attachment.id)
  );
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>('files');
  const [workspaceOpen, setWorkspaceOpen] = useState(true);
  const [leftRailOpen, setLeftRailOpen] = useState(() => !isEmbedded);
  const [theme, setTheme] = useState<WorkbenchTheme>(() => readThemeFromUrl() ?? 'light');
  const [helpOpen, setHelpOpen] = useState(false);
  const [documentationOpen, setDocumentationOpen] = useState(() => !isEmbedded && window.location.pathname === '/docs');
  const [composerDraft, setComposerDraft] = useState('');
  const [isSubmittingPrompt, setIsSubmittingPrompt] = useState(false);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const previousReportIdsRef = useRef<string[]>([]);
  const shownUploadToastIdsRef = useRef<Set<string>>(new Set());
  const uploadToastTimersRef = useRef<Map<string, number>>(new Map());
  const dragDepthRef = useRef(0);
  const isSubmittingPromptRef = useRef(false);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const chatScrollRef = useRef<HTMLElement | null>(null);
  const chatNearBottomRef = useRef(true);
  const [uploadToasts, setUploadToasts] = useState<UploadToast[]>([]);

  function dismissUploadToast(id: string) {
    const timerId = uploadToastTimersRef.current.get(id);
    if (timerId !== undefined) {
      window.clearTimeout(timerId);
      uploadToastTimersRef.current.delete(id);
    }
    setUploadToasts((current) => current.filter((toast) => toast.id !== id));
  }

  useEffect(() => {
    if (!snapshot.reports.artifacts.length) {
      previousReportIdsRef.current = [];
      setSelectedReportId(null);
      return;
    }

    const previousReportIds = previousReportIdsRef.current;
    const firstNewReport = snapshot.reports.artifacts.find(
      (artifact) => !previousReportIds.includes(artifact.id)
    );
    previousReportIdsRef.current = snapshot.reports.artifacts.map((artifact) => artifact.id);

    setSelectedReportId((current) => {
      if (firstNewReport) {
        return firstNewReport.id;
      }
      if (!current) {
        return snapshot.reports.artifacts[0]?.id ?? null;
      }
      return snapshot.reports.artifacts.some((artifact) => artifact.id === current)
        ? current
        : snapshot.reports.artifacts[0]?.id ?? null;
    });
  }, [snapshot.reports.artifacts]);

  useEffect(() => {
    if (!isEmbedded) return undefined;

    function onShellMessage(event: MessageEvent) {
      const nextTheme = readThemeFromShellMessage(event);
      if (!nextTheme) return;
      setTheme((currentTheme) => (currentTheme === nextTheme ? currentTheme : nextTheme));
    }

    window.addEventListener('message', onShellMessage);
    return () => window.removeEventListener('message', onShellMessage);
  }, [isEmbedded]);

  useEffect(() => {
    for (const item of uploadItems) {
      if ((item.stage !== 'ready' && item.stage !== 'failed') || shownUploadToastIdsRef.current.has(item.id)) {
        continue;
      }

      shownUploadToastIdsRef.current.add(item.id);
      const failed = item.stage === 'failed';
      setUploadToasts((current) => [
        ...current,
        {
          id: item.id,
          name: item.name,
          size: item.size,
          message: failed
            ? (item.error ?? item.message ?? 'Upload failed')
            : 'Uploaded to workspace and added to this chat',
          tone: failed ? 'danger' : 'ok'
        }
      ]);

      const timerId = window.setTimeout(() => {
        uploadToastTimersRef.current.delete(item.id);
        setUploadToasts((current) => current.filter((toast) => toast.id !== item.id));
      }, UPLOAD_TOAST_TIMEOUT_MS);
      uploadToastTimersRef.current.set(item.id, timerId);
    }
  }, [uploadItems]);

  useEffect(() => {
    return () => {
      for (const timerId of uploadToastTimersRef.current.values()) {
        window.clearTimeout(timerId);
      }
      uploadToastTimersRef.current.clear();
    };
  }, []);

  const reportSuggestion = snapshot.reportSuggestion;
  const showThinking = shouldShowThinking(snapshot);

  function openReport(reportId: string) {
    setSelectedReportId(reportId);
    window.requestAnimationFrame(() => {
      const reportCard = document.getElementById(buildChatReportCardId(reportId));
      if (!reportCard) {
        return;
      }

      if (typeof reportCard.scrollIntoView === 'function') {
        reportCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      if (reportCard instanceof HTMLElement) {
        reportCard.focus({ preventScroll: true });
      }
    });
  }

  function openDocumentation() {
    if (isEmbedded) {
      return;
    }
    setHelpOpen(false);
    setDocumentationOpen(true);
    if (window.location.pathname !== '/docs') {
      window.history.pushState({}, '', '/docs');
    }
  }

  function backToWorkbench() {
    setDocumentationOpen(false);
    if (window.location.pathname !== '/') {
      window.history.pushState({}, '', '/');
    }
  }

  function downloadChat() {
    const contents = buildChatDownload(snapshot);
    const filename = `support-workbench-${snapshot.sessionId}.md`;
    if (typeof URL.createObjectURL !== 'function') {
      void navigator.clipboard?.writeText(contents);
      return;
    }

    const url = URL.createObjectURL(new Blob([contents], { type: 'text/markdown;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function handlePromptSubmit(
    prompt: string,
    attachmentIds: string[],
    options: { jdMcpToolName?: string; jdMcpToolLabel?: string } = {}
  ) {
    if (isSubmittingPromptRef.current) {
      return;
    }

    chatNearBottomRef.current = true;
    isSubmittingPromptRef.current = true;
    const result = options.jdMcpToolName
      ? onPromptSubmit(prompt, attachmentIds, options)
      : onPromptSubmit(prompt, attachmentIds);
    if (isPromiseLike(result)) {
      setIsSubmittingPrompt(true);
      try {
        await result;
      } finally {
        isSubmittingPromptRef.current = false;
        setIsSubmittingPrompt(false);
      }
      return;
    }

    isSubmittingPromptRef.current = false;
  }

  async function handleCancelTurn() {
    const result = onCancelTurn();
    if (isPromiseLike(result)) {
      try {
        await result;
      } finally {
        isSubmittingPromptRef.current = false;
        setIsSubmittingPrompt(false);
      }
      return;
    }

    isSubmittingPromptRef.current = false;
    setIsSubmittingPrompt(false);
  }

  async function handleNewSession() {
    setComposerDraft('');
    setSelectedReportId(null);
    const result = onNewSession();
    if (isPromiseLike(result)) {
      await result;
    }
  }

  function hasDraggedFiles(event: DragEvent) {
    return Array.from(event.dataTransfer.types).includes('Files');
  }

  function onDragEnterFiles(event: DragEvent) {
    if (!hasDraggedFiles(event)) {
      return;
    }
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDraggingFiles(true);
  }

  function onDragLeaveFiles(event: DragEvent) {
    if (!hasDraggedFiles(event)) {
      return;
    }
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDraggingFiles(false);
    }
  }

  function onDragOverFiles(event: DragEvent) {
    if (!hasDraggedFiles(event)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }

  function onDropFiles(event: DragEvent) {
    if (!hasDraggedFiles(event)) {
      return;
    }
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDraggingFiles(false);
    const files = Array.from(event.dataTransfer.files ?? []);
    if (files.length) {
      void onAttachFiles(files);
    }
  }

  function onChatScroll() {
    const scroller = chatScrollRef.current;
    if (!scroller) {
      return;
    }

    const distanceFromBottom =
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    chatNearBottomRef.current = distanceFromBottom < 180;
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setHelpOpen(false);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    function onPopState() {
      setDocumentationOpen(!isEmbedded && window.location.pathname === '/docs');
    }

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [isEmbedded]);

  useEffect(() => {
    const scroller = chatScrollRef.current;
    if (!scroller || !chatNearBottomRef.current) {
      return;
    }

    const animationFrame = window.requestAnimationFrame(() => {
      if (typeof scroller.scrollTo === 'function') {
        scroller.scrollTo({
          top: scroller.scrollHeight,
          behavior: 'smooth'
        });
        return;
      }

      scroller.scrollTop = scroller.scrollHeight;
    });

    return () => window.cancelAnimationFrame(animationFrame);
  }, [
    deferredMessages.length,
    (snapshot.progressActivity ?? []).length,
    snapshot.toolActivity.length,
    snapshot.reports.artifacts.length,
    snapshot.pendingApprovals.length,
    snapshot.agents.length,
    snapshot.tasks.length,
    snapshot.memory.entries.length,
    snapshot.history.summaries.length,
    showThinking,
    reportSuggestion?.reasonCode
  ]);

  return (
    <div
      className="app-shell"
      data-theme={theme}
      data-left-rail={leftRailOpen ? 'open' : 'collapsed'}
      data-embedded={isEmbedded ? 'true' : 'false'}
    >
      {!isEmbedded || leftRailOpen ? (
        <AppRail
          sessions={sessions}
          activeSessionId={activeSessionId}
          leftRailOpen={leftRailOpen}
          isLoading={isBooting}
          onToggleLeftRail={() => setLeftRailOpen((current) => !current)}
          onNewSession={handleNewSession}
          onSelectSession={onSelectSession}
          onDeleteSession={onDeleteSession}
        />
      ) : null}

      {isEmbedded && !leftRailOpen ? (
        <button
          type="button"
          className="embedded-chat-drawer-button"
          aria-label="Open chat history"
          title="Open chat history"
          onClick={() => setLeftRailOpen(true)}
        >
          <MessageSquare size={15} aria-hidden="true" />
          <span>Chats</span>
        </button>
      ) : null}

      <div className="workbench-frame">
        {!isEmbedded ? (
          <ChatHeader
            health={health}
            error={error}
            theme={theme}
            isDocumentationOpen={documentationOpen}
            onDownloadChat={downloadChat}
            onSetTheme={setTheme}
            onOpenHelp={() => setHelpOpen(true)}
            onOpenDocumentation={openDocumentation}
            onBackToWorkbench={backToWorkbench}
          />
        ) : null}

        {documentationOpen && !isEmbedded ? (
          <DocumentationPage onBackToWorkbench={backToWorkbench} />
        ) : (
          <main className="shell-main" data-workspace-layout={workspaceOpen ? 'open' : 'closed'}>
            <section className="chat-shell" aria-label="Support Workbench conversation">
              <section
                ref={chatScrollRef}
                className="chat-scroll-region"
                onScroll={onChatScroll}
              >
                <MessageList
                  messages={deferredMessages}
                  snapshot={snapshot}
                  reportSuggestion={reportSuggestion}
                  selectedReportId={selectedReportId}
                  isBooting={isBooting}
                  showThinking={showThinking}
                  onPromptSubmit={handlePromptSubmit}
                />
              </section>
              <div className={`composer-dock ${snapshot.pendingApprovals.length ? 'has-approval' : ''}`}>
                <ApprovalOverlay
                  approvals={snapshot.pendingApprovals}
                  onApprove={onApprove}
                />
                <Composer
                  draft={composerDraft}
                  setDraft={setComposerDraft}
                  status={snapshot.status}
                  isSubmitting={isSubmittingPrompt}
                  isDraggingFiles={isDraggingFiles}
                  uploadItems={uploadItems}
                  queuedAttachments={queuedAttachments}
                  queuedAttachmentIds={queuedAttachmentIds}
                  textareaRef={composerTextareaRef}
                  onPromptSubmit={handlePromptSubmit}
                  onCancelTurn={handleCancelTurn}
                  onAttachFiles={onAttachFiles}
                  onQueueAttachment={onQueueAttachment}
                  onUnqueueAttachment={onUnqueueAttachment}
                  availableAttachments={availableAttachments}
                  jdMcp={snapshot.integrations.jdMcp}
                  onRunJdMcpTool={({ toolName, label, prompt, attachmentIds }) =>
                    void handlePromptSubmit(prompt, attachmentIds, {
                      jdMcpToolName: toolName,
                      jdMcpToolLabel: label
                    })
                  }
                  onDragEnterFiles={onDragEnterFiles}
                  onDragLeaveFiles={onDragLeaveFiles}
                  onDragOverFiles={onDragOverFiles}
                  onDropFiles={onDropFiles}
                />
              </div>
            </section>

            {workspaceOpen ? (
              <WorkspaceSidebar
                snapshot={snapshot}
                availableAttachments={availableAttachments}
                queuedAttachmentIds={queuedAttachmentIds}
                activeTab={workspaceTab}
                workspaceCount={availableAttachments.length + snapshot.reports.artifacts.length}
                onTabChange={setWorkspaceTab}
                onCloseWorkspace={() => setWorkspaceOpen(false)}
                reportSuggestion={reportSuggestion}
                onOpenReport={openReport}
                onPromptSubmit={handlePromptSubmit}
                onQueueAttachment={onQueueAttachment}
                onUnqueueAttachment={onUnqueueAttachment}
                onRemoveAttachment={onRemoveAttachment}
              />
            ) : (
              <button
                type="button"
                className="workspace-reopen-button"
                aria-label="Open workspace"
                title="Open workspace"
                onClick={() => setWorkspaceOpen(true)}
              >
                <PanelRightOpen size={16} aria-hidden="true" />
                <span>Open workspace</span>
              </button>
            )}
          </main>
        )}
      </div>

      <HelpDrawer
        open={helpOpen}
        commands={snapshot.commands}
        jdMcp={snapshot.integrations.jdMcp}
        onClose={() => setHelpOpen(false)}
      />
      <UploadToastRegion toasts={uploadToasts} onDismiss={dismissUploadToast} />
    </div>
  );
}

function UploadToastRegion({
  toasts,
  onDismiss
}: {
  toasts: UploadToast[];
  onDismiss: (id: string) => void;
}) {
  if (!toasts.length) {
    return null;
  }

  return (
    <div className="toast-region" role="region" aria-label="Upload notifications">
      {toasts.map((toast) => (
        <article
          key={toast.id}
          className={`upload-toast tone-${toast.tone}`}
          role={toast.tone === 'danger' ? 'alert' : 'status'}
        >
          <span className="upload-toast-icon" aria-hidden="true">
            {toast.tone === 'danger' ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
          </span>
          <span className="upload-toast-copy">
            <strong title={toast.name}>{toast.name}</strong>
            <small>
              {formatBytes(toast.size)} - {toast.message}
            </small>
          </span>
          <button
            type="button"
            className="upload-toast-dismiss"
            aria-label={`Dismiss ${toast.name}`}
            onClick={() => onDismiss(toast.id)}
          >
            <X size={14} />
          </button>
        </article>
      ))}
    </div>
  );
}

function buildChatDownload(snapshot: WorkbenchSessionSnapshot): string {
  const lines = [
    '# Support Workbench Chat',
    '',
    `Session: ${snapshot.sessionId}`,
    `Status: ${snapshot.status}`,
    `Reports: ${snapshot.reports.artifacts.length}`,
    `Attachments: ${snapshot.attachments.filter((attachment) => attachment.promptVisibility === 'available').length}`,
    ''
  ];

  for (const message of snapshot.messages.filter((item) => item.kind !== 'attachment')) {
    lines.push(`## ${message.role}${message.kind && message.kind !== 'default' ? ` (${message.kind})` : ''}`);
    lines.push('');
    lines.push(message.content);
    lines.push('');
  }

  if (snapshot.agents.length) {
    lines.push('## Subagents', '');
    for (const agent of snapshot.agents) {
      lines.push(`- ${agent.agentType} ${agent.status}: ${agent.resultSummary ?? agent.error ?? agent.prompt}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function shouldShowThinking(snapshot: WorkbenchSessionSnapshot): boolean {
  if (snapshot.status !== 'running') {
    return false;
  }

  let lastUserIndex = -1;
  for (let index = snapshot.messages.length - 1; index >= 0; index -= 1) {
    if (snapshot.messages[index]?.role === 'user') {
      lastUserIndex = index;
      break;
    }
  }

  const messagesAfterUser =
    lastUserIndex >= 0 ? snapshot.messages.slice(lastUserIndex + 1) : snapshot.messages;

  return !messagesAfterUser.some(
    (message) => message.role === 'assistant' && message.content.trim().length > 0
  );
}

function isPromiseLike(value: void | Promise<void>): value is Promise<void> {
  return typeof value === 'object' && value !== null && typeof value.then === 'function';
}
