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
import { parseLogScanMetadata } from '../derivedSupportState';
import {
  buildAgentSummary,
  buildChatReportCardId,
  buildFriendlyToolActivityTitle,
  buildFriendlyToolGroupTitle,
  buildReportPath,
  buildReportSuggestionTitle,
  buildToolActivitySummary,
  formatBytes,
  formatSpecializedToolText,
  formatToolSource,
  statusTone
} from './utils';

type RuntimeEventStackProps = {
  snapshot: WorkbenchSessionSnapshot;
  reportSuggestion: WorkbenchSessionSnapshot['reportSuggestion'];
  selectedReportId?: string | null;
  onPromptSubmit: (prompt: string, attachmentIds: string[]) => void | Promise<void>;
};

export function RuntimeEventStack({
  snapshot,
  reportSuggestion,
  selectedReportId = null,
  onPromptSubmit
}: RuntimeEventStackProps) {
  const contextCount =
    snapshot.tasks.length + snapshot.memory.entries.length + snapshot.history.summaries.length;
  const visibleToolActivity = buildVisibleToolActivity(snapshot.toolActivity, snapshot.status);
  const hasLiveToolActivity = visibleToolActivity.some(
    (activity) => activity.status === 'running' || activity.status === 'pending'
  );
  const hasRuntimeContent =
    visibleToolActivity.length > 0 ||
    snapshot.reports.artifacts.length > 0 ||
    Boolean(reportSuggestion) ||
    snapshot.agents.length > 0 ||
    contextCount > 0;

  if (!hasRuntimeContent) {
    return null;
  }

  return (
    <div className="runtime-stack" aria-label="Runtime events">
      {visibleToolActivity.length ? (
        hasLiveToolActivity ? (
          <TranscriptEventLine
            title={buildFriendlyToolGroupTitle(visibleToolActivity)}
            subtitle={buildToolGroupSubtitle(visibleToolActivity)}
            icon={buildToolGroupIcon(visibleToolActivity)}
            tone={buildToolGroupTone(visibleToolActivity)}
          />
        ) : (
          <TranscriptEventGroup
            title={buildFriendlyToolGroupTitle(visibleToolActivity)}
            icon={buildToolGroupIcon(visibleToolActivity)}
            subtitle={buildToolGroupSubtitle(visibleToolActivity)}
            tone={buildToolGroupTone(visibleToolActivity)}
            open={shouldOpenToolGroup(visibleToolActivity)}
          >
            <div className="runtime-list">
              {visibleToolActivity.slice(0, 8).map((activity) => (
                <ToolRuntimeRow key={activity.requestId} activity={activity} />
              ))}
            </div>
          </TranscriptEventGroup>
        )
      ) : null}

      {snapshot.reports.artifacts.length ? (
        snapshot.reports.artifacts.map((artifact) => (
          <ReportInlineCard
            key={artifact.id}
            sessionId={snapshot.sessionId}
            artifact={artifact}
            selected={artifact.id === selectedReportId}
          />
        ))
      ) : null}

      {reportSuggestion ? (
        <TranscriptEventGroup
          title={buildReportSuggestionTitle(reportSuggestion)}
          subtitle="Specialized report handoff"
          icon={<Info size={15} />}
          tone={reportSuggestion.available ? 'tone-active' : 'tone-waiting'}
          open
        >
          <div className="runtime-list compact">
            <p><LinkifiedText text={formatSpecializedToolText(reportSuggestion.explanation)} /></p>
            <small>Recommended tool: {reportSuggestion.suggestedToolName}</small>
            {reportSuggestion.canRun ? (
              <button
                type="button"
                className="secondary-action inline"
                onClick={() => void onPromptSubmit('/report', reportSuggestion.attachmentIds)}
              >
                Run specialized report anyway
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
          subtitle="Available to this case"
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

function LinkifiedText({ text }: { text: string }) {
  const pattern = /(https?:\/\/[^\s<)"]+)/gi;
  const parts = text.split(pattern);
  return (
    <>
      {parts.map((part, index) => {
        if (part.match(pattern)) {
          let url = part;
          let trailing = '';
          const matchTrailing = url.match(/[.,;:!?]+$/);
          if (matchTrailing) {
            trailing = matchTrailing[0];
            url = url.slice(0, -trailing.length);
          }
          return (
            <span key={index}>
              <a href={url} target="_blank" rel="noopener noreferrer">
                {url}
              </a>
              {trailing}
            </span>
          );
        }
        return part;
      })}
    </>
  );
}

function TranscriptEventLine({
  title,
  subtitle,
  icon,
  tone
}: {
  title: string;
  subtitle?: string;
  icon: ReactNode;
  tone: string;
}) {
  return (
    <div
      className={`transcript-event-group transcript-event-line ${tone}`}
      role="status"
      aria-live="polite"
      aria-label={subtitle ? `${title}. ${subtitle}` : title}
    >
      <span className="transcript-event-summary">
        <span className="runtime-row-icon" aria-hidden="true">
          {icon}
        </span>
        <span className="transcript-event-copy">
          <strong>{title}</strong>
          {subtitle ? <small>{subtitle}</small> : null}
        </span>
      </span>
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
        <span className="transcript-event-copy">
          <strong>{buildAgentGroupTitle(agents)}</strong>
          <small>{tone === 'tone-active' ? 'Background diagnosis in progress' : 'Background findings ready'}</small>
        </span>
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
  subtitle,
  icon,
  tone,
  open = false,
  children
}: {
  title: string;
  subtitle?: string;
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
        <span className="transcript-event-copy">
          <strong>{title}</strong>
          {subtitle ? <small>{subtitle}</small> : null}
        </span>
        <ChevronRight className="transcript-caret" size={15} aria-hidden="true" />
      </summary>
      <div className="transcript-event-body">{children}</div>
    </details>
  );
}

function ToolRuntimeRow({ activity }: { activity: WorkbenchToolActivity }) {
  const title = buildToolActivityTitle(activity);
  const isActive = activity.status === 'running' || activity.status === 'pending';
  const shouldOpen = isActive || activity.status === 'failed' || activity.status === 'denied';

  return (
    <details
      className={`runtime-row runtime-detail-row ${statusTone(activity.status)} ${isActive ? 'is-active' : 'is-settled'}`}
      open={shouldOpen}
    >
      <summary>
        <span className="runtime-row-icon" aria-hidden="true">
          <ActivityStatusIcon activity={activity} />
        </span>
        <span>
          <strong>{title}</strong>
          <small>
            {formatToolSource(activity.source)}
            {activity.category ? ` - ${activity.category}` : ''}
            {activity.artifacts?.length ? ` - reports=${activity.artifacts.length}` : ''}
            {activity.recoverable ? ` - recovery ${activity.recoveryAttempt ?? 1}` : ''}
          </small>
        </span>
        <ChevronRight className="transcript-caret" size={15} aria-hidden="true" />
      </summary>
      <div className="runtime-detail-body">
        <p><LinkifiedText text={buildToolActivitySummary(activity)} /></p>
        {activity.reasoning ? <small>Reasoning: <LinkifiedText text={formatSpecializedToolText(activity.reasoning)} /></small> : null}
        {activity.error ? <small>Error: <LinkifiedText text={formatSpecializedToolText(activity.error)} /></small> : null}
        {activity.recoveryInstruction ? <small>Recovery: <LinkifiedText text={formatSpecializedToolText(activity.recoveryInstruction)} /></small> : null}
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

function ReportInlineCard({
  sessionId,
  artifact,
  selected
}: {
  sessionId: string;
  artifact: WorkbenchReportArtifact;
  selected: boolean;
}) {
  return (
    <article
      id={buildChatReportCardId(artifact.id)}
      className="report-inline-card"
      data-selected={selected ? 'true' : 'false'}
      aria-label={`HTML report ${artifact.title}`}
      tabIndex={-1}
    >
      <div className="report-inline-head">
        <span className="runtime-row-icon" aria-hidden="true">
          <FileText size={15} />
        </span>
        <span className="report-inline-copy">
          <span className="eyebrow">HTML report</span>
          <strong>{artifact.title}</strong>
          <small>
            {artifact.toolName} - {formatToolSource(artifact.source)} - {formatBytes(artifact.size)}
          </small>
        </span>
      </div>
      <div className="report-inline-frame-shell">
        <iframe
          title={artifact.title}
          className="report-inline-frame"
          src={buildReportPath(sessionId, artifact.id)}
          loading="lazy"
        />
      </div>
    </article>
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

function shouldOpenToolGroup(activities: WorkbenchToolActivity[]): boolean {
  return activities.some((activity) =>
    activity.status === 'running' ||
    activity.status === 'pending' ||
    activity.status === 'failed' ||
    activity.status === 'denied'
  );
}

function buildVisibleToolActivity(
  activities: WorkbenchToolActivity[],
  sessionStatus: WorkbenchSessionSnapshot['status']
): WorkbenchToolActivity[] {
  const isGenerating = sessionStatus === 'running';
  const liveActivities = activities.filter((activity) =>
    activity.status === 'running' ||
    activity.status === 'pending' ||
    activity.status === 'failed' ||
    activity.status === 'denied'
  );

  return isGenerating ? liveActivities : activities;
}

function buildToolGroupSubtitle(activities: WorkbenchToolActivity[]): string {
  if (activities.some((activity) => activity.status === 'running')) {
    return 'Inspecting uploaded evidence';
  }
  if (activities.some((activity) => activity.status === 'pending')) {
    return 'Waiting for approval';
  }
  if (activities.some((activity) => activity.status === 'failed' || activity.status === 'denied')) {
    return 'Needs attention';
  }

  const logScanActivity = activities.find(
    (activity) => activity.toolName === 'LogScan' && activity.status === 'completed'
  );
  if (logScanActivity) {
    const coverage = parseLogScanMetadata(logScanActivity.metadata);
    if (!coverage) {
      return 'Full-file LogScan complete';
    }

    const findings = [
      coverage.errors ? `${coverage.errors} ${pluralize(coverage.errors, 'error')}` : null,
      coverage.http5xx ? `${coverage.http5xx} HTTP 5xx` : null,
      coverage.slowRequests
        ? `${coverage.slowRequests} slow ${pluralize(coverage.slowRequests, 'request')}`
        : null
    ].filter(Boolean);

    return findings.length ? findings.slice(0, 3).join(' - ') : 'Full-file LogScan complete';
  }

  return `Completed ${activities.length} ${pluralize(activities.length, 'tool')}`;
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
