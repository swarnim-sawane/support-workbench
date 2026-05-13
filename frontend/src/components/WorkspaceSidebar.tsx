import { Activity, ExternalLink, FileSearch, FileText, Info, Layers3, ShieldAlert, X } from 'lucide-react';
import {
  deriveAttachmentGroups,
  deriveEvidenceCoverage,
  formatNumber,
  type SupportEvidenceGroup
} from '../derivedSupportState';
import type { WorkbenchAttachment, WorkbenchSessionSnapshot } from '../types';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import {
  buildAttachmentStatus,
  buildReportPath,
  buildReportSuggestionTitle,
  formatBytes
} from './utils';

export type WorkspaceTab = 'case' | 'files' | 'reports';

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
          <TabsTrigger value="case">Case</TabsTrigger>
          <TabsTrigger value="files">Files</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
        </TabsList>

        <TabsContent value="case" className="workspace-tab-content">
          <CaseTab
            snapshot={snapshot}
            attachments={availableAttachments}
            queuedAttachmentIds={queuedAttachmentIds}
          />
        </TabsContent>
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

function CaseTab({
  snapshot,
  attachments,
  queuedAttachmentIds
}: {
  snapshot: WorkbenchSessionSnapshot;
  attachments: WorkbenchAttachment[];
  queuedAttachmentIds: string[];
}) {
  const groups = deriveAttachmentGroups(attachments, queuedAttachmentIds);
  const coverage = deriveEvidenceCoverage(snapshot);
  const logScan = coverage.logScan;

  return (
    <div className="case-ledger" aria-label="Case evidence ledger">
      <section className="case-panel case-panel-hero">
        <div className="case-section-head">
          <span className="case-section-icon" aria-hidden="true">
            <FileSearch size={17} />
          </span>
          <div>
            <h2>Case evidence</h2>
            <p>Frontend-inferred coverage from uploaded files and runtime evidence.</p>
          </div>
        </div>

        <div className="case-metric-grid">
          <span>
            <strong>{formatNumber(groups.totalFiles)} uploaded</strong>
            <small>workspace files</small>
          </span>
          <span>
            <strong>{formatNumber(groups.queuedFiles)} queued</strong>
            <small>selected for prompt</small>
          </span>
          <span>
            <strong>{formatCount(snapshot.reports.artifacts.length, 'report')}</strong>
            <small>generated artifacts</small>
          </span>
        </div>
      </section>

      {coverage.recovery ? (
        <section className="case-panel case-recovery-panel">
          <div className="case-section-head">
            <span className="case-section-icon" aria-hidden="true">
              <ShieldAlert size={17} />
            </span>
            <div>
              <h3>Recovery in progress</h3>
              <p>
                {coverage.recovery.toolName} attempt {coverage.recovery.attempt}: {coverage.recovery.instruction}
              </p>
            </div>
          </div>
        </section>
      ) : null}

      <section className="case-panel">
        <div className="case-section-head compact">
          <span className="case-section-icon" aria-hidden="true">
            <Activity size={17} />
          </span>
          <div>
            <h3>Evidence coverage</h3>
            <p>What the runtime has already scanned across the case.</p>
          </div>
        </div>

        {logScan ? (
          <>
            <div className="case-metric-grid evidence">
              <span>
                <strong>Scanned {formatCount(logScan.scannedFiles, 'log')}</strong>
                <small>full-file LogScan</small>
              </span>
              <span>
                <strong>{formatNumber(logScan.scannedLines)} lines</strong>
                <small>covered lines</small>
              </span>
              <span>
                <strong>{formatCount(logScan.errors, 'error')}</strong>
                <small>error signals</small>
              </span>
              <span>
                <strong>{formatCount(logScan.warnings, 'warning')}</strong>
                <small>warning signals</small>
              </span>
              <span>
                <strong>{logScan.http5xx} HTTP 5xx</strong>
                <small>server responses</small>
              </span>
              <span>
                <strong>{formatCount(logScan.slowRequests, 'slow request')}</strong>
                <small>latency evidence</small>
              </span>
              <span>
                <strong>{formatCount(logScan.sharedIdentifierCount, 'shared identifier')}</strong>
                <small>cross-file hints</small>
              </span>
            </div>
            {logScan.examplesCapped ? (
              <p className="case-note">Examples capped by LogScan to keep the case summary readable.</p>
            ) : null}
          </>
        ) : (
          <p className="case-note">No LogScan evidence yet. Upload logs and ask for a case analysis to build coverage.</p>
        )}
      </section>

      <section className="case-panel">
        <div className="case-section-head compact">
          <span className="case-section-icon" aria-hidden="true">
            <Layers3 size={17} />
          </span>
          <div>
            <h3>Inferred file groups</h3>
            <p>Inferred from filenames and archive paths. Unknowns stay visible.</p>
          </div>
        </div>
        <CaseGroupList title="Type" groups={groups.typeGroups} />
        <CaseGroupList title="Node" groups={groups.nodeGroups} />
        <CaseGroupList title="Capture" groups={groups.captureGroups} />
      </section>
    </div>
  );
}

function CaseGroupList({ title, groups }: { title: string; groups: SupportEvidenceGroup[] }) {
  if (!groups.length) {
    return null;
  }

  return (
    <div className="case-group-block">
      <h4>{title}</h4>
      <ul>
        {groups.map((group) => (
          <li key={`${title}-${group.key}`} className={group.key.includes('unknown') ? 'is-unknown' : ''}>
            <span>
              <strong>{group.label}</strong>
              <small>{group.examples.join(', ')}</small>
            </span>
            <em>
              {formatCount(group.count, 'file')}
              {group.queuedCount ? ` - ${group.queuedCount} queued` : ''}
            </em>
          </li>
        ))}
      </ul>
    </div>
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

function formatCount(count: number, singular: string): string {
  return `${formatNumber(count)} ${count === 1 ? singular : `${singular}s`}`;
}
