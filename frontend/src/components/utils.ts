import type {
  WorkbenchAttachment,
  WorkbenchBackgroundAgent,
  WorkbenchSessionSnapshot,
  WorkbenchToolActivity
} from '../types';
import { formatLogScanActivityTitle } from '../derivedSupportState';

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
      return attachment.ocrError ? `OCR failed: ${attachment.ocrError}` : 'OCR failed';
    }
  }

  return 'Ready for analysis';
}

export function buildReportPath(sessionId: string, reportId: string): string {
  return `/api/session/${sessionId}/reports/${reportId}/content`;
}

export function buildChatReportCardId(reportId: string): string {
  return `chat-report-${reportId}`;
}

export function buildIntegrationStatus(snapshot: WorkbenchSessionSnapshot): string {
  if (snapshot.integrations.jdMcp.connected) {
    return 'Specialized tools connected';
  }
  if (snapshot.integrations.jdMcp.available) {
    return 'Specialized tools partially configured';
  }
  return 'Specialized tools unavailable';
}

export function formatToolSource(source: string | undefined): string {
  return source === 'jd-mcp' ? 'Specialized tools' : source ?? 'unknown';
}

export function formatSpecializedToolText(text: string | undefined): string {
  return (text ?? '')
    .replace(/JD_MCP_ROOT/g, 'Specialized tools root')
    .replace(/JD_MCP_JDTOOLS_JAVA/g, 'Specialized tools Java path')
    .replace(/JD_MCP_JDTOOLS_DIR/g, 'Specialized tools directory')
    .replace(/JD_MCP_FORMS_HOME/g, 'Specialized tools Forms home')
    .replace(/\bJD MCP HTML report(s?)\b/gi, 'specialized HTML report$1')
    .replace(/\bjd-mcp HTML report(s?)\b/gi, 'specialized HTML report$1')
    .replace(/\bJD MCP report(s?)\b/gi, 'specialized report$1')
    .replace(/\bjd-mcp report(s?)\b/gi, 'specialized report$1')
    .replace(/\bJD MCP\b/gi, 'Specialized tools')
    .replace(/\bjd-mcp\b/gi, 'Specialized tools');
}

export function buildToolDescriptorLabel(
  tool: WorkbenchSessionSnapshot['integrations']['jdMcp']['toolDescriptors'][number]
): string {
  if (tool.visibility === 'unsupported') {
    return formatSpecializedToolText(
      `${tool.name} unavailable${tool.reason ? `: ${tool.reason}` : ''}`
    );
  }
  return tool.name;
}

export function buildToolActivitySummary(activity: WorkbenchToolActivity): string {
  if (activity.status === 'completed') {
    return formatSpecializedToolText(activity.summary ?? 'Completed');
  }
  if (activity.status === 'failed') {
    return formatSpecializedToolText(activity.error ?? 'Failed');
  }
  if (activity.status === 'denied') {
    return formatSpecializedToolText(activity.error ? `Denied: ${activity.error}` : 'Denied');
  }
  if (activity.status === 'running') {
    return 'Running now';
  }
  return formatSpecializedToolText(activity.reasoning ?? 'Waiting for approval');
}

export function buildFriendlyToolActivityTitle(activity: WorkbenchToolActivity): string {
  const target = getPrimaryToolTarget(activity);
  const toolName = activity.toolName;

  if (activity.status === 'pending') {
    return `Queued ${friendlyToolName(toolName)}`;
  }
  if (activity.status === 'denied') {
    return `${friendlyToolName(toolName)} denied`;
  }
  if (activity.status === 'failed') {
    return activity.recoverable
      ? `Recovering from ${friendlyToolName(toolName)} error`
      : `${friendlyToolName(toolName)} failed`;
  }

  const active = activity.status === 'running';
  switch (toolName) {
    case 'LogScan':
      return formatLogScanActivityTitle(activity);
    case 'Read':
    case 'read_file_text':
      return active
        ? `Reading ${target ?? 'file'}`
        : `Read ${target ?? 'file'}`;
    case 'Grep':
      return active ? 'Searching uploaded logs' : 'Searched uploaded logs';
    case 'Glob':
      return active ? 'Finding matching files' : 'Matched files';
    case 'list_directory':
      return active
        ? `Listing ${target ?? 'folder'}`
        : `Listed ${target ?? 'folder'}`;
    case 'analyze_adf_logs':
    case 'analyze_access_logs':
    case 'read_logs':
    case 'triage_text_diagnostics':
      return active ? 'Running log analysis' : 'Analyzed logs';
    case 'analyze_har_file':
      return active ? 'Analyzing HAR capture' : 'Analyzed HAR capture';
    case 'correlate_har_with_logs':
      return active ? 'Correlating HAR and logs' : 'Correlated HAR and logs';
    case 'Agent':
      return active ? 'Running background investigation' : 'Finished background investigation';
    case 'TaskOutput':
      return active ? 'Collecting background findings' : 'Collected background findings';
    default:
      return active ? `Using ${friendlyToolName(toolName)}` : `Used ${friendlyToolName(toolName)}`;
  }
}

export function buildFriendlyToolActivityDetail(activity: WorkbenchToolActivity): string | undefined {
  const pattern = getStringInput(activity.input, ['pattern', 'query']);
  const glob = getStringInput(activity.input, ['glob', 'include']);
  const target = getPrimaryToolTarget(activity);

  if (activity.toolName === 'Grep') {
    if (pattern && glob) {
      return `${pattern} in ${glob}`;
    }
    return pattern ?? glob;
  }

  if (activity.toolName === 'Glob') {
    return pattern ?? target;
  }

  if (
    activity.toolName === 'LogScan' ||
    activity.toolName === 'analyze_adf_logs' ||
    activity.toolName === 'analyze_access_logs' ||
    activity.toolName === 'read_logs' ||
    activity.toolName === 'triage_text_diagnostics'
  ) {
    return target;
  }

  return undefined;
}

export function buildFriendlyToolGroupTitle(activities: WorkbenchToolActivity[]): string {
  const running = activities.filter((activity) => activity.status === 'running');
  if (running.length === 1) {
    return buildFriendlyToolActivityTitle(running[0]);
  }
  if (running.length > 1) {
    return `Inspecting evidence with ${running.length} tools`;
  }

  const pending = activities.filter((activity) => activity.status === 'pending');
  if (pending.length) {
    return `Queued ${pending.length} ${pluralize(pending.length, 'tool')}`;
  }

  if (activities.length === 1 && activities[0].toolName === 'LogScan') {
    return formatLogScanActivityTitle(activities[0]);
  }

  return `Ran ${activities.length} ${pluralize(activities.length, 'tool')}`;
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

function friendlyToolName(toolName: string): string {
  return toolName
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function getPrimaryToolTarget(activity: WorkbenchToolActivity): string | undefined {
  const rawTarget = getStringInput(activity.input, [
    'file_path',
    'path',
    'input_path',
    'log_folder',
    'folder',
    'directory'
  ]);
  if (!rawTarget) {
    return undefined;
  }
  return compactPath(rawTarget);
}

function getStringInput(input: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function compactPath(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  return parts.at(-1) ?? path;
}

function pluralize(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}
