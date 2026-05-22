import { Bot, FileText, Image, Terminal, User } from 'lucide-react';
import type { WorkbenchAttachment, WorkbenchMessage, WorkbenchSessionSnapshot } from '../types';
import { MarkdownContent } from './MarkdownContent';
import { RuntimeEventStack } from './RuntimeEventStack';
import { WorkingTrace } from './WorkingTrace';
import { formatBytes } from './utils';

type MessageListProps = {
  messages: WorkbenchMessage[];
  snapshot: WorkbenchSessionSnapshot;
  reportSuggestion: WorkbenchSessionSnapshot['reportSuggestion'];
  selectedReportId?: string | null;
  isBooting: boolean;
  showThinking: boolean;
  onPromptSubmit: (prompt: string, attachmentIds: string[]) => void | Promise<void>;
};

export function MessageList({
  messages,
  snapshot,
  reportSuggestion,
  selectedReportId = null,
  isBooting,
  showThinking,
  onPromptSubmit
}: MessageListProps) {
  if (isBooting) {
    return (
      <div className="empty-state">
        <WorkingTrace snapshot={snapshot} isBooting label="Booting local runtime" />
      </div>
    );
  }

  const visibleMessages = messages.filter(
    (message) => message.kind !== 'attachment' && !isRuntimeSystemMessage(message)
  );
  const hasProgressActivity = (snapshot.progressActivity ?? []).length > 0;
  const hasRuntimeContent =
    hasProgressActivity ||
    snapshot.reports.artifacts.length > 0 ||
    Boolean(reportSuggestion) ||
    snapshot.agents.length > 0 ||
    snapshot.tasks.length > 0 ||
    snapshot.memory.entries.length > 0 ||
    snapshot.history.summaries.length > 0;

  if (!visibleMessages.length && !showThinking && !hasRuntimeContent) {
    return (
      <div className="empty-state">
        <div className="empty-state-pill">OCA GPT-5.5</div>
        <h2>Drop a file, ask a question.</h2>
        <p>
          Upload ADF logs, thread dumps, HAR captures, Forms traces, JDeveloper
          workspaces, or incident ZIPs. I&apos;ll classify them and suggest the
          right analysis.
        </p>
        <div className="suggestion-row" aria-label="Suggested diagnostic inputs">
          {['ADF logs', 'Thread dumps', 'HAR', 'Forms traces', 'Workspaces'].map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
      </div>
    );
  }

  const showWorkingTrace = shouldShowWorkingTrace(snapshot, showThinking);
  const workingTraceAnchorIndex = findWorkingTraceAnchorIndex(visibleMessages, snapshot, showWorkingTrace);
  const runtimeAnchorIndex = findRuntimeAnchorIndex(visibleMessages, snapshot);

  return (
    <div className="message-list" aria-label="Conversation">
      {visibleMessages.map((message, index) => (
        <FragmentWithActivity
          key={message.id}
          message={message}
          shouldRenderWorkingTrace={index === workingTraceAnchorIndex}
          shouldRenderRuntime={index === runtimeAnchorIndex}
          showWorkingTrace={showWorkingTrace}
          showThinking={showThinking}
          snapshot={snapshot}
          reportSuggestion={reportSuggestion}
          selectedReportId={selectedReportId}
          onPromptSubmit={onPromptSubmit}
        />
      ))}
      {workingTraceAnchorIndex === visibleMessages.length ? (
        <WorkingTrace snapshot={snapshot} showThinking={showThinking} />
      ) : null}
      {runtimeAnchorIndex === visibleMessages.length ? (
        <ActivityCluster
          snapshot={snapshot}
          reportSuggestion={reportSuggestion}
          selectedReportId={selectedReportId}
          onPromptSubmit={onPromptSubmit}
        />
      ) : null}
    </div>
  );
}

function shouldShowWorkingTrace(
  snapshot: WorkbenchSessionSnapshot,
  showThinking: boolean
): boolean {
  if (showThinking || snapshot.status === 'running' || snapshot.status === 'awaiting_approval') {
    return true;
  }

  const hasFailedWork =
    snapshot.toolActivity.some((activity) => activity.status === 'failed' || activity.status === 'denied') ||
    snapshot.pendingApprovals.length > 0;

  return hasFailedWork && snapshot.status === 'blocked';
}

function FragmentWithActivity({
  message,
  shouldRenderWorkingTrace,
  shouldRenderRuntime,
  showWorkingTrace,
  showThinking,
  snapshot,
  reportSuggestion,
  selectedReportId,
  onPromptSubmit
}: {
  message: WorkbenchMessage;
  shouldRenderWorkingTrace: boolean;
  shouldRenderRuntime: boolean;
  showWorkingTrace: boolean;
  showThinking: boolean;
  snapshot: WorkbenchSessionSnapshot;
  reportSuggestion: WorkbenchSessionSnapshot['reportSuggestion'];
  selectedReportId: string | null;
  onPromptSubmit: (prompt: string, attachmentIds: string[]) => void | Promise<void>;
}) {
  return (
    <>
      {shouldRenderWorkingTrace && showWorkingTrace ? (
        <WorkingTrace snapshot={snapshot} showThinking={showThinking} />
      ) : null}
      {shouldRenderRuntime ? (
        <ActivityCluster
          snapshot={snapshot}
          reportSuggestion={reportSuggestion}
          selectedReportId={selectedReportId}
          onPromptSubmit={onPromptSubmit}
        />
      ) : null}
      <MessageBubble message={message} attachments={snapshot.attachments} />
    </>
  );
}

function ActivityCluster({
  snapshot,
  reportSuggestion,
  selectedReportId,
  onPromptSubmit
}: {
  snapshot: WorkbenchSessionSnapshot;
  reportSuggestion: WorkbenchSessionSnapshot['reportSuggestion'];
  selectedReportId: string | null;
  onPromptSubmit: (prompt: string, attachmentIds: string[]) => void | Promise<void>;
}) {
  return (
    <RuntimeEventStack
      snapshot={snapshot}
      reportSuggestion={reportSuggestion}
      selectedReportId={selectedReportId}
      onPromptSubmit={onPromptSubmit}
    />
  );
}

function findWorkingTraceAnchorIndex(
  messages: WorkbenchMessage[],
  snapshot: WorkbenchSessionSnapshot,
  showWorkingTrace: boolean
): number {
  if (!showWorkingTrace) {
    return -1;
  }

  const isLiveTurn = snapshot.status === 'running' || snapshot.status === 'awaiting_approval';
  const lastUserIndex = isLiveTurn
    ? findLastMessageIndex(messages, (message) => message.role === 'user')
    : -1;
  if (lastUserIndex >= 0) {
    const nextAssistantIndex = messages.findIndex(
      (message, index) => index > lastUserIndex && message.role === 'assistant'
    );
    return nextAssistantIndex >= 0 ? nextAssistantIndex : messages.length;
  }

  const firstAssistantIndex = messages.findIndex((message) => message.role === 'assistant');
  if (firstAssistantIndex >= 0) {
    return firstAssistantIndex;
  }

  return messages.length;
}

function findRuntimeAnchorIndex(
  messages: WorkbenchMessage[],
  snapshot: WorkbenchSessionSnapshot
): number {
  const hasRuntimeContent =
    snapshot.toolActivity.length > 0 ||
    snapshot.reports.artifacts.length > 0 ||
    Boolean(snapshot.reportSuggestion) ||
    snapshot.agents.length > 0 ||
    snapshot.tasks.length > 0 ||
    snapshot.memory.entries.length > 0 ||
    snapshot.history.summaries.length > 0;

  if (!hasRuntimeContent) {
    return -1;
  }

  const isLiveTurn = snapshot.status === 'running' || snapshot.status === 'awaiting_approval';
  const hasLiveToolActivity = snapshot.toolActivity.some(
    (activity) => activity.status === 'running' || activity.status === 'pending'
  );
  if (isLiveTurn && hasLiveToolActivity) {
    const liveAnchor = findWorkingTraceAnchorIndex(messages, snapshot, true);
    if (liveAnchor >= 0) {
      return liveAnchor;
    }
  }

  const toolNames = new Set(snapshot.toolActivity.map((activity) => activity.toolName));
  const toolSystemIndex = messages.findIndex((message) => {
    if (message.role !== 'system') {
      return false;
    }
    if (message.kind === 'tool') {
      return true;
    }
    return Array.from(toolNames).some((toolName) => message.content.startsWith(`${toolName}:`));
  });
  if (toolSystemIndex >= 0) {
    return toolSystemIndex;
  }

  const reportSuggestionIndex = messages.findIndex(
    (message) =>
      message.role === 'system' &&
      message.kind === 'command-error' &&
      (message.content.includes('report') ||
        message.content.includes(snapshot.reportSuggestion?.suggestedToolName ?? '\u0000'))
  );
  if (reportSuggestionIndex >= 0) {
    return reportSuggestionIndex;
  }

  const firstAssistantIndex = messages.findIndex((message) => message.role === 'assistant');
  if (firstAssistantIndex >= 0) {
    return firstAssistantIndex;
  }

  return messages.length;
}

function findLastMessageIndex(
  messages: WorkbenchMessage[],
  predicate: (message: WorkbenchMessage) => boolean
): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (predicate(messages[index])) {
      return index;
    }
  }
  return -1;
}

function MessageBubble({
  message,
  attachments
}: {
  message: WorkbenchMessage;
  attachments: WorkbenchAttachment[];
}) {
  if (message.role === 'user') {
    const attached = getMessageAttachments(message, attachments);

    return (
      <article className="message-row is-user">
        <div className="user-message-stack">
          {attached.length ? <UserAttachmentCards attachments={attached} /> : null}
          <div className="message-bubble user-bubble">
            <div className="message-copy">{message.content}</div>
          </div>
        </div>
        <span className="avatar user-avatar" aria-hidden="true">
          <User size={15} />
        </span>
      </article>
    );
  }

  if (message.role === 'assistant') {
    return (
      <article className="message-row is-assistant">
        <span className="avatar assistant-avatar" aria-hidden="true">
          <Bot size={15} />
        </span>
        <div className="message-bubble assistant-bubble">
          <MarkdownContent content={message.content} />
        </div>
      </article>
    );
  }

  if (message.kind === 'attachment') {
    return <AttachmentMessageCard message={message} attachments={attachments} />;
  }

  return (
    <article className={`system-pill message-kind-${message.kind ?? 'default'}`}>
      <Terminal size={13} />
      <span>{message.content}</span>
    </article>
  );
}

function getMessageAttachments(
  message: WorkbenchMessage,
  attachments: WorkbenchAttachment[]
): WorkbenchAttachment[] {
  return (message.attachmentIds ?? [])
    .map((attachmentId) => attachments.find((attachment) => attachment.id === attachmentId))
    .filter((attachment): attachment is WorkbenchAttachment => Boolean(attachment));
}

function UserAttachmentCards({ attachments }: { attachments: WorkbenchAttachment[] }) {
  return (
    <div className="user-attachment-list" role="group" aria-label="Files attached to this message">
      {attachments.map((attachment) => (
        <article key={attachment.id} className="user-attachment-card">
          <span className="user-attachment-icon" aria-hidden="true">
            {attachment.kind === 'image' ? <Image size={16} /> : <FileText size={16} />}
          </span>
          <span className="user-attachment-copy">
            <strong>{attachment.sourceArchive?.relativePath ?? attachment.originalName}</strong>
            <small>
              {attachment.kind === 'image' ? 'Image' : 'File'} - {formatBytes(attachment.size)}
            </small>
          </span>
        </article>
      ))}
    </div>
  );
}

function isRuntimeSystemMessage(message: WorkbenchMessage): boolean {
  if (message.role !== 'system') {
    return false;
  }

  if (message.kind === 'tool') {
    return true;
  }

  return /^Running\s+\S+\s+via\s+/i.test(message.content);
}

function AttachmentMessageCard({
  message,
  attachments
}: {
  message: WorkbenchMessage;
  attachments: WorkbenchAttachment[];
}) {
  const attached = getMessageAttachments(message, attachments);
  const archiveName = attached.find((attachment) => attachment.sourceArchive)?.sourceArchive?.name;

  return (
    <article className="attachment-system-card" aria-label="Uploaded files">
      <div className="attachment-system-head">
        <span className="runtime-row-icon" aria-hidden="true">
          <FileText size={15} />
        </span>
        <div>
          <strong>{message.content}</strong>
          <small>
            {archiveName ? `Extracted from ${archiveName}` : 'Available in workspace files'}
          </small>
        </div>
      </div>
      {attached.length ? (
        <ul className="attachment-system-list">
          {attached.slice(0, 12).map((attachment) => (
            <li key={attachment.id}>
              {attachment.kind === 'image' ? <Image size={14} /> : <FileText size={14} />}
              <span>
                <strong>{attachment.sourceArchive?.relativePath ?? attachment.originalName}</strong>
                <small>{formatBytes(attachment.size)} - {attachment.mediaType}</small>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}
