import { BadgeCheck, FileText, ShieldAlert, ShieldCheck, ShieldX } from 'lucide-react';
import { useEffect } from 'react';
import type { PendingApproval } from '../types';

type ApprovalOverlayProps = {
  approvals: PendingApproval[];
  onApprove: (requestId: string, decision: 'allow' | 'deny') => void | Promise<void>;
};

export function ApprovalOverlay({ approvals, onApprove }: ApprovalOverlayProps) {
  const approval = approvals[0];

  useEffect(() => {
    if (!approval) {
      return undefined;
    }

    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const editable =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable === true;
      if (editable) {
        return;
      }
      if (event.key === '1') {
        event.preventDefault();
        void onApprove(approval.requestId, 'allow');
      }
      if (event.key === '3') {
        event.preventDefault();
        void onApprove(approval.requestId, 'deny');
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [approval, onApprove]);

  if (!approval) {
    return null;
  }

  return (
    <div className="permission-overlay" role="presentation">
      <section
        className="permission-card"
        role="dialog"
        aria-modal="true"
        aria-label={`Permission request for ${approval.toolName}`}
      >
        <div className="permission-preview">
          <div className="permission-preview-head">
            <span className="permission-icon" aria-hidden="true">
              <ShieldAlert size={18} />
            </span>
            <div>
              <p className="eyebrow">Permission Request</p>
              <strong>{approval.toolName}</strong>
            </div>
            {approvals.length > 1 ? (
              <span className="count-badge tone-active">{approvals.length}</span>
            ) : null}
          </div>
          <pre>{JSON.stringify(approval.input, null, 2)}</pre>
        </div>

        <div className="permission-copy">
          <h2>Do you want to allow {approval.toolName}?</h2>
          <p>{approval.reasoning ?? 'The agent needs this tool to continue.'}</p>

          <div className="badge-row">
            <span>{approval.source ?? 'builtin'}</span>
            {approval.category ? <span>{approval.category}</span> : null}
            {approval.producesReports ? (
              <span>
                <FileText size={12} /> report
              </span>
            ) : null}
            {approval.agentId ? <span>{approval.agentType ?? 'general'} agent</span> : null}
          </div>
        </div>

        <div className="permission-actions" aria-label={`Decisions for ${approval.toolName}`}>
          <button
            type="button"
            className="permission-action primary"
            aria-label={`Allow ${approval.toolName}`}
            onClick={() => void onApprove(approval.requestId, 'allow')}
          >
            <span>1</span>
            <BadgeCheck size={15} />
            Allow
          </button>
          <button
            type="button"
            className="permission-action"
            aria-label={`Allow and remember ${approval.toolName}`}
            onClick={() => void onApprove(approval.requestId, 'allow')}
          >
            <span>2</span>
            <ShieldCheck size={15} />
            Allow and remember
          </button>
          <button
            type="button"
            className="permission-action ghost"
            aria-label={`Deny ${approval.toolName}`}
            onClick={() => void onApprove(approval.requestId, 'deny')}
          >
            <span>3</span>
            <ShieldX size={15} />
            Deny
          </button>
          <button
            type="button"
            className="permission-action ghost"
            aria-label={`Skip ${approval.toolName}`}
            onClick={() => void onApprove(approval.requestId, 'deny')}
          >
            Skip
          </button>
        </div>
      </section>
    </div>
  );
}
