import { BadgeCheck, FileText, ShieldCheck, ShieldX } from 'lucide-react';
import type { PendingApproval } from '../types';

type ApprovalRailProps = {
  approvals: PendingApproval[];
  onApprove: (requestId: string, decision: 'allow' | 'deny') => void | Promise<void>;
};

export function ApprovalRail({ approvals, onApprove }: ApprovalRailProps) {
  return (
    <section className="inspector-section approval-rail" aria-label="Approval queue">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Approval Queue</p>
          <h2>Tool permissions</h2>
        </div>
        <span className={`count-badge ${approvals.length ? 'tone-active' : 'tone-neutral'}`}>
          {approvals.length}
        </span>
      </div>

      {approvals.length ? (
        <div className="approval-list">
          {approvals.map((approval) => (
            <article key={approval.requestId} className="approval-card">
              <div className="approval-title">
                <span className="approval-icon" aria-hidden="true">
                  <ShieldCheck size={17} />
                </span>
                <div>
                  <strong>{approval.toolName}</strong>
                  <p>{approval.reasoning ?? 'Runtime requested a tool.'}</p>
                </div>
              </div>

              <div className="badge-row">
                <span>{approval.source ?? 'builtin'}</span>
                {approval.category ? <span>{approval.category}</span> : null}
                {approval.producesReports ? (
                  <span>
                    <FileText size={12} /> report
                  </span>
                ) : null}
              </div>

              {approval.agentId ? (
                <p className="microcopy">
                  Background agent: {approval.agentType ?? 'general'} ({approval.agentId})
                </p>
              ) : null}

              <details className="json-disclosure">
                <summary>Input payload</summary>
                <pre>{JSON.stringify(approval.input, null, 2)}</pre>
              </details>

              <div className="segmented-actions">
                <button type="button" onClick={() => void onApprove(approval.requestId, 'allow')}>
                  <BadgeCheck size={15} />
                  Allow {approval.toolName}
                </button>
                <button type="button" onClick={() => void onApprove(approval.requestId, 'deny')}>
                  <ShieldX size={15} />
                  Deny {approval.toolName}
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="muted-panel">No pending approvals.</p>
      )}
    </section>
  );
}
