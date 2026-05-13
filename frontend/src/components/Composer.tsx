import {
  AlertTriangle,
  CheckCircle2,
  LoaderCircle,
  Paperclip,
  SendHorizonal,
  UploadCloud,
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
import { buildAttachmentStatus, formatBytes } from './utils';

type ComposerProps = {
  draft: string;
  setDraft: (draft: string) => void;
  status: WorkbenchSessionSnapshot['status'];
  isSubmitting: boolean;
  isDraggingFiles: boolean;
  uploadItems?: WorkbenchUploadItem[];
  queuedAttachments: WorkbenchAttachment[];
  queuedAttachmentIds: string[];
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onPromptSubmit: (prompt: string, attachmentIds: string[]) => void | Promise<void>;
  onAttachFiles: (files: File[]) => void | Promise<void>;
  onUnqueueAttachment: (attachmentId: string) => void | Promise<void>;
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
  textareaRef,
  onPromptSubmit,
  onAttachFiles,
  onUnqueueAttachment,
  onDragEnterFiles,
  onDragLeaveFiles,
  onDragOverFiles,
  onDropFiles
}: ComposerProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const hasDetailedUploadItems = uploadItems.some((item) => item.stage !== 'ready');

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
        {uploadItems.length || queuedAttachments.length ? (
          <div className={`composer-attachment-tray ${hasDetailedUploadItems ? '' : 'is-horizontal'}`}>
            {uploadItems.length ? <UploadProgressPanel items={uploadItems} /> : null}

            {queuedAttachments.length ? (
              <div className="queued-attachments" aria-label="Queued attachments">
                {queuedAttachments.map((attachment) => (
                  <button
                    key={attachment.id}
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
            accept=".zip,.cjs,.conf,.css,.csv,.env,.html,.ini,.java,.js,.json,.jsx,.log,.md,.mjs,.png,.jpg,.jpeg,.gif,.webp,.bmp,.py,.rb,.rs,.scss,.sh,.sql,.toml,.ts,.tsx,.txt,.xml,.yaml,.yml,application/zip,application/x-zip-compressed,text/*,image/*"
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

function UploadProgressPanel({ items }: { items: WorkbenchUploadItem[] }) {
  const summary = buildUploadSummary(items);
  const visibleItems = items.filter((item) => item.stage !== 'ready');
  const readyCount = items.filter((item) => item.stage === 'ready').length;
  const isReadyOnly = readyCount > 0 && visibleItems.length === 0;

  return (
    <div
      className={`upload-progress-panel ${isReadyOnly ? 'is-compact-ready' : ''}`}
      role="status"
      aria-live="polite"
      aria-label={summary}
    >
      <div className="upload-progress-head">
        {isReadyOnly ? <CheckCircle2 size={15} aria-hidden="true" /> : <UploadCloud size={15} aria-hidden="true" />}
        <strong>{isReadyOnly ? formatReadyUploadCount(readyCount) : summary}</strong>
      </div>
      {visibleItems.length ? (
        <ul className="upload-progress-list">
          {visibleItems.map((item) => (
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
  const ready = items.filter((item) => item.stage === 'ready').length;
  const failed = items.filter((item) => item.stage === 'failed').length;
  const parts = [
    formatUploadCount(uploading, 'Uploading'),
    formatUploadCount(processing, 'processing'),
    ready ? `${ready} ready` : null,
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

function formatReadyUploadCount(count: number): string {
  return `${count} ${count === 1 ? 'file' : 'files'} ready`;
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
