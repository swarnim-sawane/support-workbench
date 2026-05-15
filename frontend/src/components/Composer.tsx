import {
  AlertTriangle,
  ChevronDown,
  LoaderCircle,
  Paperclip,
  SendHorizonal,
  UploadCloud,
  Wrench,
  X
} from 'lucide-react';
import {
  useLayoutEffect,
  useRef,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type RefObject
} from 'react';
import type { WorkbenchAttachment, WorkbenchSessionSnapshot, WorkbenchUploadItem } from '../types';
import {
  buildJdMcpComposerActions,
  getJdMcpToolStatus,
  type JdMcpComposerAction
} from '../jdMcpWorkflows';
import { buildAttachmentStatus, formatBytes } from './utils';

type ComposerProps = {
  draft: string;
  setDraft: (draft: string) => void;
  status: WorkbenchSessionSnapshot['status'];
  isSubmitting: boolean;
  isDraggingFiles: boolean;
  uploadItems?: WorkbenchUploadItem[];
  availableAttachments?: WorkbenchAttachment[];
  queuedAttachments: WorkbenchAttachment[];
  queuedAttachmentIds: string[];
  jdMcp?: WorkbenchSessionSnapshot['integrations']['jdMcp'];
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onPromptSubmit: (prompt: string, attachmentIds: string[]) => void | Promise<void>;
  onAttachFiles: (files: File[]) => void | Promise<void>;
  onQueueAttachment: (attachmentId: string) => void | Promise<void>;
  onUnqueueAttachment: (attachmentId: string) => void | Promise<void>;
  onRunJdMcpTool?: (input: {
    toolName: string;
    label: string;
    attachmentIds: string[];
  }) => void | Promise<void>;
  onDragEnterFiles: (event: DragEvent) => void;
  onDragLeaveFiles: (event: DragEvent) => void;
  onDragOverFiles: (event: DragEvent) => void;
  onDropFiles: (event: DragEvent) => void;
};

export function Composer({
  draft,
  setDraft,
  status,
  isSubmitting,
  isDraggingFiles,
  uploadItems = [],
  queuedAttachments,
  queuedAttachmentIds,
  availableAttachments = queuedAttachments,
  jdMcp,
  textareaRef,
  onPromptSubmit,
  onAttachFiles,
  onQueueAttachment,
  onUnqueueAttachment,
  onRunJdMcpTool,
  onDragEnterFiles,
  onDragLeaveFiles,
  onDragOverFiles,
  onDropFiles
}: ComposerProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const activeUploadItems = uploadItems.filter(
    (item) => item.stage === 'uploading' || item.stage === 'processing'
  );
  const hasActiveUploadItems = activeUploadItems.length > 0;
  const jdMcpActions = jdMcp
    ? buildJdMcpComposerActions({
        jdMcp,
        attachments: availableAttachments,
        queuedAttachmentIds
      })
    : null;
  const visiblePrimaryJdMcpActions = jdMcpActions?.primary.slice(0, 6) ?? [];
  const enabledAdvancedJdMcpActions = jdMcpActions?.advanced.filter((action) => !action.disabled) ?? [];
  const eligibleAttachments = availableAttachments.filter(
    (attachment) => attachment.promptVisibility === 'available'
  );
  const eligibleAttachmentIds = eligibleAttachments.map((attachment) => attachment.id);
  const selectedEligibleIds = eligibleAttachmentIds.filter((attachmentId) =>
    queuedAttachmentIds.includes(attachmentId)
  );
  const unselectedEligibleIds = eligibleAttachmentIds.filter(
    (attachmentId) => !queuedAttachmentIds.includes(attachmentId)
  );
  const hasAttachmentSelectionControls = eligibleAttachments.length > 0;
  const selectedAttachmentSummary = `${selectedEligibleIds.length} of ${eligibleAttachments.length} ${eligibleAttachments.length === 1 ? 'file' : 'files'} selected`;

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    textarea.style.height = '0px';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 220)}px`;
  }, [draft]);

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!draft.trim() || isSubmitting) {
      return;
    }

    void onPromptSubmit(draft, queuedAttachmentIds);
    setDraft('');
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const composing = (event.nativeEvent as unknown as { isComposing?: boolean }).isComposing === true;
    if (event.key === 'Enter' && !event.shiftKey && !composing) {
      event.preventDefault();
      submit();
    }
  }

  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.files ?? []);
    if (!files.length) {
      return;
    }

    event.preventDefault();
    void onAttachFiles(files);
  }

  function selectAllAttachments() {
    for (const attachmentId of unselectedEligibleIds) {
      void onQueueAttachment(attachmentId);
    }
  }

  function deselectAllAttachments() {
    for (const attachmentId of selectedEligibleIds) {
      void onUnqueueAttachment(attachmentId);
    }
  }

  return (
    <form
      className={`composer-shell ${isDraggingFiles ? 'is-dragging-files' : ''}`}
      onSubmit={submit}
      onDragEnter={onDragEnterFiles}
      onDragLeave={onDragLeaveFiles}
      onDragOver={onDragOverFiles}
      onDrop={onDropFiles}
    >
      <div className="composer-box">
        {isDraggingFiles ? <div className="drop-target-label">Drop files to attach</div> : null}
        {hasActiveUploadItems || queuedAttachments.length || hasAttachmentSelectionControls ? (
          <div className={`composer-attachment-tray ${hasActiveUploadItems ? '' : 'is-horizontal'}`}>
            {hasActiveUploadItems ? <UploadProgressPanel items={activeUploadItems} /> : null}

            {hasAttachmentSelectionControls ? (
              <div className="composer-attachment-controls" aria-label="Chat file selection">
                <span className="composer-attachment-count">{selectedAttachmentSummary}</span>
                <div className="composer-attachment-actions">
                  <button
                    type="button"
                    className="composer-attachment-action"
                    aria-label="Select all eligible chat files"
                    onClick={selectAllAttachments}
                    disabled={!unselectedEligibleIds.length}
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    className="composer-attachment-action"
                    aria-label="Deselect all selected chat files"
                    onClick={deselectAllAttachments}
                    disabled={!selectedEligibleIds.length}
                  >
                    Deselect all
                  </button>
                </div>
              </div>
            ) : null}

            {queuedAttachments.length ? (
              <div className="queued-attachments" aria-label="Queued attachments">
                {queuedAttachments.map((attachment) => (
                  <QueuedAttachmentChip
                    key={attachment.id}
                    attachment={attachment}
                    onUnqueueAttachment={onUnqueueAttachment}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        {jdMcpActions && (visiblePrimaryJdMcpActions.length || enabledAdvancedJdMcpActions.length) ? (
          <JdMcpActionStrip
            primaryActions={visiblePrimaryJdMcpActions}
            advancedActions={enabledAdvancedJdMcpActions}
            onRunJdMcpTool={onRunJdMcpTool}
            disabled={isSubmitting || status === 'running'}
          />
        ) : null}
        <div className="composer-input-row">
          <button
            type="button"
            className="icon-button"
            aria-label="Open file picker"
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip size={18} />
          </button>
          <input
            ref={fileInputRef}
            className="visually-hidden"
            type="file"
            multiple
            accept=".zip,.cjs,.conf,.css,.csv,.dmp,.dump,.env,.har,.html,.ini,.java,.js,.json,.jsx,.log,.md,.mjs,.out,.png,.jpg,.jpeg,.gif,.webp,.bmp,.py,.rb,.rs,.scss,.sh,.sql,.tdump,.toml,.trc,.ts,.tsx,.txt,.xml,.yaml,.yml,application/zip,application/x-zip-compressed,text/*,image/*"
            aria-label="Attach files"
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? []);
              if (files.length) {
                void onAttachFiles(files);
              }
              event.currentTarget.value = '';
            }}
          />
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            placeholder="Message Support Workbench..."
            rows={1}
          />
          <button
            type="submit"
            className="send-button"
            aria-label="Send prompt"
            disabled={!draft.trim() || isSubmitting || status === 'running'}
          >
            <SendHorizonal size={17} />
          </button>
        </div>
      </div>
    </form>
  );
}

function JdMcpActionStrip({
  primaryActions,
  advancedActions,
  disabled,
  onRunJdMcpTool
}: {
  primaryActions: JdMcpComposerAction[];
  advancedActions: JdMcpComposerAction[];
  disabled: boolean;
  onRunJdMcpTool?: (input: {
    toolName: string;
    label: string;
    attachmentIds: string[];
  }) => void | Promise<void>;
}) {
  function runAction(action: JdMcpComposerAction) {
    if (disabled || action.disabled) {
      return;
    }

    void onRunJdMcpTool?.({
      toolName: action.toolName,
      label: action.label,
      attachmentIds: action.attachmentIds
    });
  }

  return (
    <div className="composer-jd-mcp-actions" aria-label="Analyze with JD MCP">
      <div className="composer-jd-mcp-head">
        <Wrench size={14} aria-hidden="true" />
        <span>Analyze with JD MCP</span>
      </div>
      <div className="composer-jd-mcp-action-list">
        {primaryActions.map((action) => (
          <button
            key={action.toolName}
            type="button"
            className="composer-jd-mcp-action"
            title={action.disabledReason ?? action.description}
            disabled={disabled || action.disabled}
            aria-label={`${action.label} - ${getJdMcpToolStatus(action)}`}
            onClick={() => runAction(action)}
          >
            <span>{action.label}</span>
            <small>{getJdMcpToolStatus(action)}</small>
          </button>
        ))}
        {advancedActions.length ? (
          <details className="composer-jd-mcp-advanced">
            <summary>
              <ChevronDown size={14} aria-hidden="true" />
              <span>Advanced JD MCP tools</span>
            </summary>
            <div className="composer-jd-mcp-advanced-list">
              {advancedActions.map((action) => (
                <button
                  key={action.toolName}
                  type="button"
                  className="composer-jd-mcp-action compact"
                  title={action.description}
                  disabled={disabled}
                  onClick={() => runAction(action)}
                >
                  <span>{action.label}</span>
                  <small>{action.toolName}</small>
                </button>
              ))}
            </div>
          </details>
        ) : null}
      </div>
    </div>
  );
}

function UploadProgressPanel({ items }: { items: WorkbenchUploadItem[] }) {
  const summary = buildUploadSummary(items);

  return (
    <div
      className="upload-progress-panel"
      role="status"
      aria-live="polite"
      aria-label={summary}
    >
      <div className="upload-progress-head">
        <UploadCloud size={15} aria-hidden="true" />
        <strong>{summary}</strong>
      </div>
      {items.length ? (
        <ul className="upload-progress-list">
          {items.map((item) => (
            <li key={item.id} className={`upload-progress-item is-${item.stage}`}>
              <span className="upload-progress-icon" aria-hidden="true">
                {item.stage === 'failed' ? (
                  <AlertTriangle size={14} />
                ) : (
                  <LoaderCircle className="spin" size={14} />
                )}
              </span>
              <span className="upload-progress-copy">
                <strong title={item.name}>{item.name}</strong>
                <small>
                  {formatBytes(item.size)} - {item.error ?? item.message ?? buildUploadItemMessage(item)}
                </small>
                <progress
                  className="upload-progress-bar"
                  value={item.progress ?? undefined}
                  max={100}
                  aria-label={`${item.name} upload progress`}
                />
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function buildUploadSummary(items: WorkbenchUploadItem[]): string {
  const uploading = items.filter((item) => item.stage === 'uploading').length;
  const processing = items.filter((item) => item.stage === 'processing').length;
  const failed = items.filter((item) => item.stage === 'failed').length;
  const parts = [
    formatUploadCount(uploading, 'Uploading'),
    formatUploadCount(processing, 'processing'),
    failed ? `${failed} failed` : null
  ].filter(Boolean);

  return parts.length ? parts.join(', ') : 'No active uploads';
}

function formatUploadCount(count: number, label: string): string | null {
  if (!count) {
    return null;
  }

  return `${label} ${count} ${count === 1 ? 'file' : 'files'}`;
}

function buildUploadItemMessage(item: WorkbenchUploadItem): string {
  if (item.stage === 'processing') {
    return 'Processing OCR and indexing';
  }
  if (item.stage === 'ready') {
    return 'Ready for analysis';
  }
  if (item.stage === 'failed') {
    return 'Upload failed';
  }

  return `Uploading ${item.progress ?? 0}%`;
}

function QueuedAttachmentChip({
  attachment,
  onUnqueueAttachment
}: {
  attachment: WorkbenchAttachment;
  onUnqueueAttachment: (attachmentId: string) => void | Promise<void>;
}) {
  return (
    <button
      type="button"
      className="attachment-chip"
      aria-label={`Remove queued attachment ${attachment.originalName}`}
      onClick={() => void onUnqueueAttachment(attachment.id)}
    >
      <span>{attachment.originalName}</span>
      <small>
        {formatBytes(attachment.size)} - {buildAttachmentStatus(attachment)}
      </small>
      <X size={13} aria-hidden="true" />
    </button>
  );
}

