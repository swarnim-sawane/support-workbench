import {
  AlertTriangle,
  ChevronDown,
  CircleStop,
  FileText,
  LoaderCircle,
  Paperclip,
  Plus,
  SendHorizonal,
  UploadCloud,
  Wrench,
  X
} from 'lucide-react';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
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
  type JdMcpComposerAction,
  type JdMcpWorkflowGroup
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
  onCancelTurn: () => void | Promise<void>;
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
  onCancelTurn,
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
  const [specializedPickerOpen, setSpecializedPickerOpen] = useState(false);
  const [selectedSpecializedAction, setSelectedSpecializedAction] = useState<JdMcpComposerAction | null>(null);
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
  const specializedAvailableActions = jdMcpActions?.available ?? [];
  const specializedUnavailableActions = jdMcpActions?.unavailable ?? [];
  const hasSpecializedToolActions = Boolean(
    jdMcpActions && (specializedAvailableActions.length || specializedUnavailableActions.length)
  );
  const canSubmit = Boolean(draft.trim() || selectedSpecializedAction);
  const specializedActionKey = specializedAvailableActions
    .map((action) => `${action.toolName}:${action.attachmentIds.join(',')}`)
    .join('|');
  const groupedSpecializedActions = useMemo(
    () => groupSpecializedActions(specializedAvailableActions),
    [specializedActionKey]
  );
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
  const hasComposerToolbar = hasSpecializedToolActions;
  const selectedAttachmentSummary = `Files ${selectedEligibleIds.length}/${eligibleAttachments.length}`;
  const selectedAttachmentAriaSummary = `${selectedEligibleIds.length} of ${eligibleAttachments.length} workspace ${eligibleAttachments.length === 1 ? 'file' : 'files'} added to chat`;

  useEffect(() => {
    if (!selectedSpecializedAction) {
      return;
    }

    const updatedAction = specializedAvailableActions.find(
      (action) => action.toolName === selectedSpecializedAction.toolName
    );
    if (!updatedAction) {
      setSelectedSpecializedAction(null);
      return;
    }

    if (updatedAction.attachmentIds.join('|') !== selectedSpecializedAction.attachmentIds.join('|')) {
      setSelectedSpecializedAction(updatedAction);
    }
  }, [specializedActionKey, selectedSpecializedAction]);

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
    if (!canSubmit || isSubmitting || status === 'running') {
      return;
    }

    if (selectedSpecializedAction && onRunJdMcpTool) {
      const details = draft.trim();
      void onRunJdMcpTool({
        toolName: selectedSpecializedAction.toolName,
        label: details ? `${selectedSpecializedAction.label}\n\n${details}` : selectedSpecializedAction.label,
        attachmentIds: selectedSpecializedAction.attachmentIds
      });
      setDraft('');
      setSelectedSpecializedAction(null);
      setSpecializedPickerOpen(false);
      return;
    }

    if (!draft.trim()) {
      return;
    }

    void onPromptSubmit(draft, queuedAttachmentIds);
    setDraft('');
    setSpecializedPickerOpen(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const composing = (event.nativeEvent as unknown as { isComposing?: boolean }).isComposing === true;
    if (event.key === 'Escape' && specializedPickerOpen) {
      event.preventDefault();
      setSpecializedPickerOpen(false);
      return;
    }
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
                <span className="composer-attachment-count" aria-label={selectedAttachmentAriaSummary}>
                  {selectedAttachmentSummary}
                </span>
                <div className="composer-attachment-actions">
                  <button
                    type="button"
                    className="composer-attachment-action icon-only"
                    aria-label="Add all workspace files to chat"
                    title="Add all workspace files to chat"
                    onClick={selectAllAttachments}
                    disabled={!unselectedEligibleIds.length}
                  >
                    <Plus size={14} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="composer-attachment-action icon-only"
                    aria-label="Remove all files from chat"
                    title="Remove all files from chat"
                    onClick={deselectAllAttachments}
                    disabled={!selectedEligibleIds.length}
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                </div>
              </div>
            ) : null}

            {hasAttachmentSelectionControls && queuedAttachments.length ? (
              <span className="composer-attachment-divider" aria-hidden="true" />
            ) : null}

            {queuedAttachments.length ? (
              <div className="queued-attachments" aria-label="Files added to chat">
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
        {status === 'running' ? (
          <button
            type="button"
            className="stop-button"
            aria-label="Stop response"
            onClick={() => void onCancelTurn()}
          >
            <CircleStop size={17} />
          </button>
        ) : (
          <button
            type="submit"
            className="send-button"
            aria-label="Send prompt"
            disabled={!canSubmit || isSubmitting}
          >
            <SendHorizonal size={17} />
          </button>
        )}
        </div>
        {hasComposerToolbar ? (
          <div className="composer-tool-row">
            {hasSpecializedToolActions ? (
              <SpecializedToolPicker
                open={specializedPickerOpen}
                selectedAction={selectedSpecializedAction}
                groupedActions={groupedSpecializedActions}
                unavailableActions={specializedUnavailableActions}
                disabled={isSubmitting || status === 'running'}
                onToggle={() => setSpecializedPickerOpen((open) => !open)}
                onDismiss={() => setSpecializedPickerOpen(false)}
                onSelect={(action) => {
                  setSelectedSpecializedAction(action);
                  setSpecializedPickerOpen(false);
                }}
                onRemoveSelection={() => setSelectedSpecializedAction(null)}
              />
            ) : null}
          </div>
        ) : null}
      </div>
    </form>
  );
}

function SpecializedToolPicker({
  open,
  selectedAction,
  groupedActions,
  unavailableActions,
  disabled,
  onToggle,
  onDismiss,
  onSelect,
  onRemoveSelection
}: {
  open: boolean;
  selectedAction: JdMcpComposerAction | null;
  groupedActions: Array<[JdMcpWorkflowGroup, JdMcpComposerAction[]]>;
  unavailableActions: JdMcpComposerAction[];
  disabled: boolean;
  onToggle: () => void;
  onDismiss: () => void;
  onSelect: (action: JdMcpComposerAction) => void;
  onRemoveSelection: () => void;
}) {
  const availableCount = groupedActions.reduce((count, [, actions]) => count + actions.length, 0);

  function onPickerKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onDismiss();
    }
  }

  return (
    <div className="specialized-tool-control">
      <div className="specialized-tool-toolbar">
        <button
          type="button"
          className="specialized-tool-trigger"
          aria-expanded={open}
          aria-controls="specialized-tool-popover"
          disabled={disabled}
          onClick={onToggle}
        >
          <Wrench size={14} aria-hidden="true" />
          <span>Specialized tools</span>
          <ChevronDown size={13} aria-hidden="true" />
        </button>
        {selectedAction ? (
          <span className="specialized-tool-tag" title={selectedAction.description}>
            <FileText size={13} aria-hidden="true" />
            <span>Specialized: {selectedAction.label}</span>
            <button
              type="button"
              aria-label={`Remove specialized tool ${selectedAction.label}`}
              onClick={onRemoveSelection}
            >
              <X size={12} aria-hidden="true" />
            </button>
          </span>
        ) : null}
      </div>

      {open ? (
        <div
          id="specialized-tool-popover"
          className="specialized-tool-popover"
          role="dialog"
          aria-label="Specialized tools"
          onKeyDown={onPickerKeyDown}
        >
          <div className="specialized-tool-popover-head">
            <strong>Run a report tool</strong>
            <span>{availableCount ? `${availableCount} matching` : 'No matching tools'}</span>
          </div>

          {groupedActions.length ? (
            <div className="specialized-tool-groups">
              {groupedActions.map(([group, actions]) => (
                <section key={group} className="specialized-tool-group" aria-label={`${group} reports`}>
                  <h4>{group}</h4>
                  {actions.map((action) => (
                    <button
                      key={action.toolName}
                      type="button"
                      className="specialized-tool-row"
                      title={action.description}
                      onClick={() => onSelect(action)}
                    >
                      <span className="specialized-tool-icon" aria-hidden="true">
                        <FileText size={15} />
                      </span>
                      <span className="specialized-tool-copy">
                        <strong>{action.label}</strong>
                        <small>{action.description}</small>
                      </span>
                      <span className="specialized-tool-meta">
                        <small>{getJdMcpToolStatus(action)}</small>
                        <em>HTML report</em>
                      </span>
                    </button>
                  ))}
                </section>
              ))}
            </div>
          ) : (
            <p className="specialized-tool-empty">
              Add a matching log, trace, dump, workspace, or incident bundle to chat to enable report tools.
            </p>
          )}

          {unavailableActions.length ? (
            <details className="specialized-tool-unavailable">
              <summary>
                <ChevronDown size={13} aria-hidden="true" />
                <span>Unavailable tools</span>
                <small>{unavailableActions.length}</small>
              </summary>
              <div className="specialized-tool-unavailable-list">
                {unavailableActions.map((action) => (
                  <article key={action.toolName} className="specialized-tool-unavailable-row">
                    <strong>{action.label}</strong>
                    <span>{action.disabledReason ?? 'Unavailable in this session.'}</span>
                  </article>
                ))}
              </div>
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function groupSpecializedActions(actions: JdMcpComposerAction[]): Array<[JdMcpWorkflowGroup, JdMcpComposerAction[]]> {
  const order: JdMcpWorkflowGroup[] = ['Logs', 'ADF', 'Forms/Reports', 'Dumps', 'Workspace/Incident'];
  return order
    .map((group) => [group, actions.filter((action) => action.group === group)] as [JdMcpWorkflowGroup, JdMcpComposerAction[]])
    .filter(([, groupActions]) => groupActions.length > 0);
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
    return 'Processing and indexing';
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
      aria-label={`Remove ${attachment.originalName} from current message`}
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

