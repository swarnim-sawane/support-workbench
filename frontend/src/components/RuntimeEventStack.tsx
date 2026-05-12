import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileText,
  History,
  Info,
  LoaderCircle,
  XCircle
} from 'lucide-react';
import type { ReactNode } from 'react';
import type {
  WorkbenchBackgroundAgent,
  WorkbenchReportArtifact,
  WorkbenchSessionSnapshot,
  WorkbenchToolActivity
} from '../types';
import {
  buildAgentSummary,
  buildFriendlyToolActivityTitle,
  buildFriendlyToolGroupTitle,
  buildReportSuggestionTitle,
  buildToolActivitySummary,
  formatBytes,
  statusTone
} from './utils';

type RuntimeEventStackProps = {
  snapshot: WorkbenchSessionSnapshot;
  reportSuggestion: WorkbenchSessionSnapshot['reportSuggestion'];
  onOpenReport: (reportId: string) => void;
  onPromptSubmit: (prompt: string, attachmentIds: string[]) => void | Promise<void>;
};

export function RuntimeEventStack({
  snapshot,
  reportSuggestion,
  onOpenReport,
  onPromptSubmit
}: RuntimeEventStackProps) {
  const contextCount =
    snapshot.tasks.length + snapshot.memory.entries.length + snapshot.history.summaries.length;
  const hasRuntimeContent =
    snapshot.toolActivity.length > 0 ||
    snapshot.reports.artifacts.length > 0 ||
    Boolean(reportSuggestion) ||
    snapshot.agents.length > 0 ||
    contextCount > 0;

  if (!hasRuntimeContent) {
    return null;
  }

  return (
    <div className="runtime-stack" aria-label="Runtime events">
      {snapshot.toolActivity.length ? (
          <TranscriptEventGroup
          title={buildFriendlyToolGroupTitle(snapshot.toolActivity)}
          icon={buildToolGroupIcon(snapshot.toolActivity)}
          tone={buildToolGroupTone(snapshot.toolActivity)}
          open
        >
          <div className="runtime-list">
            {snapshot.toolActivity.slice(0, 8).map((activity) => (
              <ToolRuntimeRow key={activity.requestId} activity={activity} />
            ))}
          </div>
        </TranscriptEventGroup>
      ) : null}

      {snapshot.reports.artifacts.length ? (
        <TranscriptEventGroup
          title={`Created ${snapshot.reports.artifacts.length} ${pluralize(
            snapshot.reports.artifacts.length,
            'report'
          )}`}
          icon={<FileText size={15} />}
          tone="tone-ok"
          open
        >
          <div className="report-chip-list">
            {snapshot.reports.artifacts.map((artifact) => (
              <ReportRuntimeButton
                key={artifact.id}
                artifact={artifact}
                onOpenReport={onOpenReport}
              />
            ))}
          </div>
        </TranscriptEventGroup>
      ) : null}

      {reportSuggestion ? (
        <TranscriptEventGroup
          title={buildReportSuggestionTitle(reportSuggestion)}
          icon={<Info size={15} />}
          tone={reportSuggestion.available ? 'tone-active' : 'tone-waiting'}
          open
        >
          <div className="runtime-list compact">
            <p>{reportSuggestion.explanation}</p>
            <small>Recommended tool: {reportSuggestion.suggestedToolName}</small>
            {reportSuggestion.canRun ? (
              <button
                type="button"
                className="secondary-action inline"
                onClick={() => void onPromptSubmit('/report', reportSuggestion.attachmentIds)}
              >
                Run jd-mcp report anyway
              </button>
            ) : null}
          </div>
        </TranscriptEventGroup>
      ) : null}

      {snapshot.agents.length ? (
        <AgentRuntimeGroup agents={snapshot.agents} />
      ) : null}

      {contextCount ? (
        <TranscriptEventGroup
          title={`Saved ${contextCount} ${pluralize(contextCount, 'context item')}`}
          icon={<History size={15} />}
          tone="tone-neutral"
          open
        >
          <div className="runtime-list compact">
            {snapshot.tasks.map((task) => (
              <p key={task.id}>
                Task: [{task.status === 'completed' ? 'x' : ' '}] {task.content}
              </p>
            ))}
            {snapshot.memory.entries.slice(0, 3).map((entry) => (
              <p key={entry.id}>Memory: {entry.content}</p>
            ))}
            {snapshot.history.summaries.slice(0, 3).map((summary) => (
              <p key={summary.id}>History: {summary.title} - {summary.preview}</p>
            ))}
          </div>
        </TranscriptEventGroup>
      ) : null}
    </div>
  );
}

function AgentRuntimeGroup({
  agents
}: {
  agents: WorkbenchBackgroundAgent[];
}) {
  const tone = agents.some((agent) => agent.status === 'running') ? 'tone-active' : 'tone-neutral';

  return (
    <div
      className={`transcript-event-group transcript-action-group ${tone}`}
      aria-label="Subagents"
    >
      <span className="transcript-event-summary">
        <span className="runtime-row-icon" aria-hidden="true">
          <Bot size={15} />
        </span>
        <strong>{buildAgentGroupTitle(agents)}</strong>
        <ChevronRight className="transcript-caret" size={15} aria-hidden="true" />
      </span>
      <span className="transcript-event-body">
        <span className="runtime-list">
          {agents.slice(0, 5).map((agent) => (
            <span key={agent.id} className={`runtime-row ${agent.status}`}>
              <span className="runtime-row-icon" aria-hidden="true">
                <Bot size={14} />
              </span>
              <span>
                <strong>
                  {agent.agentType} agent {agent.status}
                </strong>
                <span>{buildAgentSummary(agent)}</span>
              </span>
            </span>
          ))}
        </span>
      </span>
    </div>
  );
}

function TranscriptEventGroup({
  title,
  icon,
  tone,
  open = false,
  children
}: {
  title: string;
  icon: ReactNode;
  tone: string;
  open?: boolean;
  children: ReactNode;
}) {
  return (
    <details className={`transcript-event-group ${tone}`} open={open}>
      <summary className="transcript-event-summary">
        <span className="runtime-row-icon" aria-hidden="true">
          {icon}
        </span>
        <strong>{title}</strong>
        <ChevronRight className="transcript-caret" size={15} aria-hidden="true" />
      </summary>
      <div className="transcript-event-body">{children}</div>
    </details>
  );
}

function ToolRuntimeRow({ activity }: { activity: WorkbenchToolActivity }) {
  const title = buildToolActivityTitle(activity);

  return (
    <details className={`runtime-row runtime-detail-row ${statusTone(activity.status)}`}>
      <summary>
        <span className="runtime-row-icon" aria-hidden="true">
          <ActivityStatusIcon activity={activity} />
        </span>
        <span>
          <strong>{title}</strong>
          <small>
            {activity.source}
            {activity.category ? ` - ${activity.category}` : ''}
            {activity.artifacts?.length ? ` - reports=${activity.artifacts.length}` : ''}
            {activity.recoverable ? ` - recovery ${activity.recoveryAttempt ?? 1}` : ''}
          </small>
        </span>
        <ChevronRight className="transcript-caret" size={15} aria-hidden="true" />
      </summary>
      <div className="runtime-detail-body">
        <p>{buildToolActivitySummary(activity)}</p>
        {activity.reasoning ? <small>Reasoning: {activity.reasoning}</small> : null}
        {activity.error ? <small>Error: {activity.error}</small> : null}
        {activity.recoveryInstruction ? <small>Recovery: {activity.recoveryInstruction}</small> : null}
        <RuntimeJsonBlock label="Input" value={activity.input} />
        {activity.metadata ? <RuntimeJsonBlock label="Metadata" value={activity.metadata} /> : null}
        {activity.artifacts?.length ? (
          <div className="tool-artifact-list">
            {activity.artifacts.map((artifact) => (
              <span key={artifact.id}>
                {artifact.title} - {formatBytes(artifact.size)}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </details>
  );
}

function RuntimeJsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <details className="json-block">
      <summary>{label}</summary>
      <pre>{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}

function ActivityStatusIcon({ activity }: { activity: WorkbenchToolActivity }) {
  if (activity.status === 'running') {
    return <LoaderCircle className="spin" size={14} />;
  }
  if (activity.status === 'completed') {
    return <CheckCircle2 size={14} />;
  }
  if (activity.status === 'failed') {
    return <AlertTriangle size={14} />;
  }
  if (activity.status === 'denied') {
    return <XCircle size={14} />;
  }
  return <Clock3 size={14} />;
}

function ReportRuntimeButton({
  artifact,
  onOpenReport
}: {
  artifact: WorkbenchReportArtifact;
  onOpenReport: (reportId: string) => void;
}) {
  return (
    <button type="button" className="report-runtime-button" onClick={() => onOpenReport(artifact.id)}>
      <FileText size={15} />
      <span>
        <strong>{artifact.title}</strong>
        <small>
          {artifact.toolName} - {artifact.source} - {formatBytes(artifact.size)}
        </small>
      </span>
    </button>
  );
}

function buildToolGroupIcon(activities: WorkbenchToolActivity[]): ReactNode {
  if (activities.some((activity) => activity.status === 'running')) {
    return <LoaderCircle className="spin" size={15} />;
  }
  if (activities.some((activity) => activity.status === 'failed')) {
    return <AlertTriangle size={15} />;
  }
  return <CheckCircle2 size={15} />;
}

function buildToolGroupTone(activities: WorkbenchToolActivity[]): string {
  if (activities.some((activity) => activity.status === 'failed' || activity.status === 'denied')) {
    return 'tone-danger';
  }
  if (activities.some((activity) => activity.status === 'running' || activity.status === 'pending')) {
    return 'tone-active';
  }
  return 'tone-ok';
}

function buildToolActivityTitle(activity: WorkbenchToolActivity): string {
  return buildFriendlyToolActivityTitle(activity);
}

function buildAgentGroupTitle(agents: WorkbenchBackgroundAgent[]): string {
  const running = agents.filter((agent) => agent.status === 'running');
  if (running.length) {
    return `Running ${running.length} ${pluralize(running.length, 'subagent')}`;
  }
  return `Ran ${agents.length} ${pluralize(agents.length, 'subagent')}`;
}

function pluralize(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}
