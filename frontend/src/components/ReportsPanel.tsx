import { ExternalLink, FileText, Info } from 'lucide-react';
import type { WorkbenchReportArtifact, WorkbenchSessionSnapshot } from '../types';
import {
  buildReportPath,
  buildReportSuggestionTitle,
  formatBytes,
  formatSpecializedToolText,
  formatToolSource
} from './utils';

type ReportsPanelProps = {
  sessionId: string;
  reports: WorkbenchReportArtifact[];
  selectedReportId: string | null;
  onSelectReport: (reportId: string) => void;
  reportSuggestion: WorkbenchSessionSnapshot['reportSuggestion'];
  onPromptSubmit: (prompt: string, attachmentIds: string[]) => void | Promise<void>;
};

export function ReportsPanel({
  sessionId,
  reports,
  selectedReportId,
  onSelectReport,
  reportSuggestion,
  onPromptSubmit
}: ReportsPanelProps) {
  const selectedReport = reports.find((artifact) => artifact.id === selectedReportId) ?? reports[0] ?? null;

  return (
    <section className="inspector-section reports-panel" aria-label="Reports">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Reports</p>
          <h2>HTML artifacts</h2>
        </div>
        <span className="count-badge tone-neutral">{reports.length}</span>
      </div>

      {reports.length ? (
        <>
          <div className="report-card-list">
            {reports.map((artifact) => {
              const selected = selectedReport?.id === artifact.id;
              return (
                <button
                  key={artifact.id}
                  type="button"
                  className={`report-card ${selected ? 'is-selected' : ''}`}
                  onClick={() => onSelectReport(artifact.id)}
                >
                  <FileText size={16} />
                  <span>
                    <strong>{artifact.title}</strong>
                    <small>
                      {artifact.toolName} - {formatToolSource(artifact.source)} - {formatBytes(artifact.size)}
                    </small>
                  </span>
                  <ExternalLink size={14} />
                </button>
              );
            })}
          </div>

          {selectedReport ? (
            <iframe
              title={selectedReport.title}
              className="report-frame"
              src={buildReportPath(sessionId, selectedReport.id)}
            />
          ) : null}
        </>
      ) : reportSuggestion ? (
        <article className="suggestion-card">
          <Info size={17} />
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
                Run specialized report anyway
              </button>
            ) : null}
          </div>
        </article>
      ) : (
        <p className="muted-panel">No generated reports yet.</p>
      )}
    </section>
  );
}
