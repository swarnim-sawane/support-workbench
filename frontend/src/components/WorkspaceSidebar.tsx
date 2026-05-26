import {
  FileText,
  Check,
  Info,
  PanelRightClose,
  Plus,
  X
} from 'lucide-react';
import type { WorkbenchAttachment, WorkbenchSessionSnapshot } from '../types';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import {
  buildAttachmentStatus,
  buildReportSuggestionTitle,
  formatBytes,
  formatSpecializedToolText,
  formatToolSource
} from './utils';

export type WorkspaceTab = 'files' | 'reports';

type WorkspaceSidebarProps = {
  snapshot: WorkbenchSessionSnapshot;
  availableAttachments: WorkbenchAttachment[];
  queuedAttachmentIds: string[];
  activeTab: WorkspaceTab;
  workspaceCount: number;
  onTabChange: (tab: WorkspaceTab) => void;
  onCloseWorkspace: () => void;
  reportSuggestion: WorkbenchSessionSnapshot['reportSuggestion'];
  onOpenReport: (reportId: string) => void;
  onPromptSubmit: (prompt: string, attachmentIds: string[]) => void | Promise<void>;
  onQueueAttachment: (attachmentId: string) => void | Promise<void>;
  onUnqueueAttachment: (attachmentId: string) => void | Promise<void>;
  onRemoveAttachment: (attachmentId: string) => void | Promise<void>;
};

export function WorkspaceSidebar({
  snapshot,
  availableAttachments,
  queuedAttachmentIds,
  activeTab,
  workspaceCount,
  onTabChange,
  onCloseWorkspace,
  reportSuggestion,
  onOpenReport,
  onPromptSubmit,
  onQueueAttachment,
  onUnqueueAttachment,
  onRemoveAttachment
}: WorkspaceSidebarProps) {
  return (
    <aside className="workspace-sidebar" aria-label="Workspace">
      <div className="workspace-sidebar-head">
        <div className="workspace-sidebar-title">
          <PanelRightClose size={16} aria-hidden="true" />
          <span>Workspace</span>
          {workspaceCount > 0 ? <em className="workspace-count">{workspaceCount}</em> : null}
        </div>
        <button
          type="button"
          className="workspace-toggle-button"
          aria-label="Close workspace"
          title="Close workspace"
          onClick={onCloseWorkspace}
        >
          <PanelRightClose size={16} aria-hidden="true" />
          <span>Close workspace</span>
        </button>
      </div>
      <Tabs
        value={activeTab}
        onValueChange={(value) => onTabChange(value as WorkspaceTab)}
        className="workspace-tabs"
      >
        <TabsList className="workspace-tab-list">
          <TabsTrigger value="files">Files</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
        </TabsList>

        <TabsContent value="files" className="workspace-tab-content">
          <FilesTab
            sessionId={snapshot.sessionId}
            attachments={availableAttachments}
            queuedAttachmentIds={queuedAttachmentIds}
            onQueueAttachment={onQueueAttachment}
            onUnqueueAttachment={onUnqueueAttachment}
            onRemoveAttachment={onRemoveAttachment}
          />
        </TabsContent>
        <TabsContent value="reports" className="workspace-tab-content">
          <ReportsTab
            reports={snapshot.reports.artifacts}
            reportSuggestion={reportSuggestion}
            onOpenReport={onOpenReport}
            onPromptSubmit={onPromptSubmit}
          />
        </TabsContent>
      </Tabs>
    </aside>
  );
}

function FilesTab({
  sessionId,
  attachments,
  queuedAttachmentIds,
  onQueueAttachment,
  onUnqueueAttachment,
  onRemoveAttachment
}: {
  sessionId: string;
  attachments: WorkbenchAttachment[];
  queuedAttachmentIds: string[];
  onQueueAttachment: (attachmentId: string) => void | Promise<void>;
  onUnqueueAttachment: (attachmentId: string) => void | Promise<void>;
  onRemoveAttachment: (attachmentId: string) => void | Promise<void>;
}) {
  if (!attachments.length) {
    return <EmptyPane title="No files yet" hint="Drop logs, HAR captures, traces, images, or ZIPs to attach them." />;
  }

  const eligibleAttachmentIds = attachments
    .filter((attachment) => attachment.promptVisibility === 'available')
    .map((attachment) => attachment.id);
  const queuedEligibleAttachmentIds = eligibleAttachmentIds.filter((attachmentId) =>
    queuedAttachmentIds.includes(attachmentId)
  );
  const unqueuedEligibleAttachmentIds = eligibleAttachmentIds.filter((attachmentId) =>
    !queuedAttachmentIds.includes(attachmentId)
  );
  const queuedSummary = `${queuedEligibleAttachmentIds.length}/${eligibleAttachmentIds.length}`;
  const queuedAriaSummary = `${queuedEligibleAttachmentIds.length} of ${eligibleAttachmentIds.length} workspace ${eligibleAttachmentIds.length === 1 ? 'file' : 'files'} added to chat`;

  function addAllFilesToChat() {
    for (const attachmentId of unqueuedEligibleAttachmentIds) {
      void onQueueAttachment(attachmentId);
    }
  }

  function removeAllFilesFromChat() {
    for (const attachmentId of queuedEligibleAttachmentIds) {
      void onUnqueueAttachment(attachmentId);
    }
  }

  return (
    <div className="workspace-files-panel">
      <div className="workspace-file-bulk-row" aria-label="Workspace chat file selection">
        <span className="workspace-file-bulk-count" aria-label={queuedAriaSummary}>
          Files in chat {queuedSummary}
        </span>
        <div className="workspace-file-bulk-actions">
          <button
            type="button"
            className="workspace-file-bulk-action"
            onClick={addAllFilesToChat}
            disabled={!unqueuedEligibleAttachmentIds.length}
          >
            Add all
          </button>
          <button
            type="button"
            className="workspace-file-bulk-action"
            onClick={removeAllFilesFromChat}
            disabled={!queuedEligibleAttachmentIds.length}
          >
            Remove all
          </button>
        </div>
      </div>
      <ul className="workspace-list">
        {attachments.map((attachment) => {
          const queued = queuedAttachmentIds.includes(attachment.id);
          return (
            <li key={attachment.id} className={`workspace-file-row ${queued ? 'is-queued' : ''}`}>
              <div className="workspace-row-icon" aria-hidden="true">
                {attachment.kind === 'image' ? (
                  <img
                    src={`/api/session/${sessionId}/attachments/${attachment.id}/content`}
                    alt=""
                    className="workspace-thumb"
                  />
                ) : (
                  <FileText size={16} />
                )}
              </div>
              <div className="workspace-row-copy">
                <strong title={attachment.originalName}>{attachment.originalName}</strong>
                <small>
                  {formatBytes(attachment.size)} - {buildAttachmentStatus(attachment)}
                </small>
                {attachment.sourceArchive ? (
                  <small>
                    {attachment.sourceArchive.name} - {attachment.sourceArchive.relativePath}
                  </small>
                ) : null}
                {attachment.extractedText ? <p>{attachment.extractedText}</p> : null}
              </div>
              <div className="workspace-row-actions">
                <button
                  type="button"
                  className={`mini-action workspace-chat-action ${queued ? 'is-active' : ''}`}
                  aria-label={
                    queued
                      ? `Remove ${attachment.originalName} from chat`
                      : `Add ${attachment.originalName} to chat`
                  }
                  title={
                    queued
                      ? 'Remove from this chat prompt'
                      : 'Add this uploaded file to the current chat prompt'
                  }
                  onClick={() =>
                    queued
                      ? void onUnqueueAttachment(attachment.id)
                      : void onQueueAttachment(attachment.id)
                  }
                >
                  {queued ? (
                    <>
                      <Check size={13} aria-hidden="true" />
                      In chat
                    </>
                  ) : (
                    <>
                      <Plus size={13} aria-hidden="true" />
                      Add to chat
                    </>
                  )}
                </button>
                <button
                  type="button"
                  className="icon-button subtle"
                  aria-label={`Remove attachment ${attachment.originalName}`}
                  onClick={() => void onRemoveAttachment(attachment.id)}
                >
                  <X size={14} />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ReportsTab({
  reports,
  reportSuggestion,
  onOpenReport,
  onPromptSubmit
}: {
  reports: WorkbenchSessionSnapshot['reports']['artifacts'];
  reportSuggestion: WorkbenchSessionSnapshot['reportSuggestion'];
  onOpenReport: (reportId: string) => void;
  onPromptSubmit: (prompt: string, attachmentIds: string[]) => void | Promise<void>;
}) {
  if (!reports.length && !reportSuggestion) {
    return <EmptyPane title="No reports yet" hint="Generated report artifacts will appear here." />;
  }

  return (
    <div>
      {reports.length ? (
        <ul className="workspace-list">
          {reports.map((report) => (
            <li key={report.id} className="workspace-report-row">
              <FileText className="workspace-row-icon text-accent" size={16} aria-hidden="true" />
              <button
                type="button"
                className="workspace-row-copy as-button"
                aria-label={`Open ${report.title}`}
                onClick={() => onOpenReport(report.id)}
              >
                <strong title={report.title}>{report.title}</strong>
                <small>
                  {report.toolName} - {formatToolSource(report.source)} - {formatBytes(report.size)}
                </small>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {reportSuggestion ? (
        <article className="workspace-suggestion">
          <Info size={17} aria-hidden="true" />
          <div>
            <strong>{buildReportSuggestionTitle(reportSuggestion)}</strong>
            <p>{formatSpecializedToolText(reportSuggestion.explanation)}</p>
            <small>Recommended tool: {reportSuggestion.suggestedToolName}</small>
            {reportSuggestion.canRun ? (
              <button
                type="button"
                className="secondary-action"
                onClick={() => void onPromptSubmit('/report', reportSuggestion.attachmentIds)}
              >
                Run focused analyzer
              </button>
            ) : null}
          </div>
        </article>
      ) : null}
    </div>
  );
}

function EmptyPane({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="workspace-empty">
      <div className="workspace-empty-mark" aria-hidden="true" />
      <strong>{title}</strong>
      <p>{hint}</p>
    </div>
  );
}
