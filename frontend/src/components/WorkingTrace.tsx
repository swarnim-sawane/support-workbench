import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock3,
  LoaderCircle,
  ShieldAlert
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type {
  WorkbenchProgressActivity,
  WorkbenchSessionSnapshot,
  WorkbenchToolActivity
} from '../types';
import {
  buildFriendlyToolActivityDetail,
  buildFriendlyToolActivityTitle,
  buildToolActivitySummary
} from './utils';

type WorkingTraceProps = {
  snapshot: WorkbenchSessionSnapshot;
  isBooting?: boolean;
  showThinking?: boolean;
  label?: string;
};

export function WorkingTrace({
  snapshot,
  isBooting = false,
  showThinking = false,
  label
}: WorkingTraceProps) {
  const active = isBooting || snapshot.status === 'running' || snapshot.status === 'awaiting_approval';
  const trace = useMemo(
    () => buildObservableTrace(snapshot, { isBooting, showThinking, label }),
    [snapshot, isBooting, showThinking, label]
  );
  const elapsed = useElapsedLabel(active, firstStartedAt(snapshot));

  if (!trace.steps.length) {
    return null;
  }

  return (
    <details
      className="working-trace"
      role="status"
      aria-live="polite"
      aria-label={trace.summary}
      open
    >
      <summary className="working-summary">
        <span className="working-loader" aria-hidden="true">
          {active ? <LoaderCircle className="spin" size={15} /> : <Clock3 size={15} />}
        </span>
        <span className="working-summary-copy">
          <strong>{trace.summary}</strong>
          <span>{buildElapsedSummary(active, elapsed)}</span>
        </span>
        <ChevronRight className="transcript-caret" size={15} aria-hidden="true" />
      </summary>
      <div className="working-step-list">
        {trace.steps.map((step) => (
          <div key={`${step.kind}-${step.text}`} className={`working-step ${step.kind}`}>
            <span aria-hidden="true">
              {step.kind === 'approval' ? (
                <ShieldAlert size={14} />
              ) : step.kind === 'error' ? (
                <AlertTriangle size={14} />
              ) : step.kind === 'active' ? (
                <LoaderCircle className="spin" size={14} />
              ) : (
                <CheckCircle2 size={14} />
              )}
            </span>
            <span className={step.kind === 'active' ? 'shimmer-text' : undefined}>{step.text}</span>
          </div>
        ))}
      </div>
    </details>
  );
}

type ObservableStep = {
  text: string;
  kind: 'active' | 'completed' | 'approval' | 'error';
};

function buildObservableTrace(
  snapshot: WorkbenchSessionSnapshot,
  input: { isBooting: boolean; showThinking: boolean; label?: string }
): { summary: string; steps: ObservableStep[] } {
  if (input.isBooting) {
    const text = input.label ?? 'Booting local runtime';
    return { summary: text, steps: [{ text, kind: 'active' }] };
  }

  const pendingApproval = snapshot.pendingApprovals[0];
  if (pendingApproval) {
    const text = `Waiting for ${pendingApproval.toolName} approval`;
    return { summary: text, steps: [{ text, kind: 'approval' }] };
  }

  const progressActivities = snapshot.progressActivity ?? [];
  const progressPhases = progressActivities.filter((activity) => activity.phase !== 'tool.executing');
  const runningProgress = findLatest(progressPhases, (activity) => activity.status === 'running');
  const runningActivities = snapshot.toolActivity.filter((activity) => activity.status === 'running');
  const failedActivity = findLatest(
    snapshot.toolActivity,
    (activity) => activity.status === 'failed' || activity.status === 'denied'
  );

  if (snapshot.status === 'blocked') {
    const failureText = failedActivity
      ? withOptionalDetail(
          buildFriendlyToolActivityTitle(failedActivity),
          failedActivity.error ?? buildFriendlyToolActivityDetail(failedActivity)
        )
      : 'Processing stopped before a final answer';
    const completedSteps = [
      ...progressPhases
        .filter((activity) => activity.status === 'completed')
        .slice(-2)
        .reverse()
        .map((activity) => toProgressStep(activity, 'completed')),
      ...buildCompletedToolSteps(snapshot.toolActivity)
    ];

    return {
      summary: 'Processing blocked',
      steps: compactSteps([{ text: failureText, kind: 'error' }, ...completedSteps]).slice(0, 5)
    };
  }

  const recoverableFailure = snapshot.toolActivity.find(
    (activity) => activity.status === 'failed' && activity.recoverable
  );
  if (recoverableFailure && snapshot.status === 'running') {
    const text = `Recovering from ${recoverableFailure.toolName} error`;
    return {
      summary: text,
      steps: [
        {
          text,
          kind: 'error'
        },
        {
          text: recoverableFailure.recoveryInstruction ?? buildToolActivitySummary(recoverableFailure),
          kind: 'active'
        }
      ]
    };
  }

  const currentStep = runningActivities.length
    ? buildRunningToolStep(runningActivities)
    : runningProgress
      ? toProgressStep(runningProgress, 'active')
      : null;
  if (currentStep) {
    const completedProgressSteps = progressPhases
      .filter((activity) => activity.id !== runningProgress?.id && activity.status === 'completed')
      .slice(-2)
      .reverse()
      .map((activity) => toProgressStep(activity, 'completed'));
    const completedToolSteps = buildCompletedToolSteps(snapshot.toolActivity);
    const steps = compactSteps([currentStep, ...completedProgressSteps, ...completedToolSteps]).slice(0, 5);

    return {
      summary: runningProgress ? runningProgress.label : currentStep.text,
      steps
    };
  }

  const runningAgent = snapshot.agents.find((agent) => agent.status === 'running');
  if (runningAgent) {
    const text = `${runningAgent.agentType} agent is working`;
    return { summary: text, steps: [{ text, kind: 'active' }] };
  }

  const pendingAttachment = snapshot.attachments.find((attachment) => attachment.ocrStatus === 'pending');
  if (pendingAttachment) {
    const text = `Processing ${pendingAttachment.originalName}`;
    return { summary: text, steps: [{ text, kind: 'active' }] };
  }

  if (input.showThinking || snapshot.status === 'running') {
    const text = input.label ?? 'Preparing answer';
    return { summary: text, steps: [{ text, kind: 'active' }] };
  }

  if (snapshot.status === 'completed') {
    const completedProgressSteps = progressPhases
      .filter((activity) => activity.status === 'completed')
      .slice(-2)
      .reverse()
      .map((activity) => toProgressStep(activity, 'completed'));
    const completedToolSteps = buildCompletedToolSteps(snapshot.toolActivity);
    const steps = compactSteps([...completedProgressSteps, ...completedToolSteps]).slice(0, 5);

    if (steps.length) {
      return {
        summary: 'Analysis complete',
        steps
      };
    }
  }

  return { summary: '', steps: [] };
}

function toProgressStep(
  activity: WorkbenchProgressActivity,
  kind: 'active' | 'completed'
) {
  return {
    text: toProgressText(activity),
    kind
  } as const;
}

function toProgressText(activity: WorkbenchProgressActivity): string {
  return activity.detail ? `${activity.label} - ${activity.detail}` : activity.label;
}

function buildRunningToolStep(activities: WorkbenchToolActivity[]): ObservableStep {
  if (activities.length > 1) {
    const toolNames = [...new Set(activities.map((activity) => activity.toolName))].slice(0, 3);
    return {
      text: `Inspecting evidence with ${activities.length} tools - ${toolNames.join(', ')}`,
      kind: 'active'
    };
  }

  return {
    text: withOptionalDetail(
      buildFriendlyToolActivityTitle(activities[0]),
      buildFriendlyToolActivityDetail(activities[0])
    ),
    kind: 'active'
  };
}

function buildCompletedToolSteps(activities: WorkbenchToolActivity[]): ObservableStep[] {
  const completed = activities.filter((activity) => activity.status === 'completed').reverse();
  const grouped = new Map<
    string,
    {
      count: number;
      latest: WorkbenchToolActivity;
    }
  >();

  for (const activity of completed) {
    const existing = grouped.get(activity.toolName);
    if (existing) {
      existing.count += 1;
      continue;
    }
    grouped.set(activity.toolName, { count: 1, latest: activity });
  }

  return Array.from(grouped.values())
    .slice(0, 3)
    .map(({ count, latest }) => ({
      text:
        count > 1
          ? buildGroupedToolText(latest, count)
          : withOptionalDetail(
              buildFriendlyToolActivityTitle(latest),
              buildFriendlyToolActivityDetail(latest)
            ),
      kind: 'completed' as const
    }));
}

function buildGroupedToolText(activity: WorkbenchToolActivity, count: number): string {
  const detail = buildFriendlyToolActivityDetail(activity);
  const latest = detail ? `Latest: ${detail}` : undefined;

  if (activity.toolName === 'Read' || activity.toolName === 'read_file_text') {
    return withOptionalDetail(`Read ${count} files`, latest);
  }
  if (activity.toolName === 'Grep') {
    return withOptionalDetail(`Searched uploaded logs ${count} times`, latest);
  }
  if (activity.toolName === 'Glob') {
    return withOptionalDetail(`Matched file patterns ${count} times`, latest);
  }
  return withOptionalDetail(`Used ${activity.toolName} ${count} times`, latest);
}

function withOptionalDetail(text: string, detail?: string): string {
  return detail ? `${text} - ${detail}` : text;
}

function compactSteps(steps: ObservableStep[]): ObservableStep[] {
  const seen = new Set<string>();
  const compacted: ObservableStep[] = [];
  for (const step of steps) {
    const key = `${step.kind}:${step.text}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    compacted.push(step);
  }
  return compacted;
}

function findLatest<T>(items: T[], predicate: (item: T) => boolean): T | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index])) {
      return items[index];
    }
  }
  return undefined;
}

function firstStartedAt(snapshot: WorkbenchSessionSnapshot): string | undefined {
  const runningProgressStartedAt = (snapshot.progressActivity ?? []).find(
      (activity) => activity.status === 'running' && activity.startedAt
    )?.startedAt;
  const runningToolStartedAt = snapshot.toolActivity.find(
    (activity) => activity.status === 'running' && activity.startedAt
  )?.startedAt;

  if (snapshot.status === 'running' || snapshot.status === 'awaiting_approval') {
    return snapshot.session.activeTurnStartedAt ?? runningProgressStartedAt ?? runningToolStartedAt;
  }

  return (
    snapshot.session.activeTurnStartedAt ??
    runningProgressStartedAt ??
    runningToolStartedAt ??
    (snapshot.progressActivity ?? []).find((activity) => activity.startedAt)?.startedAt ??
    snapshot.toolActivity.find((activity) => activity.startedAt)?.startedAt
  );
}

function useElapsedLabel(active: boolean, startedAt?: string): string | null {
  const [now, setNow] = useState(() => Date.now());
  const start = parseStableTime(startedAt);

  useEffect(() => {
    if (!active || start === null) {
      return undefined;
    }

    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active, start]);

  if (!active || start === null) {
    return null;
  }

  const seconds = Math.max(0, Math.floor((now - start) / 1000));

  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

function parseStableTime(value?: string): number | null {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function buildElapsedSummary(active: boolean, elapsed: string | null): string {
  if (active) {
    return elapsed ? `Working for ${elapsed}` : 'Working';
  }

  return elapsed ? `Worked for ${elapsed}` : 'Worked';
}
