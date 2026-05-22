import { Sparkles } from 'lucide-react';

export function ShimmerThinking({ label = 'Planning the next diagnostic step' }: { label?: string }) {
  return (
    <div className="thinking-row" role="status" aria-live="polite" aria-label={label}>
      <span className="thinking-icon" aria-hidden="true">
        <Sparkles size={14} />
      </span>
      <span className="shimmer-text">{label}</span>
    </div>
  );
}
