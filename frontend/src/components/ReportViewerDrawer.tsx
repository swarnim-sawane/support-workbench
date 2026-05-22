import { ExternalLink, X } from 'lucide-react';
import { useEffect } from 'react';
import type { WorkbenchReportArtifact } from '../types';
import { buildReportPath, formatBytes, formatToolSource } from './utils';

type ReportViewerDrawerProps = {
  sessionId: string;
  report: WorkbenchReportArtifact | null;
  open: boolean;
  onClose: () => void;
};

export function ReportViewerDrawer({ sessionId, report, open, onClose }: ReportViewerDrawerProps) {
  useEffect(() => {
    if (!open) {
      return undefined;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open || !report) {
    return null;
  }

  return (
    <aside className="report-viewer-drawer" aria-label="Report viewer">
      <div className="report-viewer-head">
        <div>
          <p className="eyebrow">HTML Report</p>
          <h2>{report.title}</h2>
          <small>
            {report.toolName} - {formatToolSource(report.source)} - {formatBytes(report.size)}
          </small>
        </div>
        <div className="report-viewer-actions">
          <a
            className="icon-button"
            href={buildReportPath(sessionId, report.id)}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open ${report.title} in new tab`}
          >
            <ExternalLink size={17} />
          </a>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close report viewer">
            <X size={17} />
          </button>
        </div>
      </div>
      <iframe
        title={report.title}
        className="report-frame"
        src={buildReportPath(sessionId, report.id)}
      />
    </aside>
  );
}
