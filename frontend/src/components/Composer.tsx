import { Paperclip, SendHorizonal, X } from 'lucide-react';
import {
  useLayoutEffect,
  useRef,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type RefObject
} from 'react';
import type { WorkbenchAttachment, WorkbenchSessionSnapshot } from '../types';
import { buildAttachmentStatus, formatBytes } from './utils';

type ComposerProps = {
  draft: string;
  setDraft: (draft: string) => void;
  status: WorkbenchSessionSnapshot['status'];
  isSubmitting: boolean;
  isDraggingFiles: boolean;
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
      {queuedAttachments.length ? (
        <div className="queued-attachments" aria-label="Queued attachments">
          {queuedAttachments.length > 1 ? (
            <details className="queued-case-summary">
              <summary>
                <span>
                  <strong>{queuedAttachments.length} files queued as one case</strong>
                  <small>
                    {formatBytes(totalQueuedSize(queuedAttachments))} selected - details available
                  </small>
                </span>
              </summary>
              <div className="queued-case-list">
                {queuedAttachments.map((attachment) => (
                  <QueuedAttachmentChip
                    key={attachment.id}
                    attachment={attachment}
                    onUnqueueAttachment={onUnqueueAttachment}
                  />
                ))}
              </div>
            </details>
          ) : (
            queuedAttachments.map((attachment) => (
              <QueuedAttachmentChip
                key={attachment.id}
                attachment={attachment}
                onUnqueueAttachment={onUnqueueAttachment}
              />
            ))
          )}
        </div>
      ) : null}

      <div className="composer-box">
        {isDraggingFiles ? <div className="drop-target-label">Drop files to attach</div> : null}
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
    </form>
  );
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

function totalQueuedSize(attachments: WorkbenchAttachment[]): number {
  return attachments.reduce((total, attachment) => total + attachment.size, 0);
}
