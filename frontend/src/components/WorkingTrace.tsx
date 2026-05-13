import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock3,
  LoaderCircle,
  ShieldAlert
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { WorkbenchSessionSnapshot } from '../types';
import { buildToolActivitySummary } from './utils';

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
  const steps = useMemo(
    () => buildObservableSteps(snapshot, { isBooting, showThinking, label }),
    [snapshot, isBooting, showThinking, label]
  );
  const elapsed = useElapsedLabel(active, firstStartedAt(snapshot));

  if (!steps.length) {
    return null;
  }

  return (
    <details
      className="working-trace"
      role="status"
      aria-live="polite"
      aria-label={steps[0]?.text}
      open
    >
      <summary className="working-summary">
        <span className="working-loader" aria-hidden="true">
          {active ? <LoaderCircle className="spin" size={15} /> : <Clock3 size={15} />}
        </span>
        <strong>{buildElapsedSummary(active, elapsed)}</strong>
        <ChevronRight className="transcript-caret" size={15} aria-hidden="true" />
      </summary>
      <div className="working-step-list">
        {steps.map((step, index) => (
          <div key={`${step.kind}-${step.text}`} className={`working-step ${step.kind}`}>
            <span aria-hidden="true">
              {step.kind === 'approval' ? (
                <ShieldAlert size={14} />
              ) : step.kind === 'error' ? (
                <AlertTriangle size={14} />
              ) : active && index === 0 ? (
                <LoaderCircle className="spin" size={14} />
              ) : (
                <CheckCircle2 size={14} />
              )}
            </span>
            <span className={active && index === 0 ? 'shimmer-text' : undefined}>{step.text}</span>
          </div>
        ))}
      </div>
    </details>
  );
}

function buildObservableSteps(
  snapshot: WorkbenchSessionSnapshot,
  input: { isBooting: boolean; showThinking: boolean; label?: string }
) {
  if (input.isBooting) {
    return [{ text: input.label ?? 'Booting local runtime', kind: 'active' as const }];
  }

  const pendingApproval = snapshot.pendingApprovals[0];
  if (pendingApproval) {
    return [
      {
        text: `Waiting for ${pendingApproval.toolName} approval`,
        kind: 'approval' as const
      }
    ];
  }

  const runningActivities = snapshot.toolActivity.filter((activity) => activity.status === 'running');
  if (runningActivities.length) {
    return runningActivities.slice(0, 3).map((activity) => ({
      text: `Running ${activity.toolName}`,
      kind: 'active' as const
    }));
  }

  const recoverableFailure = snapshot.toolActivity.find(
    (activity) => activity.status === 'failed' && activity.recoverable
  );
  if (recoverableFailure && snapshot.status === 'running') {
    return [
      {
        text: `Recovering from ${recoverableFailure.toolName} error`,
        kind: 'error' as const
      },
      {
        text: recoverableFailure.recoveryInstruction ?? buildToolActivitySummary(recoverableFailure),
        kind: 'active' as const
      }
    ];
  }

  const runningAgent = snapshot.agents.find((agent) => agent.status === 'running');
  if (runningAgent) {
    return [
      {
        text: `${runningAgent.agentType} agent is working`,
        kind: 'active' as const
      }
    ];
  }

  const pendingAttachment = snapshot.attachments.find((attachment) => attachment.ocrStatus === 'pending');
  if (pendingAttachment) {
    return [
      {
        text: `Processing ${pendingAttachment.originalName}`,
        kind: 'active' as const
      }
    ];
  }

  if (input.showThinking || snapshot.status === 'running') {
    return [{ text: input.label ?? 'Preparing answer', kind: 'active' as const }];
  }

  return [];
}

function firstStartedAt(snapshot: WorkbenchSessionSnapshot): string | undefined {
  return (
    snapshot.session.activeTurnStartedAt ??
    snapshot.toolActivity.find((activity) => activity.status === 'running' && activity.startedAt)?.startedAt
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
