import type {
  WorkbenchAttachment,
  WorkbenchBackgroundAgent,
  WorkbenchSessionSnapshot,
  WorkbenchToolActivity
} from '../types';

export function formatBytes(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function buildAttachmentStatus(attachment: WorkbenchAttachment): string {
  if (attachment.promptVisibility === 'removed') {
    return 'Removed';
  }

  if (attachment.kind === 'image') {
    if (attachment.ocrStatus === 'pending') {
      return 'OCR pending';
    }
    if (attachment.ocrStatus === 'completed') {
      return 'OCR ready';
    }
    if (attachment.ocrStatus === 'failed') {
      return 'OCR failed';
    }
  }

  return 'Ready for analysis';
}

export function buildReportPath(sessionId: string, reportId: string): string {
  return `/api/session/${sessionId}/reports/${reportId}/content`;
}

export function buildIntegrationStatus(snapshot: WorkbenchSessionSnapshot): string {
  if (snapshot.integrations.jdMcp.connected) {
    return 'jd-mcp connected';
  }
  if (snapshot.integrations.jdMcp.available) {
    return 'jd-mcp available';
  }
  return 'jd-mcp unavailable';
}

export function buildToolDescriptorLabel(
  tool: WorkbenchSessionSnapshot['integrations']['jdMcp']['toolDescriptors'][number]
): string {
  if (tool.visibility === 'unsupported') {
    return `${tool.name} unavailable${tool.reason ? `: ${tool.reason}` : ''}`;
  }
  return tool.name;
}

export function buildToolActivitySummary(activity: WorkbenchToolActivity): string {
  if (activity.status === 'completed') {
    return activity.summary ?? 'Completed';
  }
  if (activity.status === 'failed') {
    return activity.error ?? 'Failed';
  }
  if (activity.status === 'denied') {
    return activity.error ? `Denied: ${activity.error}` : 'Denied';
  }
  if (activity.status === 'running') {
    return 'Running now';
  }
  return activity.reasoning ?? 'Waiting for approval';
}

export function buildAgentSummary(agent: WorkbenchBackgroundAgent): string {
  if (agent.status === 'failed') {
    return agent.error ?? 'Background agent failed';
  }
  if (agent.status === 'completed') {
    return agent.resultSummary ?? 'Background agent completed';
  }
  if (agent.status === 'running') {
    return 'Investigating in the background';
  }
  if (agent.status === 'cancelled') {
    return 'Cancelled';
  }
  return 'Queued';
}

export function buildReportSuggestionTitle(
  suggestion: WorkbenchSessionSnapshot['reportSuggestion']
): string {
  if (suggestion?.reasonCode === 'analyzer_unavailable_direct_analysis_used') {
    return 'Analyzer unavailable, direct analysis used';
  }
  if (suggestion?.reasonCode === 'explicit_tool_request_not_honored') {
    return 'Direct analysis fallback used';
  }
  return 'Why no report?';
}

export function statusTone(status: WorkbenchToolActivity['status']): string {
  if (status === 'completed') {
    return 'tone-ok';
  }
  if (status === 'failed' || status === 'denied') {
    return 'tone-danger';
  }
  if (status === 'running') {
    return 'tone-active';
  }
  return 'tone-waiting';
}
