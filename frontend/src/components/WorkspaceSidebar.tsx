import { ExternalLink, FileText, Info, X } from 'lucide-react';
import type { WorkbenchAttachment, WorkbenchSessionSnapshot } from '../types';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import {
  buildAttachmentStatus,
  buildReportPath,
  buildReportSuggestionTitle,
  formatBytes
} from './utils';

export type WorkspaceTab = 'files' | 'reports';

type WorkspaceSidebarProps = {
  snapshot: WorkbenchSessionSnapshot;
  availableAttachments: WorkbenchAttachment[];
  queuedAttachmentIds: string[];
  activeTab: WorkspaceTab;
  onTabChange: (tab: WorkspaceTab) => void;
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
  onTabChange,
  reportSuggestion,
  onOpenReport,
  onPromptSubmit,
  onQueueAttachment,
  onUnqueueAttachment,
  onRemoveAttachment
}: WorkspaceSidebarProps) {
  return (
    <aside className="workspace-sidebar" aria-label="Workspace">
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
            sessionId={snapshot.sessionId}
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

  return (
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
                className="mini-action"
                aria-label={queued ? `Unqueue ${attachment.originalName}` : `Queue ${attachment.originalName}`}
                onClick={() =>
                  queued
                    ? void onUnqueueAttachment(attachment.id)
                    : void onQueueAttachment(attachment.id)
                }
              >
                {queued ? 'Queued' : 'Queue'}
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
  );
}

function ReportsTab({
  sessionId,
  reports,
  reportSuggestion,
  onOpenReport,
  onPromptSubmit
}: {
  sessionId: string;
  reports: WorkbenchSessionSnapshot['reports']['artifacts'];
  reportSuggestion: WorkbenchSessionSnapshot['reportSuggestion'];
  onOpenReport: (reportId: string) => void;
  onPromptSubmit: (prompt: string, attachmentIds: string[]) => void | Promise<void>;
}) {
  if (!reports.length && !reportSuggestion) {
    return <EmptyPane title="No reports yet" hint="Generated jd-mcp HTML reports will appear here." />;
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
                  {report.toolName} - {report.source} - {formatBytes(report.size)}
                </small>
              </button>
              <a
                href={buildReportPath(sessionId, report.id)}
                target="_blank"
                rel="noreferrer"
                className="icon-button subtle"
                aria-label={`Open ${report.title} in new tab`}
              >
                <ExternalLink size={14} />
              </a>
            </li>
          ))}
        </ul>
      ) : null}

      {reportSuggestion ? (
        <article className="workspace-suggestion">
          <Info size={17} aria-hidden="true" />
          <div>
            <strong>{buildReportSuggestionTitle(reportSuggestion)}</strong>
            <p>{reportSuggestion.explanation}</p>
            <small>Recommended tool: {reportSuggestion.suggestedToolName}</small>
            {reportSuggestion.canRun ? (
              <button
                type="button"
                className="secondary-action"
                onClick={() => void onPromptSubmit('/report', reportSuggestion.attachmentIds)}
              >
                Run jd-mcp report anyway
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
