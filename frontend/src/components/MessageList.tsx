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
  isBooting: boolean;
  showThinking: boolean;
  onOpenReport: (reportId: string) => void;
  onPromptSubmit: (prompt: string, attachmentIds: string[]) => void | Promise<void>;
};

export function MessageList({
  messages,
  snapshot,
  reportSuggestion,
  isBooting,
  showThinking,
  onOpenReport,
  onPromptSubmit
}: MessageListProps) {
  if (isBooting) {
    return (
      <div className="empty-state">
        <WorkingTrace snapshot={snapshot} isBooting label="Booting local runtime" />
      </div>
    );
  }

  const hasProgressActivity = (snapshot.progressActivity ?? []).length > 0;
  const hasRuntimeContent =
    hasProgressActivity ||
    snapshot.reports.artifacts.length > 0 ||
    Boolean(reportSuggestion) ||
    snapshot.agents.length > 0 ||
    snapshot.tasks.length > 0 ||
    snapshot.memory.entries.length > 0 ||
    snapshot.history.summaries.length > 0;

  if (!messages.length && !showThinking && !hasRuntimeContent) {
    return (
      <div className="empty-state">
        <div className="empty-state-pill">OCA GPT-5.4</div>
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

  return (
    <div className="message-list" aria-label="Conversation">
      {messages.map((message, index) => (
        <FragmentWithRuntime
          key={message.id}
          message={message}
          shouldRenderRuntime={index === findRuntimeAnchorIndex(messages, snapshot)}
          snapshot={snapshot}
          reportSuggestion={reportSuggestion}
          onOpenReport={onOpenReport}
          onPromptSubmit={onPromptSubmit}
        />
      ))}
      {findRuntimeAnchorIndex(messages, snapshot) === messages.length ? (
        <RuntimeEventStack
          snapshot={snapshot}
          reportSuggestion={reportSuggestion}
          onOpenReport={onOpenReport}
          onPromptSubmit={onPromptSubmit}
        />
      ) : null}
      {shouldShowWorkingTrace(snapshot, showThinking) ? (
        <WorkingTrace snapshot={snapshot} showThinking={showThinking} />
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

  const hasObservableWork =
    snapshot.toolActivity.length > 0 ||
    (snapshot.progressActivity ?? []).length > 0 ||
    snapshot.agents.length > 0;

  return hasObservableWork && (snapshot.status === 'blocked' || snapshot.status === 'completed');
}

function FragmentWithRuntime({
  message,
  shouldRenderRuntime,
  snapshot,
  reportSuggestion,
  onOpenReport,
  onPromptSubmit
}: {
  message: WorkbenchMessage;
  shouldRenderRuntime: boolean;
  snapshot: WorkbenchSessionSnapshot;
  reportSuggestion: WorkbenchSessionSnapshot['reportSuggestion'];
  onOpenReport: (reportId: string) => void;
  onPromptSubmit: (prompt: string, attachmentIds: string[]) => void | Promise<void>;
}) {
  return (
    <>
      <MessageBubble message={message} attachments={snapshot.attachments} />
      {shouldRenderRuntime ? (
        <RuntimeEventStack
          snapshot={snapshot}
          reportSuggestion={reportSuggestion}
          onOpenReport={onOpenReport}
          onPromptSubmit={onPromptSubmit}
        />
      ) : null}
    </>
  );
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

function MessageBubble({
  message,
  attachments
}: {
  message: WorkbenchMessage;
  attachments: WorkbenchAttachment[];
}) {
  if (message.role === 'user') {
    return (
      <article className="message-row is-user">
        <div className="message-bubble user-bubble">
          <div className="message-copy">{message.content}</div>
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

function AttachmentMessageCard({
  message,
  attachments
}: {
  message: WorkbenchMessage;
  attachments: WorkbenchAttachment[];
}) {
  const attached = (message.attachmentIds ?? [])
    .map((attachmentId) => attachments.find((attachment) => attachment.id === attachmentId))
    .filter((attachment): attachment is WorkbenchAttachment => Boolean(attachment));
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
