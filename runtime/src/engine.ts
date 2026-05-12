import { randomUUID } from 'node:crypto';
import { existsSync, statSync, unlinkSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import { buildLeakedRuntimeSystemPrompt } from './leakedRuntimePrompt.js';
import { executeLocalTool } from './localToolExecutor.js';
import { COMMAND_CATALOG } from './commandCatalog.js';
import { BUILTIN_TOOL_CATALOG, mergeToolCatalog } from './toolCatalog.js';
import {
  deletePersistedSession,
  deletePersistedSessionUploads,
  listPersistedSessionSummaries,
  loadPersistedSession,
  savePersistedSession,
  type PersistedSessionRecord
} from './sessionPersistence.js';
import { discoverSkills } from './skills.js';
import type {
  EngineAttachment,
  EngineAgent,
  EngineAgentStatus,
  EngineAgentType,
  EngineApprovalResolution,
  EngineCommandInfo,
  EngineEvent,
  EngineHistorySummary,
  EngineIntegrationSnapshot,
  EngineMemoryEntry,
  EngineMessage,
  EngineModelMessage,
  EngineReportArtifact,
  EngineReportSuggestion,
  EngineSession,
  EngineSessionSnapshot,
  EngineSkippedToolRecord,
  EngineTask,
  EngineToolActivity,
  EngineToolSkipReasonCode,
  EngineToolDescriptor,
  EngineToolSource,
  EngineToolExecutionResult,
  EngineToolExecutor,
  EngineWorkspaceDiff,
  PendingApproval,
  WorkbenchEngine,
  EngineModelProvider
} from './types.js';

type PendingToolCall = {
  toolUseId: string;
  toolName: string;
  input: Record<string, unknown>;
  reasoning?: string;
};

type PreparedPendingToolCall = PendingToolCall & {
  validationError?: string;
};

type ToolExecutionOutcome = 'completed' | 'blocked' | 'recoverable_failed';
type MainToolQueueResult = 'completed' | 'paused' | 'blocked' | 'recoverable_failed';

type AgentState = EngineAgent & {
  modelHistory: EngineModelMessage[];
  currentAssistantDraft: string;
};

const MAX_RECOVERABLE_TOOL_FAILURES = 3;
const DEFAULT_BULK_READ_LIMIT = 200;
const AGENT_SETTLE_TIMEOUT_MS = 10 * 60 * 1000;
const AGENT_SETTLE_POLL_MS = 100;
const RECOVERABLE_TOOL_NAMES = new Set(['Grep', 'Glob', 'Read', 'WebFetch', 'WebSearch']);
const AGENT_TERMINAL_STATUSES = new Set<EngineAgentStatus>(['completed', 'failed', 'cancelled']);

type SessionState = {
  session: EngineSession;
  messages: EngineMessage[];
  modelHistory: EngineModelMessage[];
  pendingApprovals: PendingApproval[];
  pendingToolQueue: PendingToolCall[];
  changedFiles: string[];
  workspaceDiffs: EngineWorkspaceDiff[];
  eventHistory: EngineEvent[];
  listeners: Set<(event: EngineEvent) => void>;
  currentAssistantDraft: string;
  tasks: EngineTask[];
  memoryEntries: EngineMemoryEntry[];
  historySummaries: EngineHistorySummary[];
  agents: AgentState[];
  skippedTools: EngineSkippedToolRecord[];
  reportSuggestion: EngineReportSuggestion | null;
  toolActivity: EngineToolActivity[];
  attachments: EngineAttachment[];
  reportArtifacts: EngineReportArtifact[];
  branch: string | null;
};

function messageId(): string {
  return randomUUID();
}

function createMessage(
  role: EngineMessage['role'],
  content: string,
  kind: EngineMessage['kind'] = 'default'
): EngineMessage {
  return {
    id: messageId(),
    role,
    content,
    createdAt: new Date().toISOString(),
    kind
  };
}

function findToolDescriptor(
  toolCatalog: EngineToolDescriptor[],
  toolName: string
): EngineToolDescriptor | undefined {
  return toolCatalog.find((tool) => tool.name === toolName);
}

function isToolVisibleToModel(tool: EngineToolDescriptor): boolean {
  return tool.visibility !== 'hidden' && tool.visibility !== 'unsupported' && tool.enabled !== false;
}

function toPublicAgent(agent: AgentState): EngineAgent {
  return {
    id: agent.id,
    parentSessionId: agent.parentSessionId,
    parentToolUseId: agent.parentToolUseId,
    agentType: agent.agentType,
    status: agent.status,
    prompt: agent.prompt,
    messages: [...agent.messages],
    toolActivity: [...agent.toolActivity],
    resultSummary: agent.resultSummary,
    resultContent: agent.resultContent,
    error: agent.error,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
    completedAt: agent.completedAt
  };
}

function hydrateAgentState(agent: EngineAgent): AgentState {
  return {
    ...agent,
    messages: [...agent.messages],
    toolActivity: [...agent.toolActivity],
    modelHistory: [],
    currentAssistantDraft: ''
  };
}

function toPersistedRecord(state: SessionState) {
  return {
    session: state.session,
    messages: state.messages,
    modelHistory: state.modelHistory,
    pendingApprovals: state.pendingApprovals,
    changedFiles: state.changedFiles,
    workspaceDiffs: state.workspaceDiffs,
    eventHistory: state.eventHistory,
    currentAssistantDraft: state.currentAssistantDraft,
    tasks: state.tasks,
    memoryEntries: state.memoryEntries,
    historySummaries: state.historySummaries,
    agents: state.agents.map(toPublicAgent),
    skippedTools: state.skippedTools,
    reportSuggestion: state.reportSuggestion,
    toolActivity: state.toolActivity,
    attachments: state.attachments,
    reports: state.reportArtifacts,
    branch: state.branch
  };
}

function createSessionState(session: EngineSession): SessionState {
  return {
    session,
    messages: [],
    modelHistory: [],
    pendingApprovals: [],
    pendingToolQueue: [],
    changedFiles: [],
    workspaceDiffs: [],
    eventHistory: [],
    listeners: new Set(),
    currentAssistantDraft: '',
    tasks: [],
    memoryEntries: [],
    historySummaries: [],
    agents: [],
    skippedTools: [],
    reportSuggestion: null,
    toolActivity: [],
    attachments: [],
    reportArtifacts: [],
    branch: null
  };
}

function normalizeHistorySummary(summary: PersistedSessionRecord['historySummaries'][number]): EngineHistorySummary {
  const candidate = summary as EngineHistorySummary & {
    text?: string;
    title?: string;
    preview?: string;
    transcript?: unknown;
    openTasks?: unknown;
    rememberedNotes?: unknown;
    changedFiles?: unknown;
  };

  if (typeof candidate.title === 'string' && typeof candidate.preview === 'string') {
    return {
      id: candidate.id,
      title: candidate.title,
      preview: candidate.preview,
      transcript: Array.isArray(candidate.transcript) ? candidate.transcript : [],
      openTasks: Array.isArray(candidate.openTasks) ? candidate.openTasks : [],
      rememberedNotes: Array.isArray(candidate.rememberedNotes) ? candidate.rememberedNotes : [],
      changedFiles: Array.isArray(candidate.changedFiles) ? candidate.changedFiles : [],
      createdAt: candidate.createdAt,
      text: candidate.text
    };
  }

  const legacyText = typeof candidate.text === 'string' ? candidate.text : '';
  return {
    id: candidate.id,
    title: 'Session summary',
    preview: legacyText.slice(0, 220),
    transcript: legacyText ? legacyText.split('\n').filter(Boolean).slice(0, 8) : [],
    openTasks: [],
    rememberedNotes: [],
    changedFiles: [],
    createdAt: candidate.createdAt,
    text: legacyText
  };
}

function hydrateSessionState(record: PersistedSessionRecord): SessionState {
  return {
    session: record.session,
    messages: record.messages,
    modelHistory: record.modelHistory,
    pendingApprovals: record.pendingApprovals,
    pendingToolQueue: [],
    changedFiles: record.changedFiles,
    workspaceDiffs: record.workspaceDiffs,
    eventHistory: record.eventHistory,
    currentAssistantDraft: record.currentAssistantDraft,
    tasks: record.tasks,
    memoryEntries: record.memoryEntries,
    historySummaries: record.historySummaries.map(normalizeHistorySummary),
    agents: (record.agents ?? []).map(hydrateAgentState),
    skippedTools: record.skippedTools ?? [],
    reportSuggestion: record.reportSuggestion ?? null,
    toolActivity: record.toolActivity ?? [],
    attachments: record.attachments ?? [],
    reportArtifacts: record.reports ?? [],
    branch: record.branch,
    listeners: new Set()
  };
}

export function buildDefaultIntegrationSnapshot(
  cwd: string,
  toolCatalog: EngineToolDescriptor[]
): EngineIntegrationSnapshot {
  const jdMcpTools = toolCatalog.filter(
    (tool) => tool.source === 'jd-mcp' && tool.visibility !== 'hidden'
  );
  const enabledJdMcpTools = jdMcpTools.filter(isToolVisibleToModel);
  return {
    skills: discoverSkills(cwd),
    mcp: {
      available: false,
      servers: [],
      note: 'MCP bridge is not wired into the browser shell yet.'
    },
    lsp: {
      available: false,
      note: 'LSP-backed semantic assistance is not wired into the browser shell yet.'
    },
    jdMcp: {
      available: jdMcpTools.length > 0,
      connected: enabledJdMcpTools.length > 0,
      note: enabledJdMcpTools.length
        ? 'jd-mcp diagnostic tool definitions are loaded for this browser shell.'
        : jdMcpTools.length
          ? 'jd-mcp tools are recognized, but some prerequisites are still missing.'
        : 'jd-mcp is not configured for this browser shell.',
      tools: enabledJdMcpTools.map((tool) => tool.name),
      categories: [...new Set(jdMcpTools.map((tool) => tool.category).filter(Boolean))] as string[],
      toolDescriptors: [...jdMcpTools]
    }
  };
}

function applyWorkspaceDiff(
  state: SessionState,
  result: EngineToolExecutionResult
): EngineWorkspaceDiff[] {
  const before = typeof result.metadata?.before === 'string' ? result.metadata.before : null;
  const after = typeof result.metadata?.after === 'string' ? result.metadata.after : null;
  const path =
    typeof result.metadata?.display_path === 'string'
      ? result.metadata.display_path
      : typeof result.metadata?.file_path === 'string'
        ? result.metadata.file_path
        : result.changedFiles?.[0];

  if ((!before && before !== '') || (!after && after !== '')) {
    return state.workspaceDiffs;
  }

  if (!path) {
    return state.workspaceDiffs;
  }

  const nextDiff: EngineWorkspaceDiff = {
    path,
    before,
    after
  };

  state.workspaceDiffs = [
    ...state.workspaceDiffs.filter((item) => item.path !== path),
    nextDiff
  ];

  return state.workspaceDiffs;
}

function normalizeReportArtifacts(
  requestId: string,
  sessionId: string,
  toolName: string,
  source: EngineToolSource,
  artifacts: EngineReportArtifact[] | undefined
): EngineReportArtifact[] {
  if (!artifacts?.length) {
    return [];
  }

  return artifacts.map((artifact) => {
    const exists = existsSync(artifact.filePath);
    const size = artifact.size ?? (exists ? statSync(artifact.filePath).size : 0);

    return {
      ...artifact,
      requestId,
      sessionId,
      toolName,
      source,
      kind: 'html-report',
      fileName: artifact.fileName || basename(artifact.filePath),
      title: artifact.title || basename(artifact.filePath),
      createdAt: artifact.createdAt || new Date().toISOString(),
      size
    };
  });
}

function isWorkspaceOwnedPath(cwd: string, filePath: string): boolean {
  const workspaceRoot = resolve(cwd);
  const absolutePath = resolve(filePath);
  const relativePath = relative(workspaceRoot, absolutePath);
  return Boolean(relativePath) && !relativePath.startsWith('..') && !isAbsolute(relativePath);
}

function isSafeSessionId(sessionId: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(sessionId);
}

function deleteWorkspaceOwnedReportFiles(cwd: string, artifacts: EngineReportArtifact[]): void {
  const deleted = new Set<string>();
  for (const artifact of artifacts) {
    if (!isWorkspaceOwnedPath(cwd, artifact.filePath) || deleted.has(artifact.filePath)) {
      continue;
    }
    deleted.add(artifact.filePath);
    try {
      unlinkSync(artifact.filePath);
    } catch {
      // Ignore missing or already-removed report files during session cleanup.
    }
  }
}

function findAttachment(state: SessionState, attachmentId: string): EngineAttachment | undefined {
  return state.attachments.find((attachment) => attachment.id === attachmentId);
}

function resolveTurnAttachments(
  state: SessionState,
  attachmentIds: string[] | undefined
): EngineAttachment[] {
  if (!attachmentIds?.length) {
    return [];
  }

  const seen = new Set<string>();
  const active: EngineAttachment[] = [];
  for (const attachmentId of attachmentIds) {
    const attachment = findAttachment(state, attachmentId);
    if (!attachment || seen.has(attachment.id) || attachment.promptVisibility !== 'available') {
      continue;
    }
    if (!existsSync(attachment.localPath)) {
      continue;
    }

    seen.add(attachment.id);
    active.push(attachment);
  }

  return active;
}

function buildVisibleUserPrompt(prompt: string, attachments: EngineAttachment[]): string {
  return prompt;
}

function truncateSessionText(content: string, maxLength: number): string {
  const cleaned = content
    .replace(/\n\nAttachments:[\s\S]*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) {
    return '';
  }
  return cleaned.length <= maxLength ? cleaned : `${cleaned.slice(0, maxLength - 1).trimEnd()}...`;
}

function isDiagnosticLikeTextAttachment(attachment: EngineAttachment): boolean {
  if (attachment.kind !== 'text') {
    return false;
  }

  const normalizedName = attachment.originalName.toLowerCase();
  const extension = extname(normalizedName);
  return (
    extension === '.log' ||
    extension === '.out' ||
    extension === '.txt' ||
    normalizedName.includes('diagnostic') ||
    normalizedName.includes('server') ||
    normalizedName.includes('adf')
  );
}

function findSingleDiagnosticAttachment(attachments: EngineAttachment[]): EngineAttachment | null {
  const activeAttachments = attachments.filter(
    (attachment) => attachment.promptVisibility === 'available'
  );
  if (activeAttachments.length !== 1) {
    return null;
  }

  const [attachment] = activeAttachments;
  return attachment && isDiagnosticLikeTextAttachment(attachment) ? attachment : null;
}

function isMissingPathValue(value: unknown): boolean {
  if (typeof value !== 'string') {
    return true;
  }

  const normalized = value.trim().toLowerCase();
  return !normalized || normalized === 'undefined' || normalized === 'null';
}

function isAbstractAttachmentPathValue(value: string): boolean {
  const normalized = value.trim().toLowerCase().replace(/[\s_-]+/g, ' ');
  return [
    'all',
    'all files',
    'all attached files',
    'all attachments',
    'attached files',
    'attachments',
    'uploaded files',
    'all uploaded files'
  ].includes(normalized);
}

function firstUsablePathValue(inputValue: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = inputValue[key];
    if (!isMissingPathValue(value)) {
      return (value as string).trim();
    }
  }

  return null;
}

function firstUsableReadPathValue(inputValue: Record<string, unknown>): string | null {
  const value = firstUsablePathValue(inputValue, ['file_path', 'path', 'input_path', 'input']);
  if (!value || isAbstractAttachmentPathValue(value)) {
    return null;
  }

  return value;
}

function firstUsableReadPathArray(inputValue: Record<string, unknown>): string[] {
  for (const key of ['file_paths', 'paths']) {
    const value = inputValue[key];
    if (!Array.isArray(value)) {
      continue;
    }

    const paths = value
      .filter((item): item is string => !isMissingPathValue(item))
      .map((item) => item.trim())
      .filter((item) => !isAbstractAttachmentPathValue(item));
    if (paths.length) {
      return paths;
    }
  }

  return [];
}

function normalizeReadInput(
  inputValue: Record<string, unknown>,
  filePath: string,
  options: { boundedDefaultLimit?: boolean } = {}
): Record<string, unknown> {
  const next: Record<string, unknown> = {
    ...inputValue,
    file_path: filePath
  };
  delete next.path;
  delete next.input_path;
  delete next.input;
  delete next.file_paths;
  delete next.paths;

  if (options.boundedDefaultLimit && typeof next.limit === 'undefined') {
    next.limit = DEFAULT_BULK_READ_LIMIT;
  }

  return next;
}

function buildReadPathValidationError(
  inputValue: Record<string, unknown>,
  turnAttachments: EngineAttachment[]
): string {
  return [
    'Read cannot run against multiple attachments without one concrete file_path.',
    `Failed input: ${JSON.stringify(inputValue)}.`,
    'Available attachment paths:',
    ...turnAttachments.map((attachment) => `- ${attachment.originalName}: ${attachment.localPath}`),
    'Retry with one concrete file_path per Read call, or use Grep with a targeted glob when a bounded search is better.'
  ].join('\n');
}

function prepareReadToolCall(
  call: PendingToolCall,
  turnAttachments: EngineAttachment[]
): PreparedPendingToolCall[] {
  if (call.toolName !== 'Read') {
    return [call];
  }

  const filePaths = firstUsableReadPathArray(call.input);
  if (filePaths.length) {
    return filePaths.map((filePath, index) => ({
      ...call,
      toolUseId: `${call.toolUseId}-${index + 1}`,
      input: normalizeReadInput(call.input, filePath, { boundedDefaultLimit: true })
    }));
  }

  const filePath = firstUsableReadPathValue(call.input);
  if (filePath) {
    return [
      {
        ...call,
        input: normalizeReadInput(call.input, filePath)
      }
    ];
  }

  if (turnAttachments.length === 1) {
    return [
      {
        ...call,
        input: normalizeReadInput(call.input, turnAttachments[0]!.localPath)
      }
    ];
  }

  if (turnAttachments.length > 1) {
    return [
      {
        ...call,
        validationError: buildReadPathValidationError(call.input, turnAttachments)
      }
    ];
  }

  return [call];
}

function prepareMainToolCalls(
  queuedCalls: PendingToolCall[],
  turnAttachments: EngineAttachment[]
): PreparedPendingToolCall[] {
  return queuedCalls.flatMap((call) => prepareReadToolCall(call, turnAttachments));
}

function folderForAttachment(attachment: EngineAttachment): string {
  return existsSync(attachment.localPath) && !statSync(attachment.localPath).isDirectory()
    ? dirname(attachment.localPath)
    : attachment.localPath;
}

function repairJdMcpInputFromAttachments(
  toolName: string,
  inputValue: Record<string, unknown>,
  turnAttachments: EngineAttachment[] = []
): Record<string, unknown> {
  const attachment = findSingleDiagnosticAttachment(turnAttachments);
  if (!attachment) {
    return inputValue;
  }

  if (toolName === 'triage_text_diagnostics') {
    const inputPath = firstUsablePathValue(inputValue, ['input_path', 'path', 'input']);
    return {
      ...inputValue,
      input_path: inputPath ?? attachment.localPath
    };
  }

  if (toolName === 'read_file_text') {
    const filePath = firstUsablePathValue(inputValue, ['path', 'input_path', 'input']);
    return {
      ...inputValue,
      path: filePath ?? attachment.localPath
    };
  }

  if (toolName === 'analyze_adf_logs' || toolName === 'read_logs') {
    const logFolder = firstUsablePathValue(inputValue, ['log_folder', 'path', 'input_path', 'input']);
    return {
      ...inputValue,
      log_folder: logFolder ? folderForAttachment({ ...attachment, localPath: logFolder }) : folderForAttachment(attachment)
    };
  }

  if (toolName === 'list_directory') {
    const path = firstUsablePathValue(inputValue, ['path', 'input_path', 'input']);
    return {
      ...inputValue,
      path: path ?? folderForAttachment(attachment)
    };
  }

  return inputValue;
}

function isExplicitAnalyzeLogToolRequest(prompt: string): boolean {
  const normalized = prompt.toLowerCase().replace(/[_-]+/g, ' ');
  return [
    /\b(use|using|run|invoke|call)\b.*\b(analy[sz]e\s+logs?\s+tool|analy[sz]e\s+adf\s+logs?|adf\s+analy[sz]er|jd\s*mcp)\b/,
    /\b(analy[sz]e|analyse)\b.*\busing\b.*\b(tool|jd\s*mcp|adf\s+analy[sz]er)\b/,
    /\b(generate|create|run)\b.*\b(report|jd\s*mcp\s+report)\b/,
    /\badf\s+analy[sz]er\b/,
    /\bjd\s*mcp\b/
  ].some((pattern) => pattern.test(normalized));
}

function upsertSkippedTool(
  state: SessionState,
  nextRecord: EngineSkippedToolRecord
): void {
  state.skippedTools = [
    nextRecord,
    ...state.skippedTools.filter((record) => record.toolName !== nextRecord.toolName)
  ].slice(0, 10);
}

function buildDefaultReportSuggestion(
  attachments: EngineAttachment[],
  toolCatalog: EngineToolDescriptor[]
): {
  skippedTool: EngineSkippedToolRecord | null;
  reportSuggestion: EngineReportSuggestion | null;
} {
  const attachment = findSingleDiagnosticAttachment(attachments);
  if (!attachment) {
    return {
      skippedTool: null,
      reportSuggestion: null
    };
  }

  const tool = findToolDescriptor(toolCatalog, 'analyze_adf_logs');
  const folderInput = {
    log_folder: dirname(attachment.localPath)
  };

  if (!tool || !isToolVisibleToModel(tool)) {
    const explanation = tool?.reason
      ? `No jd-mcp report was generated because analyze_adf_logs is unavailable here: ${tool.reason}`
      : 'No jd-mcp report was generated because analyze_adf_logs is not available in this session.';
    return {
      skippedTool: {
        toolName: 'analyze_adf_logs',
        source: 'jd-mcp',
        reasonCode: 'tool_unavailable_or_unsupported',
        explanation,
        canOverride: false,
        createdAt: new Date().toISOString()
      },
      reportSuggestion: {
        available: false,
        canRun: false,
        suggestedToolName: 'analyze_adf_logs',
        source: 'jd-mcp',
        explanation,
        attachmentIds: [attachment.id],
        input: folderInput,
        reasonCode: 'tool_unavailable_or_unsupported'
      }
    };
  }

  const explanation =
    'This turn used direct file analysis because it gives a better answer for a single attached log. analyze_adf_logs expects a folder and can still be run if you want an HTML report.';
  return {
    skippedTool: {
      toolName: 'analyze_adf_logs',
      source: 'jd-mcp',
      reasonCode: 'builtin_better_for_single_file',
      explanation,
      canOverride: true,
      createdAt: new Date().toISOString()
    },
    reportSuggestion: {
      available: true,
      canRun: true,
      suggestedToolName: 'analyze_adf_logs',
      source: 'jd-mcp',
      explanation,
      attachmentIds: [attachment.id],
      input: folderInput,
      reasonCode: 'builtin_better_for_single_file'
    }
  };
}

function buildExplicitReportSuggestion(
  prompt: string,
  attachments: EngineAttachment[],
  toolCatalog: EngineToolDescriptor[]
): {
  skippedTool: EngineSkippedToolRecord | null;
  reportSuggestion: EngineReportSuggestion | null;
} {
  if (!isExplicitAnalyzeLogToolRequest(prompt)) {
    return {
      skippedTool: null,
      reportSuggestion: null
    };
  }

  const attachment = findSingleDiagnosticAttachment(attachments);
  if (!attachment) {
    return {
      skippedTool: null,
      reportSuggestion: null
    };
  }

  const tool = findToolDescriptor(toolCatalog, 'analyze_adf_logs');
  const folderInput = {
    log_folder: dirname(attachment.localPath)
  };
  const unavailableReason = tool?.reason ?? 'analyze_adf_logs is not available in this session.';

  if (!tool || !isToolVisibleToModel(tool)) {
    const explanation = `analyze_adf_logs unavailable: ${unavailableReason} Direct analysis was used instead; no jd-mcp HTML report was generated.`;
    return {
      skippedTool: {
        toolName: 'analyze_adf_logs',
        source: 'jd-mcp',
        reasonCode: 'analyzer_unavailable_direct_analysis_used',
        explanation,
        canOverride: false,
        createdAt: new Date().toISOString()
      },
      reportSuggestion: {
        available: false,
        canRun: false,
        suggestedToolName: 'analyze_adf_logs',
        source: 'jd-mcp',
        explanation,
        attachmentIds: [attachment.id],
        input: folderInput,
        reasonCode: 'analyzer_unavailable_direct_analysis_used'
      }
    };
  }

  const explanation =
    'analyze_adf_logs was requested but no jd-mcp HTML report was generated. Direct analysis was used as a fallback.';
  return {
    skippedTool: {
      toolName: 'analyze_adf_logs',
      source: 'jd-mcp',
      reasonCode: 'explicit_tool_request_not_honored',
      explanation,
      canOverride: true,
      createdAt: new Date().toISOString()
    },
    reportSuggestion: {
      available: true,
      canRun: true,
      suggestedToolName: 'analyze_adf_logs',
      source: 'jd-mcp',
      explanation,
      attachmentIds: [attachment.id],
      input: folderInput,
      reasonCode: 'explicit_tool_request_not_honored'
    }
  };
}

function buildModelUserPrompt(
  prompt: string,
  attachments: EngineAttachment[],
  explicitReportSuggestion?: EngineReportSuggestion | null
): string {
  if (!attachments.length) {
    return prompt;
  }

  const pathRefs = attachments.map((attachment) => `@"${attachment.localPath}"`).join(' ');
  const lines = [
    pathRefs,
    '',
    'Local attachments for this turn:',
    ...attachments.map((attachment) => {
      if (attachment.kind === 'text') {
        return `- Text attachment ${attachment.originalName}: @"${attachment.localPath}"`;
      }

      const ocrLine = attachment.extractedText
        ? `  OCR extracted text (may be incomplete): ${attachment.extractedText}`
        : `  OCR extracted text unavailable. The image is local at @"${attachment.localPath}".`;
      return `- Image attachment ${attachment.originalName}: @"${attachment.localPath}"\n${ocrLine}`;
    }),
    '',
    'User prompt:',
    prompt
  ];

  if (attachments.length > 1) {
    lines.push(
      '',
      'Runtime instruction:',
      'Multiple attachments are selected. Use the exact local paths listed above. Do not call Read with "undefined", "all files", "attachments", or any abstract bulk target. For file inspection, call one bounded Read per concrete file_path or use Grep with a targeted glob. Group findings by file type or purpose, wait for tool results, then produce one final answer.'
    );
  }

  if (explicitReportSuggestion?.canRun) {
    lines.push(
      '',
      'Runtime instruction:',
      `The user explicitly requested jd-mcp log analysis. Prefer calling ${explicitReportSuggestion.suggestedToolName} with exactly this input: ${JSON.stringify(explicitReportSuggestion.input)}. Do not claim a jd-mcp report exists unless the tool result provides report artifacts.`
    );
  } else if (explicitReportSuggestion && !explicitReportSuggestion.canRun) {
    lines.push(
      '',
      'Runtime instruction:',
      `${explicitReportSuggestion.suggestedToolName} cannot run in this environment. Analyze the attached diagnostic log directly: use Read first to inspect the file, then use simple Grep searches for focused follow-up if needed. If a search fails, simplify the pattern or continue with Read. Clearly state that no jd-mcp HTML report was generated.`
    );
  }

  return lines.join('\n');
}

function resolveReportOverrideTarget(
  state: SessionState,
  turnAttachments: EngineAttachment[],
  toolCatalog: EngineToolDescriptor[]
): EngineReportSuggestion | null {
  const attachmentBased = buildDefaultReportSuggestion(turnAttachments, toolCatalog).reportSuggestion;
  if (attachmentBased?.canRun) {
    return attachmentBased;
  }

  if (state.reportSuggestion?.canRun) {
    return state.reportSuggestion;
  }

  return attachmentBased ?? state.reportSuggestion;
}

function buildSessionReport(state: SessionState, stableStatus: EngineSession['status']): string {
  return [
    `status=${stableStatus}`,
    `messages=${state.messages.length}`,
    `tasks=${state.tasks.length}`,
    `memory=${state.memoryEntries.length}`,
    `history_summaries=${state.historySummaries.length}`,
    `attachments=${state.attachments.filter((attachment) => attachment.promptVisibility === 'available').length}`,
    `reports=${state.reportArtifacts.length}`,
    `changed_files=${state.changedFiles.length}`,
    `pending_approvals=${state.pendingApprovals.length}`
  ].join(', ');
}

function buildDiffReport(state: SessionState): string {
  if (!state.workspaceDiffs.length) {
    return 'No tracked workspace diffs yet.';
  }

  return `Tracked diffs:\n${state.workspaceDiffs.map((diff) => `- ${diff.path}`).join('\n')}`;
}

function buildConfigReport(
  state: SessionState,
  integrations: EngineIntegrationSnapshot
): string {
  return [
    `branch=${state.branch ?? 'detached'}`,
    `skills=${integrations.skills.length}`,
    `mcp=${integrations.mcp.available ? 'available' : 'unavailable'}`,
    `lsp=${integrations.lsp.available ? 'available' : 'unavailable'}`,
    `jd_mcp=${integrations.jdMcp.connected ? 'connected' : integrations.jdMcp.available ? 'available' : 'unavailable'}`,
    `jd_mcp_tools=${integrations.jdMcp.tools.length}`
  ].join(', ');
}

function finalizeLocalCommandStatus(
  state: SessionState,
  previousStatus: EngineSession['status']
): EngineSession['status'] {
  if (state.pendingApprovals.length) {
    return 'awaiting_approval';
  }
  if (previousStatus === 'blocked') {
    return 'blocked';
  }
  return 'completed';
}

function buildRuntimeCapabilityContext(
  state: SessionState,
  toolCatalog: EngineToolDescriptor[],
  integrations: EngineIntegrationSnapshot
): string {
  const availableCommands = COMMAND_CATALOG.map((entry) => entry.name).join(', ');
  const builtinTools = toolCatalog
    .filter((tool) => tool.source === 'builtin' && isToolVisibleToModel(tool))
    .map((tool) => tool.name)
    .join(', ');
  const externalTools = toolCatalog
    .filter((tool) => tool.source !== 'builtin' && isToolVisibleToModel(tool))
    .map((tool) => tool.name)
    .join(', ');
  const unavailableExternalTools = toolCatalog
    .filter(
      (tool) =>
        tool.source !== 'builtin' &&
        tool.visibility !== 'hidden' &&
        !isToolVisibleToModel(tool)
    )
    .map((tool) => `${tool.name}${tool.reason ? ` (${tool.reason})` : ''}`)
    .join(', ');
  const approvalTools = toolCatalog
    .filter((tool) => tool.requiresApproval && isToolVisibleToModel(tool))
    .map((tool) => tool.name)
    .join(', ');
  const taskSummary = state.tasks.length
    ? state.tasks.map((task) => `${task.status}:${task.content}`).join(' | ')
    : 'none';
  const memorySummary = state.memoryEntries.length
    ? state.memoryEntries.map((entry) => entry.content).join(' | ')
    : 'none';
  const attachmentSummary = state.attachments.filter(
    (attachment) => attachment.promptVisibility === 'available'
  ).length
    ? state.attachments
        .filter((attachment) => attachment.promptVisibility === 'available')
        .map((attachment) => `${attachment.originalName} (${attachment.kind})`)
        .join(' | ')
    : 'none';
  const latestSkippedTool = state.skippedTools[0];
  const reportRoutingNote = state.reportSuggestion
    ? `${state.reportSuggestion.suggestedToolName}: ${state.reportSuggestion.explanation}${
        state.reportSuggestion.canRun ? ' Use /report to force report mode.' : ''
      }`
    : 'none';

  return [
    '# Runtime capability context',
    `- Available slash commands: ${availableCommands}`,
    `- Available built-in tools: ${builtinTools || 'none'}`,
    `- Available external tools: ${externalTools || 'none'}`,
    `- Unavailable external tools: ${unavailableExternalTools || 'none'}`,
    `- Mutating tools require explicit approval: ${approvalTools || 'none'}`,
    `- Current workspace: cwd=${state.session.cwd}, changed_files=${state.changedFiles.length}, pending_approvals=${state.pendingApprovals.length}`,
    `- Current session: status=${state.session.status}, branch=${state.branch ?? 'not tracked'}, history_summaries=${state.historySummaries.length}`,
    `- Session attachments available locally: ${attachmentSummary}`,
    `- Generated report artifacts in this session: ${state.reportArtifacts.length}`,
    `- Latest skipped external tool: ${latestSkippedTool ? `${latestSkippedTool.toolName} (${latestSkippedTool.reasonCode})` : 'none'}`,
    `- Latest report routing note: ${reportRoutingNote}`,
    `- Current tasks: ${taskSummary}`,
    `- Current remembered notes: ${memorySummary}`,
    `- Integrations: skills=${integrations.skills.length}, mcp=${integrations.mcp.available ? 'available' : 'unavailable'}, lsp=${integrations.lsp.available ? 'available' : 'unavailable'}, jd-mcp=${integrations.jdMcp.connected ? 'connected' : integrations.jdMcp.available ? 'available' : 'unavailable'}`,
    '- If the user asks what you can do or how autonomous you are, answer specifically from this context and mention limitations plainly.'
  ].join('\n');
}

function upsertToolActivity(
  state: SessionState,
  nextActivity: EngineToolActivity
): void {
  state.toolActivity = [
    nextActivity,
    ...state.toolActivity.filter((activity) => activity.requestId !== nextActivity.requestId)
  ];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function spawnedAgentIdsForToolUse(state: SessionState, toolUseId: string): string[] {
  return state.agents
    .filter((agent) => agent.parentToolUseId === toolUseId)
    .map((agent) => agent.id);
}

function uniqueAgentIds(agentIds: string[]): string[] {
  return [...new Set(agentIds.filter(Boolean))];
}

function requireAgentState(state: SessionState, agentId: string): AgentState {
  const agent = state.agents.find((candidate) => candidate.id === agentId);
  if (!agent) {
    throw new Error(`Unknown background agent: ${agentId}`);
  }
  return agent;
}

function areAgentsSettled(state: SessionState, agentIds: string[]): boolean {
  return agentIds.every((agentId) => AGENT_TERMINAL_STATUSES.has(requireAgentState(state, agentId).status));
}

async function waitForAgentsToSettle(state: SessionState, agentIds: string[]): Promise<void> {
  const uniqueIds = uniqueAgentIds(agentIds);
  if (!uniqueIds.length) {
    return;
  }

  const deadline = Date.now() + AGENT_SETTLE_TIMEOUT_MS;
  while (!areAgentsSettled(state, uniqueIds) && Date.now() < deadline) {
    await sleep(AGENT_SETTLE_POLL_MS);
  }
}

function appendAgentContinuationPrompt(state: SessionState, agentIds: string[]): void {
  const agents = uniqueAgentIds(agentIds).map((agentId) => requireAgentState(state, agentId));
  if (!agents.length) {
    return;
  }

  const statusLines = agents.map((agent) => {
    const summary = agent.resultSummary ?? agent.error ?? 'No summary available yet.';
    return `- ${agent.id} (${agent.agentType}, ${agent.status}): ${summary}`;
  });

  state.modelHistory.push({
    role: 'user',
    content: [
      'The background agents spawned for this turn have now settled.',
      'Use TaskOutput for each completed agent_id to read the full result, then merge the findings into one final answer for the user.',
      'If an agent failed or was cancelled, mention that briefly and continue with the successful agent outputs.',
      '',
      'Agent statuses:',
      ...statusLines
    ].join('\n')
  });
}

async function prepareAgentContinuation(state: SessionState, agentIds: string[]): Promise<void> {
  const uniqueIds = uniqueAgentIds(agentIds);
  if (!uniqueIds.length) {
    return;
  }

  await waitForAgentsToSettle(state, uniqueIds);
  appendAgentContinuationPrompt(state, uniqueIds);
}

function isRecoverableToolFailure(
  toolName: string,
  source: EngineToolSource,
  message: string,
  options: { agentId?: string }
): boolean {
  if (options.agentId || source !== 'builtin' || !RECOVERABLE_TOOL_NAMES.has(toolName)) {
    return false;
  }

  return !/\b(permission|approval|denied|unauthori[sz]ed|forbidden)\b/i.test(message);
}

function buildRecoveryInstruction(
  toolName: string,
  inputValue: Record<string, unknown>,
  errorMessage: string,
  recoveryAttempt: number
): string {
  const remaining = Math.max(0, MAX_RECOVERABLE_TOOL_FAILURES - recoveryAttempt);
  const prefix = `${toolName} failed with a recoverable error. Attempt ${recoveryAttempt}/${MAX_RECOVERABLE_TOOL_FAILURES}.`;
  const suffix = remaining
    ? `Repair the input or switch to another read/search tool. Remaining recovery attempts: ${remaining}.`
    : 'Recovery budget exhausted.';

  if (toolName === 'Grep') {
    return [
      prefix,
      `Failed input: ${JSON.stringify(inputValue)}.`,
      `Error: ${errorMessage}.`,
      'Use a simpler JavaScript-compatible regex, set ignore_case true for case-insensitive search, or switch to Read and inspect the file directly.',
      suffix
    ].join(' ');
  }

  if (toolName === 'Read') {
    return [
      prefix,
      `Failed input: ${JSON.stringify(inputValue)}.`,
      `Error: ${errorMessage}.`,
      'Check the attachment path from the user message, use Glob if needed, then retry Read with a valid path.',
      suffix
    ].join(' ');
  }

  return [
    prefix,
    `Failed input: ${JSON.stringify(inputValue)}.`,
    `Error: ${errorMessage}.`,
    suffix
  ].join(' ');
}

function levenshteinDistance(left: string, right: string): number {
  const rows = left.length + 1;
  const cols = right.length + 1;
  const matrix = Array.from({ length: rows }, (_, rowIndex) =>
    Array.from({ length: cols }, (_, colIndex) =>
      rowIndex === 0 ? colIndex : colIndex === 0 ? rowIndex : 0
    )
  );

  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const cost = left[row - 1] === right[col - 1] ? 0 : 1;
      matrix[row]![col] = Math.min(
        matrix[row - 1]![col]! + 1,
        matrix[row]![col - 1]! + 1,
        matrix[row - 1]![col - 1]! + cost
      );
    }
  }

  return matrix[rows - 1]![cols - 1]!;
}

function suggestCommands(commandName: string): string[] {
  const normalized = commandName.startsWith('/') ? commandName : `/${commandName}`;
  return [...COMMAND_CATALOG]
    .sort(
      (left, right) =>
        levenshteinDistance(normalized, left.name) - levenshteinDistance(normalized, right.name)
    )
    .slice(0, 1)
    .map((entry) => entry.name)
    .filter((name, index, all) => all.indexOf(name) === index);
}

function createCommandSummary(commandName: string, detail: string): string {
  return `${commandName}: ${detail}`;
}

function applyTodoWrite(state: SessionState, input: Record<string, unknown>): EngineToolExecutionResult {
  const todosInput = Array.isArray(input.todos)
    ? input.todos
    : Array.isArray(input.tasks)
      ? input.tasks
      : null;
  const contentInput = typeof input.content === 'string' ? input.content.trim() : '';

  if (todosInput) {
    state.tasks = todosInput
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null;
        }

        const content =
          typeof (item as Record<string, unknown>).content === 'string'
            ? String((item as Record<string, unknown>).content).trim()
            : '';
        if (!content) {
          return null;
        }

        const status =
          (item as Record<string, unknown>).status === 'completed' ? 'completed' : 'pending';

        return {
          id:
            typeof (item as Record<string, unknown>).id === 'string'
              ? String((item as Record<string, unknown>).id)
              : randomUUID(),
          content,
          status
        } satisfies EngineTask;
      })
      .filter((task): task is EngineTask => task !== null);
  } else if (contentInput) {
    state.tasks = [
      ...state.tasks,
      {
        id: randomUUID(),
        content: contentInput,
        status: 'pending'
      }
    ];
  }

  return {
    summary: `TodoWrite updated ${state.tasks.length} task(s)`,
    metadata: {
      tasks: state.tasks
    }
  };
}

function createStructuredHistorySummary(state: SessionState): EngineHistorySummary {
  const transcript = state.messages
    .slice(-12)
    .map((message) => `${message.role}: ${message.content}`);
  const openTasks = state.tasks
    .filter((task) => task.status === 'pending')
    .map((task) => task.content);
  const rememberedNotes = state.memoryEntries.slice(-5).map((entry) => entry.content);
  const changedFiles = [...state.changedFiles];
  const preview = transcript.length ? transcript.slice(0, 3).join(' ') : 'No transcript captured yet.';
  const text = [
    `Session summary for ${state.session.id}`,
    transcript.length ? `Recent transcript:\n${transcript.join('\n')}` : 'Recent transcript: none',
    openTasks.length ? `Open tasks:\n${openTasks.map((task) => `- ${task}`).join('\n')}` : 'Open tasks: none',
    rememberedNotes.length
      ? `Remembered notes:\n${rememberedNotes.map((note) => `- ${note}`).join('\n')}`
      : 'Remembered notes: none',
    `Changed files: ${changedFiles.length ? changedFiles.join(', ') : '0'}`
  ].join('\n\n');

  return {
    id: randomUUID(),
    title: 'Session summary',
    preview,
    transcript,
    openTasks,
    rememberedNotes,
    changedFiles,
    createdAt: new Date().toISOString(),
    text
  };
}

export function createEngine(input: {
  provider: EngineModelProvider;
  executeTool?: EngineToolExecutor;
  toolCatalog?: EngineToolDescriptor[];
  getIntegrationSnapshot?: (cwd: string, toolCatalog: EngineToolDescriptor[]) => EngineIntegrationSnapshot;
}): WorkbenchEngine {
  const executeTool = input.executeTool ?? executeLocalTool;
  const toolCatalog = mergeToolCatalog(input.toolCatalog);
  const modelToolCatalog = toolCatalog.filter(isToolVisibleToModel);
  const getIntegrationSnapshot =
    input.getIntegrationSnapshot ??
    ((cwd: string, catalog: EngineToolDescriptor[]) => buildDefaultIntegrationSnapshot(cwd, catalog));
  const sessions = new Map<string, SessionState>();
  const systemPrompt = buildLeakedRuntimeSystemPrompt(modelToolCatalog);

  function getSessionState(sessionId: string): SessionState {
    const state = sessions.get(sessionId);
    if (!state) {
      throw new Error(`Unknown session: ${sessionId}`);
    }
    return state;
  }

  function persistState(state: SessionState): void {
    savePersistedSession(state.session.cwd, toPersistedRecord(state));
  }

  function emit(state: SessionState, event: EngineEvent): void {
    state.eventHistory.push(event);
    for (const listener of state.listeners) {
      listener(event);
    }
  }

  function pushSystemMessage(
    state: SessionState,
    content: string,
    kind: EngineMessage['kind'] = 'default'
  ): EngineMessage {
    const systemMessage = createMessage('system', content, kind);
    state.messages.push(systemMessage);
    return systemMessage;
  }

  function buildSnapshot(state: SessionState): EngineSessionSnapshot {
    const integrations = getIntegrationSnapshot(state.session.cwd, toolCatalog);
    return {
      sessionId: state.session.id,
      status: state.session.status,
      messages: [...state.messages],
      tasks: [...state.tasks],
      memory: {
        entries: [...state.memoryEntries]
      },
      history: {
        summaries: [...state.historySummaries]
      },
      agents: state.agents.map(toPublicAgent),
      skippedTools: [...state.skippedTools],
      reportSuggestion: state.reportSuggestion ? { ...state.reportSuggestion } : null,
      pendingApprovals: [...state.pendingApprovals],
      toolActivity: [...state.toolActivity],
      attachments: [...state.attachments],
      reports: {
        artifacts: [...state.reportArtifacts]
      },
      workspace: {
        cwd: state.session.cwd,
        changedFiles: [...state.changedFiles],
        diffs: [...state.workspaceDiffs]
      },
      commands: [...COMMAND_CATALOG],
      session: {
        branch: state.branch
      },
      integrations
    };
  }

  function findAgentState(state: SessionState, agentId: string): AgentState {
    const agent = state.agents.find((candidate) => candidate.id === agentId);
    if (!agent) {
      throw new Error(`Unknown background agent: ${agentId}`);
    }
    return agent;
  }

  function updateAgentState(
    state: SessionState,
    agentId: string,
    recipe: (agent: AgentState) => void,
    eventType: 'agent.updated' | 'agent.completed' | 'agent.failed' | 'agent.cancelled' = 'agent.updated'
  ): AgentState {
    const agent = findAgentState(state, agentId);
    recipe(agent);
    agent.updatedAt = new Date().toISOString();
    const publicAgent = toPublicAgent(agent);
    emit(state, {
      type: eventType,
      sessionId: state.session.id,
      agent: publicAgent
    });
    persistState(state);
    return agent;
  }

  function createAgentState(
    state: SessionState,
    input: {
      parentToolUseId: string;
      agentType: EngineAgentType;
      prompt: string;
    }
  ): AgentState {
    const now = new Date().toISOString();
    const agent: AgentState = {
      id: randomUUID(),
      parentSessionId: state.session.id,
      parentToolUseId: input.parentToolUseId,
      agentType: input.agentType,
      status: 'pending',
      prompt: input.prompt,
      messages: [
        createMessage('user', input.prompt)
      ],
      toolActivity: [],
      createdAt: now,
      updatedAt: now,
      modelHistory: [
        {
          role: 'user',
          content: input.prompt
        }
      ],
      currentAssistantDraft: ''
    };

    state.agents = [agent, ...state.agents];
    emit(state, {
      type: 'agent.spawned',
      sessionId: state.session.id,
      agent: toPublicAgent(agent)
    });
    persistState(state);
    return agent;
  }

  function buildAgentSystemPrompt(
    agentType: EngineAgentType,
    agentToolCatalog: EngineToolDescriptor[]
  ): string {
    const addendum = [
      '# Background agent mode',
      `You are running as a ${agentType} background agent.`,
      '- Investigate autonomously using the tools you were given.',
      '- You are read-only in this mode. Do not try to edit files or run shell commands.',
      '- Use multiple relevant tools when needed before returning your findings.',
      '- Do not stop after saying what you will inspect. First use tools to inspect, read, or search the actual inputs.',
      '- Your final result must include concrete findings from tool evidence, not an intent, plan, or status update.',
      '- End with a concise, high-signal result for the main agent.'
    ].join('\n');

    return `${buildLeakedRuntimeSystemPrompt(agentToolCatalog)}\n\n${addendum}`;
  }

  function finalizeAssistantDraft(state: SessionState): void {
    const content = state.currentAssistantDraft.trim();
    if (!content) {
      state.currentAssistantDraft = '';
      return;
    }

    const assistantMessage = createMessage('assistant', content);
    state.messages.push(assistantMessage);
    state.modelHistory.push({
      role: 'assistant',
      content
    });
    emit(state, {
      type: 'message.assistant.done',
      sessionId: state.session.id,
      message: assistantMessage
    });
    state.currentAssistantDraft = '';
  }

  function emitAssistantDraftDelta(state: SessionState): void {
    const content = state.currentAssistantDraft.trim();
    if (!content) {
      return;
    }

    emit(state, {
      type: 'message.assistant.delta',
      sessionId: state.session.id,
      text: content
    });
  }

  function finalizeAgentAssistantDraft(state: SessionState, agentId: string): void {
    const agent = findAgentState(state, agentId);
    const content = agent.currentAssistantDraft.trim();
    if (!content) {
      agent.currentAssistantDraft = '';
      return;
    }

    const assistantMessage = createMessage('assistant', content);
    agent.messages = [...agent.messages, assistantMessage];
    agent.modelHistory = [
      ...agent.modelHistory,
      {
        role: 'assistant',
        content
      }
    ];
    agent.currentAssistantDraft = '';
    agent.resultContent = content;
    agent.resultSummary = content.slice(0, 240);
    updateAgentState(state, agentId, () => {});
  }

  function agentHasUsedInspectionTools(agent: AgentState): boolean {
    return agent.toolActivity.some((activity) =>
      ['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Skill', 'TaskOutput'].includes(activity.toolName)
    );
  }

  function agentResultLooksLikeIntentOnly(content: string | undefined): boolean {
    const normalized = (content ?? '').trim().toLowerCase();
    if (!normalized) {
      return true;
    }

    return [
      /\bi(?:'ll| will| am going to)\b.*\b(inspect|read|check|scan|look|review|summari[sz]e)\b/,
      /\blet me\b.*\b(inspect|read|check|scan|look|review)\b/,
      /\bi(?:'m| am) going to\b/,
      /\bi(?:'ll| will) (now )?(fetch|gather|summari[sz]e|look)/,
      /\bthen i(?:'ll| will)\b.*\bsummari[sz]e\b/
    ].some((pattern) => pattern.test(normalized));
  }

  function shouldContinueAgentForEvidence(agent: AgentState): boolean {
    return !agentHasUsedInspectionTools(agent) || agentResultLooksLikeIntentOnly(agent.resultContent);
  }

  function appendAgentEvidenceRetryPrompt(agent: AgentState): void {
    agent.resultContent = undefined;
    agent.resultSummary = undefined;
    agent.modelHistory = [
      ...agent.modelHistory,
      {
        role: 'user',
        content: [
          'Your previous response was not enough to complete this background task.',
          'Do not describe what you plan to do. Use the available read/search tools now, inspect the actual repository or files, then return concrete findings.',
          'A valid final result must cite what you inspected and summarize real findings for the main agent.'
        ].join('\n')
      }
    ];
  }

  function recordToolResult(
    state: SessionState,
    toolUseId: string,
    toolName: string,
    result: EngineToolExecutionResult
  ): void {
    state.modelHistory.push({
      role: 'tool',
      toolName,
      toolUseId,
      content: JSON.stringify(
        {
          summary: result.summary,
          source: result.source ?? 'builtin',
          metadata: result.metadata ?? null,
          changedFiles: result.changedFiles ?? [],
          artifacts: result.artifacts ?? []
        },
        null,
        2
      )
    });
  }

  function recordAgentToolResult(
    agent: AgentState,
    toolUseId: string,
    toolName: string,
    result: EngineToolExecutionResult
  ): void {
    agent.modelHistory = [
      ...agent.modelHistory,
      {
        role: 'tool',
        toolName,
        toolUseId,
        content: JSON.stringify(
          {
            summary: result.summary,
            source: result.source ?? 'builtin',
            metadata: result.metadata ?? null,
            changedFiles: result.changedFiles ?? [],
            artifacts: result.artifacts ?? []
          },
          null,
          2
        )
      }
    ];
  }

  function normalizeAgentType(inputValue: unknown): EngineAgentType {
    const candidate = typeof inputValue === 'string' ? inputValue.trim().toLowerCase() : '';
    if (
      candidate === 'general' ||
      candidate === 'research' ||
      candidate === 'review' ||
      candidate === 'diagnostics'
    ) {
      return candidate;
    }
    return 'general';
  }

  function buildAgentToolCatalog(): EngineToolDescriptor[] {
    const allowed = new Set(['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Skill', 'TodoWrite', 'TaskOutput']);
    return toolCatalog
      .filter((tool) => tool.source === 'builtin' && allowed.has(tool.name))
      .map((tool) =>
        tool.name === 'Skill'
          ? {
              ...tool,
              requiresApproval: false
            }
          : tool
      );
  }

  function buildTaskOutputResult(state: SessionState, inputValue: Record<string, unknown>): EngineToolExecutionResult {
    const agentId = String(inputValue.agent_id ?? inputValue.task_id ?? '').trim();
    if (!agentId) {
      throw new Error('TaskOutput requires input.agent_id');
    }

    const agent = findAgentState(state, agentId);
    return {
      summary: `TaskOutput retrieved output for ${agent.id}`,
      metadata: {
        agent_id: agent.id,
        agent_type: agent.agentType,
        status: agent.status,
        result_summary: agent.resultSummary ?? null,
        result_content: agent.resultContent ?? null,
        transcript: agent.messages.map((message) => ({
          role: message.role,
          content: message.content,
          kind: message.kind
        }))
      }
    };
  }

  function createAgentToolActivity(
    inputValue: {
      requestId: string;
      toolUseId: string;
      toolName: string;
      source: EngineToolSource;
      agentId: string;
      agentType: EngineAgentType;
      category?: string;
      producesReports?: boolean;
      status: EngineToolActivity['status'];
      input: Record<string, unknown>;
      reasoning?: string;
      summary?: string;
      metadata?: Record<string, unknown>;
      error?: string;
      recoverable?: boolean;
      recoveryAttempt?: number;
      recoveryInstruction?: string;
      startedAt?: string;
      completedAt?: string;
    }
  ): EngineToolActivity {
    return {
      requestId: inputValue.requestId,
      toolUseId: inputValue.toolUseId,
      toolName: inputValue.toolName,
      source: inputValue.source,
      agentId: inputValue.agentId,
      agentType: inputValue.agentType,
      category: inputValue.category,
      producesReports: inputValue.producesReports,
      status: inputValue.status,
      input: inputValue.input,
      reasoning: inputValue.reasoning,
      summary: inputValue.summary,
      metadata: inputValue.metadata,
      error: inputValue.error,
      recoverable: inputValue.recoverable,
      recoveryAttempt: inputValue.recoveryAttempt,
      recoveryInstruction: inputValue.recoveryInstruction,
      startedAt: inputValue.startedAt,
      completedAt: inputValue.completedAt
    };
  }

  function upsertAgentToolActivity(
    state: SessionState,
    agentId: string,
    nextActivity: EngineToolActivity
  ): void {
    const agent = findAgentState(state, agentId);
    agent.toolActivity = [
      nextActivity,
      ...agent.toolActivity.filter((activity) => activity.requestId !== nextActivity.requestId)
    ];
  }

  async function spawnBackgroundAgent(
    state: SessionState,
    toolUseId: string,
    inputValue: Record<string, unknown>
  ): Promise<EngineToolExecutionResult> {
    const task = typeof inputValue.task === 'string' ? inputValue.task.trim() : '';
    if (!task) {
      throw new Error('Agent requires input.task');
    }

    const agentType = normalizeAgentType(inputValue.subagent_type);
    const agent = createAgentState(state, {
      parentToolUseId: toolUseId,
      agentType,
      prompt: task
    });

    void runBackgroundAgent(state, agent.id);

    return {
      summary: `Spawned ${agentType} background agent ${agent.id}`,
      metadata: {
        agent_id: agent.id,
        agent_type: agent.agentType,
        status: agent.status,
        prompt: task
      }
    };
  }

  async function completeToolExecution(
    state: SessionState,
    requestId: string,
    toolUseId: string,
    toolName: string,
    inputValue: Record<string, unknown>,
    options: {
      agentId?: string;
      agentType?: EngineAgentType;
      reasoning?: string;
      recoveryAttempt?: number;
      toolCatalogOverride?: EngineToolDescriptor[];
      validationError?: string;
    } = {}
  ): Promise<ToolExecutionOutcome> {
    const toolCatalogForExecution = options.toolCatalogOverride ?? toolCatalog;
    const toolDescriptor = findToolDescriptor(toolCatalogForExecution, toolName);
    const source = toolDescriptor?.source ?? 'builtin';
    const startedAt = new Date().toISOString();
    state.pendingApprovals = state.pendingApprovals.filter(
      (approval) => approval.requestId !== requestId
    );
    if (!options.agentId) {
      state.session.status = 'running';
    }

    const startedActivity = options.agentId
      ? createAgentToolActivity({
          requestId,
          toolUseId,
          toolName,
          source,
          agentId: options.agentId,
          agentType: options.agentType ?? 'general',
          category: toolDescriptor?.category,
          producesReports: toolDescriptor?.producesReports ?? false,
          status: 'running',
          input: inputValue,
          reasoning: options.reasoning,
          startedAt
        })
      : {
          requestId,
          toolUseId,
          toolName,
          source,
          category: toolDescriptor?.category,
          producesReports: toolDescriptor?.producesReports ?? false,
          status: 'running',
          input: inputValue,
          reasoning: options.reasoning,
          startedAt
        } satisfies EngineToolActivity;

    upsertToolActivity(state, startedActivity);
    if (options.agentId) {
      upsertAgentToolActivity(state, options.agentId, startedActivity);
    }
    emit(state, {
      type: 'tool.execution.started',
      sessionId: state.session.id,
      requestId,
      toolUseId,
      toolName,
      source,
      agentId: options.agentId,
      agentType: options.agentType,
      category: toolDescriptor?.category,
      input: inputValue,
      reasoning: options.reasoning,
      producesReports: toolDescriptor?.producesReports ?? false
    });
    persistState(state);

    let result: EngineToolExecutionResult;
    try {
      if (options.validationError) {
        throw new Error(options.validationError);
      }

      result =
        toolName === 'TodoWrite'
          ? applyTodoWrite(state, inputValue)
          : toolName === 'TaskOutput'
            ? buildTaskOutputResult(state, inputValue)
            : toolName === 'Agent'
              ? await spawnBackgroundAgent(state, toolUseId, inputValue)
          : await executeTool({
              toolName,
              input: inputValue,
              cwd: state.session.cwd,
              sessionId: state.session.id
            });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const completedAt = new Date().toISOString();
      const recoveryAttempt = options.recoveryAttempt ?? 1;
      const recoverable = isRecoverableToolFailure(toolName, source, message, options);
      const recoveryInstruction = recoverable
        ? buildRecoveryInstruction(toolName, inputValue, message, recoveryAttempt)
        : undefined;
      const recoveryMetadata = recoverable
        ? {
            recoverable,
            recoveryAttempt,
            recoveryInstruction
          }
        : {
            recoverable: false
          };
      if (toolDescriptor?.producesReports) {
        state.reportSuggestion = null;
      }
      const failedActivity = options.agentId
        ? createAgentToolActivity({
            requestId,
            toolUseId,
            toolName,
            source,
            agentId: options.agentId,
            agentType: options.agentType ?? 'general',
            category: toolDescriptor?.category,
            producesReports: toolDescriptor?.producesReports ?? false,
            status: 'failed',
            input: inputValue,
            reasoning: options.reasoning,
            error: message,
            metadata: recoveryMetadata,
            recoverable,
            recoveryAttempt: recoverable ? recoveryAttempt : undefined,
            recoveryInstruction,
            startedAt,
            completedAt
          })
        : {
            requestId,
            toolUseId,
            toolName,
            source,
            category: toolDescriptor?.category,
            producesReports: toolDescriptor?.producesReports ?? false,
            status: 'failed',
            input: inputValue,
            reasoning: options.reasoning,
            error: message,
            metadata: recoveryMetadata,
            recoverable,
            recoveryAttempt: recoverable ? recoveryAttempt : undefined,
            recoveryInstruction,
            startedAt,
            completedAt
          } satisfies EngineToolActivity;

      upsertToolActivity(state, failedActivity);
      if (options.agentId) {
        upsertAgentToolActivity(state, options.agentId, failedActivity);
      } else {
        pushSystemMessage(
          state,
          recoverable
            ? `${toolName} failed (recoverable attempt ${recoveryAttempt}/${MAX_RECOVERABLE_TOOL_FAILURES}): ${message}`
            : `${toolName} failed: ${message}`,
          'command-error'
        );
      }
      emit(state, {
        type: 'tool.execution.failed',
        sessionId: state.session.id,
        requestId,
        toolUseId,
        toolName,
        source,
        agentId: options.agentId,
        agentType: options.agentType,
        category: toolDescriptor?.category,
        producesReports: toolDescriptor?.producesReports ?? false,
        error: message,
        metadata: recoveryMetadata,
        recoverable,
        recoveryAttempt: recoverable ? recoveryAttempt : undefined,
        recoveryInstruction
      });

      if (recoverable && recoveryAttempt < MAX_RECOVERABLE_TOOL_FAILURES) {
        state.modelHistory.push({
          role: 'tool',
          toolName,
          toolUseId,
          content: JSON.stringify({
            error: message,
            failedInput: inputValue,
            recoverable: true,
            recoveryAttempt,
            recoveryInstruction
          })
        });
        persistState(state);
        return 'recoverable_failed';
      }

      if (recoverable) {
        const exhaustedMessage = `Recovery budget exhausted after ${MAX_RECOVERABLE_TOOL_FAILURES} recoverable tool failures. Last ${toolName} error: ${message}`;
        pushSystemMessage(state, exhaustedMessage, 'command-error');
      }

      if (!options.agentId) {
        state.session.status = 'blocked';
      }
      persistState(state);
      return 'blocked';
    }

    const normalizedSource = result.source ?? source;
    const reportArtifacts = normalizeReportArtifacts(
      requestId,
      state.session.id,
      toolName,
      normalizedSource,
      result.artifacts
    );

    if (result.changedFiles?.length) {
      state.changedFiles = [...new Set([...state.changedFiles, ...result.changedFiles])];
      applyWorkspaceDiff(state, result);
    }

    if (reportArtifacts.length) {
      state.reportArtifacts = [
        ...state.reportArtifacts.filter(
          (existing) => !reportArtifacts.some((artifact) => artifact.id === existing.id)
        ),
        ...reportArtifacts
      ];
      state.reportSuggestion = null;
    }

    if (options.agentId) {
      const agent = findAgentState(state, options.agentId);
      recordAgentToolResult(agent, toolUseId, toolName, result);
    } else {
      recordToolResult(state, toolUseId, toolName, result);
      pushSystemMessage(state, `${toolName}: ${result.summary}`, 'tool');
    }

    const completedAt = new Date().toISOString();
    const completedActivity = options.agentId
      ? createAgentToolActivity({
          requestId,
          toolUseId,
          toolName,
          source: normalizedSource,
          agentId: options.agentId,
          agentType: options.agentType ?? 'general',
          category: toolDescriptor?.category,
          producesReports: toolDescriptor?.producesReports ?? false,
          status: 'completed',
          input: inputValue,
          reasoning: options.reasoning,
          summary: result.summary,
          metadata: result.metadata,
          startedAt,
          completedAt
        })
      : {
          requestId,
          toolUseId,
          toolName,
          source: normalizedSource,
          category: toolDescriptor?.category,
          producesReports: toolDescriptor?.producesReports ?? false,
          status: 'completed',
          input: inputValue,
          reasoning: options.reasoning,
          summary: result.summary,
          metadata: result.metadata,
          artifacts: reportArtifacts,
          startedAt,
          completedAt
        } satisfies EngineToolActivity;

    upsertToolActivity(state, completedActivity);
    if (options.agentId) {
      upsertAgentToolActivity(state, options.agentId, completedActivity);
    }

    emit(state, {
      type: 'tool.execution.completed',
      sessionId: state.session.id,
      requestId,
      toolUseId,
      toolName,
      source: normalizedSource,
      agentId: options.agentId,
      agentType: options.agentType,
      category: toolDescriptor?.category,
      producesReports: toolDescriptor?.producesReports ?? false,
      summary: result.summary,
      metadata: result.metadata,
      artifacts: reportArtifacts
    });

    if (toolName === 'TodoWrite') {
      emit(state, {
        type: 'task.updated',
        sessionId: state.session.id,
        tasks: [...state.tasks]
      });
    }

    if (result.changedFiles?.length) {
      emit(state, {
        type: 'workspace.changed',
        sessionId: state.session.id,
        changedFiles: result.changedFiles
      });
    }

    if (reportArtifacts.length) {
      emit(state, {
        type: 'report.generated',
        sessionId: state.session.id,
        artifacts: reportArtifacts
      });
    }

    persistState(state);
    return 'completed';
  }

  async function processMainToolQueue(
    state: SessionState,
    queuedCalls: PendingToolCall[],
    recoveryAttempt: number,
    turnAttachments: EngineAttachment[] = []
  ): Promise<MainToolQueueResult> {
    state.pendingToolQueue = [];
    const spawnedAgentIds: string[] = [];
    const preparedCalls = prepareMainToolCalls(queuedCalls, turnAttachments);

    for (let index = 0; index < preparedCalls.length; index += 1) {
      const call = preparedCalls[index]!;
      const requestId = randomUUID();
      const toolDescriptor = findToolDescriptor(toolCatalog, call.toolName);
      const source = toolDescriptor?.source ?? 'builtin';
      const inputValue =
        source === 'jd-mcp'
          ? repairJdMcpInputFromAttachments(call.toolName, call.input, turnAttachments)
          : call.input;
      const requiresApproval =
        toolDescriptor?.requiresApproval ??
        BUILTIN_TOOL_CATALOG.some((tool) => tool.name === call.toolName && tool.requiresApproval);

      if (requiresApproval) {
        state.pendingToolQueue = preparedCalls.slice(index + 1);
        const pendingApproval: PendingApproval = {
          requestId,
          toolUseId: call.toolUseId,
          toolName: call.toolName,
          source,
          category: toolDescriptor?.category,
          input: inputValue,
          reasoning: call.reasoning,
          producesReports: toolDescriptor?.producesReports ?? false,
          requestedAt: new Date().toISOString(),
          resumeAfterApproval: true
        };

        state.session.status = 'awaiting_approval';
        state.pendingApprovals.push(pendingApproval);
        upsertToolActivity(state, {
          requestId,
          toolUseId: call.toolUseId,
          toolName: call.toolName,
          source,
          category: toolDescriptor?.category,
          producesReports: toolDescriptor?.producesReports ?? false,
          status: 'pending',
          input: inputValue,
          reasoning: call.reasoning
        });
        emit(state, {
          type: 'permission.requested',
          sessionId: state.session.id,
          requestId,
          toolUseId: call.toolUseId,
          toolName: call.toolName,
          source,
          category: toolDescriptor?.category,
          input: inputValue,
          reasoning: call.reasoning,
          producesReports: toolDescriptor?.producesReports ?? false
        });
        persistState(state);
        return 'paused';
      }

      const executionOutcome = await completeToolExecution(
        state,
        requestId,
        call.toolUseId,
        call.toolName,
        inputValue,
        {
          reasoning: call.reasoning,
          recoveryAttempt,
          validationError: call.validationError
        }
      );
      if (executionOutcome === 'recoverable_failed') {
        return 'recoverable_failed';
      }
      if (executionOutcome === 'blocked') {
        return 'blocked';
      }
      if (call.toolName === 'Agent') {
        spawnedAgentIds.push(...spawnedAgentIdsForToolUse(state, call.toolUseId));
      }
    }

    if (spawnedAgentIds.length) {
      await prepareAgentContinuation(state, spawnedAgentIds);
      persistState(state);
    }

    return 'completed';
  }

  async function processAgentToolQueue(
    state: SessionState,
    agentId: string,
    agentType: EngineAgentType,
    agentToolCatalog: EngineToolDescriptor[],
    queuedCalls: PendingToolCall[]
  ): Promise<void> {
    for (const call of queuedCalls) {
      const toolDescriptor = findToolDescriptor(agentToolCatalog, call.toolName);
      if (!toolDescriptor) {
        throw new Error(`Background agents cannot use ${call.toolName}`);
      }
      if (toolDescriptor.requiresApproval) {
        throw new Error(`Background agent ${agentId} reached approval-gated tool ${call.toolName}`);
      }

      const requestId = randomUUID();
      const completed = await completeToolExecution(
        state,
        requestId,
        call.toolUseId,
        call.toolName,
        call.input,
        {
          agentId,
          agentType,
          reasoning: call.reasoning,
          toolCatalogOverride: agentToolCatalog
        }
      );

      if (completed !== 'completed') {
        throw new Error(`Background agent ${agentId} failed while running ${call.toolName}`);
      }
    }
  }

  async function runBackgroundAgent(state: SessionState, agentId: string): Promise<void> {
    const agent = findAgentState(state, agentId);
    const agentToolCatalog = buildAgentToolCatalog();
    const agentSystemPrompt = buildAgentSystemPrompt(agent.agentType, agentToolCatalog);

    updateAgentState(state, agentId, (draft) => {
      draft.status = 'running';
    });

    const maxIterations = 8;
    try {
      for (let iteration = 0; iteration < maxIterations; iteration += 1) {
        const activeAgent = findAgentState(state, agentId);
        activeAgent.currentAssistantDraft = '';
        const queuedCalls: PendingToolCall[] = [];

        for await (const event of input.provider.sendTurn(activeAgent.modelHistory, {
          sessionId: activeAgent.id,
          cwd: state.session.cwd,
          systemPrompt: agentSystemPrompt,
          tools: agentToolCatalog
        })) {
          if (event.type === 'assistant_delta') {
            activeAgent.currentAssistantDraft += event.text;
            continue;
          }

          if (event.type === 'tool_call') {
            queuedCalls.push({
              toolUseId: event.toolUseId ?? randomUUID(),
              toolName: event.toolName,
              input: event.input,
              reasoning: event.reasoning
            });
          }
        }

        finalizeAgentAssistantDraft(state, agentId);

        if (!queuedCalls.length) {
          const agentAfterDraft = findAgentState(state, agentId);
          if (shouldContinueAgentForEvidence(agentAfterDraft)) {
            updateAgentState(state, agentId, appendAgentEvidenceRetryPrompt);
            continue;
          }

          updateAgentState(
            state,
            agentId,
            (draft) => {
              draft.status = 'completed';
              draft.completedAt = new Date().toISOString();
              if (!draft.resultSummary && draft.resultContent) {
                draft.resultSummary = draft.resultContent.slice(0, 240);
              }
              if (!draft.resultSummary) {
                draft.resultSummary = `Background agent ${draft.id} completed`;
              }
            },
            'agent.completed'
          );
          return;
        }

        await processAgentToolQueue(
          state,
          agentId,
          activeAgent.agentType,
          agentToolCatalog,
          queuedCalls
        );

        const settledAgent = findAgentState(state, agentId);
        if (settledAgent.resultContent) {
          updateAgentState(
            state,
            agentId,
            (draft) => {
              draft.status = 'completed';
              draft.completedAt = new Date().toISOString();
              draft.resultSummary = draft.resultSummary ?? draft.resultContent?.slice(0, 240);
            },
            'agent.completed'
          );
          return;
        }
      }

      throw new Error('Background agent exceeded the maximum number of tool iterations');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      updateAgentState(
        state,
        agentId,
        (draft) => {
          draft.status = 'failed';
          draft.error = message;
          draft.completedAt = new Date().toISOString();
        },
        'agent.failed'
      );
    }
  }

  function recordExplicitReportFallback(
    state: SessionState,
    routing: {
      skippedTool: EngineSkippedToolRecord | null;
      reportSuggestion: EngineReportSuggestion;
    }
  ): void {
    if (routing.skippedTool) {
      upsertSkippedTool(state, routing.skippedTool);
    }
    state.reportSuggestion = routing.reportSuggestion;
    state.currentAssistantDraft = '';
    pushSystemMessage(state, routing.reportSuggestion.explanation, 'command-error');
    persistState(state);
  }

  async function runTurnLoop(
    state: SessionState,
    options: {
      turnAttachments?: EngineAttachment[];
      explicitReportRouting?: {
        skippedTool: EngineSkippedToolRecord | null;
        reportSuggestion: EngineReportSuggestion;
      } | null;
    } = {}
  ): Promise<void> {
    const maxIterations = 8;
    let recoverableFailureCount = 0;

    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      state.currentAssistantDraft = '';
      const queuedCalls: PendingToolCall[] = [];
      const shouldBufferAssistantForReport =
        iteration === 0 && Boolean(options.explicitReportRouting?.reportSuggestion.canRun);

      const integrations = getIntegrationSnapshot(state.session.cwd, toolCatalog);
      const turnSystemPrompt = `${systemPrompt}\n\n${buildRuntimeCapabilityContext(
        state,
        toolCatalog,
        integrations
      )}`;

      for await (const event of input.provider.sendTurn(state.modelHistory, {
        sessionId: state.session.id,
        cwd: state.session.cwd,
        systemPrompt: turnSystemPrompt,
        tools: modelToolCatalog
      })) {
        if (event.type === 'assistant_delta') {
          state.currentAssistantDraft += event.text;
          continue;
        }

        if (event.type === 'assistant_done') {
          continue;
        }

        if (event.type === 'tool_call') {
          queuedCalls.push({
            toolUseId: event.toolUseId ?? randomUUID(),
            toolName: event.toolName,
            input: event.input,
            reasoning: event.reasoning
          });
        }
      }

      if (shouldBufferAssistantForReport) {
        const reportCallIndex = queuedCalls.findIndex(
          (call) => call.toolName === options.explicitReportRouting?.reportSuggestion.suggestedToolName
        );
        if (reportCallIndex === -1) {
          recordExplicitReportFallback(state, options.explicitReportRouting!);
          state.modelHistory.push({
            role: 'user',
            content: [
              'The preferred jd-mcp analyzer was not called.',
              'Continue now with direct diagnostic log analysis using built-in tools such as Read and Grep.',
              'Be explicit that no jd-mcp HTML report was generated, then provide the best available findings from the attached log.'
            ].join('\n')
          });
          continue;
        }

        queuedCalls[reportCallIndex] = {
          ...queuedCalls[reportCallIndex]!,
          input: options.explicitReportRouting!.reportSuggestion.input,
          reasoning:
            queuedCalls[reportCallIndex]!.reasoning ??
            'The user explicitly requested jd-mcp log analysis for the attached diagnostic file.'
        };
        state.currentAssistantDraft = '';
      } else if (!queuedCalls.length) {
        emitAssistantDraftDelta(state);
        finalizeAssistantDraft(state);
      } else {
        state.currentAssistantDraft = '';
      }

      if (!queuedCalls.length) {
        state.session.status = 'completed';
        emit(state, {
          type: 'turn.completed',
          sessionId: state.session.id,
          status: 'completed'
        });
        persistState(state);
        return;
      }

      const toolQueueResult = await processMainToolQueue(
        state,
        queuedCalls,
        recoverableFailureCount + 1,
        options.turnAttachments ?? []
      );
      if (toolQueueResult === 'paused') {
        return;
      }
      if (toolQueueResult === 'recoverable_failed') {
        recoverableFailureCount += 1;
        continue;
      }
      if (toolQueueResult === 'blocked') {
        emit(state, {
          type: 'turn.completed',
          sessionId: state.session.id,
          status: 'blocked'
        });
        persistState(state);
        return;
      }
    }

    throw new Error('Turn loop exceeded the maximum number of tool iterations');
  }

  async function handleLocalCommand(
    state: SessionState,
    prompt: string,
    stableStatus: EngineSession['status'],
    turnAttachments: EngineAttachment[]
  ): Promise<boolean> {
    const trimmed = prompt.trim();
    if (!trimmed.startsWith('/')) {
      return false;
    }

    const commandLine = trimmed.slice(1).trim();
    const [command = '', ...restParts] = commandLine.split(/\s+/);
    const rest = restParts.join(' ').trim();
    const commandName = `/${command}`;
    let summary = '';

    const knownCommand = COMMAND_CATALOG.find((entry) => entry.name === commandName);
    if (!knownCommand) {
      const suggestions = suggestCommands(commandName);
      const message = suggestions.length
        ? `Unknown slash command ${commandName}. Did you mean ${suggestions.join(', ')}?`
        : `Unknown slash command ${commandName}. Use /commands to see the available command list.`;

      pushSystemMessage(state, message, 'command-error');
      emit(state, {
        type: 'command.error',
        sessionId: state.session.id,
        commandName,
        message,
        suggestions
      });
      state.session.status = finalizeLocalCommandStatus(state, stableStatus);
      emit(state, {
        type: 'turn.completed',
        sessionId: state.session.id,
        status: 'completed'
      });
      persistState(state);
      return true;
    }

    switch (command) {
      case 'tasks': {
        if (rest.startsWith('add ')) {
          const content = rest.slice(4).trim();
          if (!content) {
            throw new Error('/tasks add requires task content');
          }
          state.tasks = [
            ...state.tasks,
            {
              id: randomUUID(),
              content,
              status: 'pending'
            }
          ];
          summary = `Added task "${content}"`;
        } else if (rest.startsWith('done ') || rest.startsWith('complete ')) {
          const target = rest.replace(/^(done|complete)\s+/, '').trim();
          state.tasks = state.tasks.map((task) =>
            task.id === target || task.content === target ? { ...task, status: 'completed' } : task
          );
          summary = `Marked task "${target}" complete`;
        } else if (rest === 'clear') {
          state.tasks = [];
          summary = 'Cleared all tasks';
        } else {
          summary = state.tasks.length
            ? `Tasks:\n${state.tasks
                .map((task) => `- [${task.status === 'completed' ? 'x' : ' '}] ${task.content}`)
                .join('\n')}`
            : 'No tasks recorded for this session.';
        }

        pushSystemMessage(state, createCommandSummary('/tasks', summary), 'command');
        emit(state, {
          type: 'command.executed',
          sessionId: state.session.id,
          commandName: '/tasks',
          summary
        });
        emit(state, {
          type: 'task.updated',
          sessionId: state.session.id,
          tasks: [...state.tasks]
        });
        break;
      }
      case 'memory': {
        if (rest.startsWith('remember ')) {
          const content = rest.slice('remember '.length).trim();
          if (!content) {
            throw new Error('/memory remember requires note content');
          }
          state.memoryEntries = [
            ...state.memoryEntries,
            {
              id: randomUUID(),
              content,
              createdAt: new Date().toISOString()
            }
          ];
          summary = `Remembered "${content}"`;
        } else {
          summary = state.memoryEntries.length
            ? `Memory entries:\n${state.memoryEntries.map((entry) => `- ${entry.content}`).join('\n')}`
            : 'No memory entries recorded for this session.';
        }

        pushSystemMessage(state, createCommandSummary('/memory', summary), 'command');
        emit(state, {
          type: 'command.executed',
          sessionId: state.session.id,
          commandName: '/memory',
          summary
        });
        emit(state, {
          type: 'memory.updated',
          sessionId: state.session.id,
          entries: [...state.memoryEntries]
        });
        break;
      }
      case 'compact': {
        const summaryRecord = createStructuredHistorySummary(state);
        state.historySummaries = [...state.historySummaries, summaryRecord];
        summary = `Saved compact summary ${summaryRecord.id}`;
        pushSystemMessage(state, createCommandSummary('/compact', summary), 'command');
        emit(state, {
          type: 'command.executed',
          sessionId: state.session.id,
          commandName: '/compact',
          summary
        });
        emit(state, {
          type: 'history.compacted',
          sessionId: state.session.id,
          summary: summaryRecord
        });
        break;
      }
      case 'session': {
        summary = buildSessionReport(state, stableStatus);
        pushSystemMessage(state, createCommandSummary('/session', summary), 'command');
        emit(state, {
          type: 'command.executed',
          sessionId: state.session.id,
          commandName: '/session',
          summary
        });
        break;
      }
      case 'diff': {
        summary = buildDiffReport(state);
        pushSystemMessage(state, createCommandSummary('/diff', summary), 'command');
        emit(state, {
          type: 'command.executed',
          sessionId: state.session.id,
          commandName: '/diff',
          summary
        });
        break;
      }
      case 'skills': {
        const skills = discoverSkills(state.session.cwd);
        summary = skills.length
          ? `Available skills:\n${skills.map((skill) => `- ${skill.name}`).join('\n')}`
          : 'No local skills discovered.';
        pushSystemMessage(state, createCommandSummary('/skills', summary), 'command');
        emit(state, {
          type: 'command.executed',
          sessionId: state.session.id,
          commandName: '/skills',
          summary
        });
        break;
      }
      case 'config': {
        summary = buildConfigReport(state, getIntegrationSnapshot(state.session.cwd, toolCatalog));
        pushSystemMessage(state, createCommandSummary('/config', summary), 'command');
        emit(state, {
          type: 'command.executed',
          sessionId: state.session.id,
          commandName: '/config',
          summary
        });
        break;
      }
      case 'commands': {
        const commands = COMMAND_CATALOG.map((entry: EngineCommandInfo) => entry.name).join(', ');
        summary = `Available commands: ${commands}`;
        pushSystemMessage(state, createCommandSummary('/commands', summary), 'command');
        emit(state, {
          type: 'command.executed',
          sessionId: state.session.id,
          commandName: '/commands',
          summary
        });
        break;
      }
      case 'report': {
        const suggestion = resolveReportOverrideTarget(state, turnAttachments, toolCatalog);
        if (!suggestion) {
          summary =
            'No eligible jd-mcp report path is available for the current turn. Attach a supported diagnostic file first.';
          pushSystemMessage(state, createCommandSummary('/report', summary), 'command-error');
          emit(state, {
            type: 'command.error',
            sessionId: state.session.id,
            commandName: '/report',
            message: summary,
            suggestions: []
          });
          state.session.status = finalizeLocalCommandStatus(state, stableStatus);
          emit(state, {
            type: 'turn.completed',
            sessionId: state.session.id,
            status: 'completed'
          });
          persistState(state);
          return true;
        }

        if (!suggestion.canRun) {
          pushSystemMessage(state, createCommandSummary('/report', suggestion.explanation), 'command-error');
          emit(state, {
            type: 'command.error',
            sessionId: state.session.id,
            commandName: '/report',
            message: suggestion.explanation,
            suggestions: []
          });
          state.session.status = finalizeLocalCommandStatus(state, stableStatus);
          emit(state, {
            type: 'turn.completed',
            sessionId: state.session.id,
            status: 'completed'
          });
          persistState(state);
          return true;
        }

        const requestId = randomUUID();
        const toolUseId = randomUUID();
        const toolDescriptor = findToolDescriptor(toolCatalog, suggestion.suggestedToolName);
        const reasoning = `Report override requested locally for ${suggestion.suggestedToolName}.`;
        const pendingApproval: PendingApproval = {
          requestId,
          toolUseId,
          toolName: suggestion.suggestedToolName,
          source: suggestion.source,
          category: toolDescriptor?.category,
          input: suggestion.input,
          reasoning,
          producesReports: toolDescriptor?.producesReports ?? true,
          requestedAt: new Date().toISOString(),
          resumeAfterApproval: false
        };

        state.pendingApprovals.push(pendingApproval);
        state.session.status = 'awaiting_approval';
        summary = `Prepared ${suggestion.suggestedToolName} for approval.`;
        pushSystemMessage(state, createCommandSummary('/report', summary), 'command');
        upsertToolActivity(state, {
          requestId,
          toolUseId,
          toolName: suggestion.suggestedToolName,
          source: suggestion.source,
          category: toolDescriptor?.category,
          producesReports: toolDescriptor?.producesReports ?? true,
          status: 'pending',
          input: suggestion.input,
          reasoning
        });
        emit(state, {
          type: 'command.executed',
          sessionId: state.session.id,
          commandName: '/report',
          summary
        });
        emit(state, {
          type: 'permission.requested',
          sessionId: state.session.id,
          requestId,
          toolUseId,
          toolName: suggestion.suggestedToolName,
          source: suggestion.source,
          category: toolDescriptor?.category,
          input: suggestion.input,
          reasoning,
          producesReports: toolDescriptor?.producesReports ?? true
        });
        persistState(state);
        return true;
      }
      default:
        return false;
    }

    state.session.status = finalizeLocalCommandStatus(state, stableStatus);
    emit(state, {
      type: 'turn.completed',
      sessionId: state.session.id,
      status: 'completed'
    });
    persistState(state);
    return true;
  }

  return {
    createSession({ cwd, sessionId }) {
      if (sessionId) {
        const existing = sessions.get(sessionId);
        if (existing) {
          return existing.session;
        }

        const persisted = loadPersistedSession(cwd, sessionId);
        if (persisted) {
          const restored = hydrateSessionState(persisted);
          sessions.set(sessionId, restored);
          return restored.session;
        }
      }

      const session: EngineSession = {
        id: sessionId ?? randomUUID(),
        cwd,
        status: 'idle'
      };
      const state = createSessionState(session);
      sessions.set(session.id, state);
      emit(state, {
        type: 'session.created',
        sessionId: session.id,
        cwd
      });
      persistState(state);
      return session;
    },

    listSessions(cwd) {
      const persisted = listPersistedSessionSummaries(cwd);
      const inMemory = Array.from(sessions.values())
        .filter((state) => state.session.cwd === cwd)
        .map((state) => {
          const messages = state.messages;
          const createdAt = messages[0]?.createdAt ?? new Date().toISOString();
          const updatedAt = messages.at(-1)?.createdAt ?? createdAt;
          const firstUserMessage = messages.find((message) => message.role === 'user');
          const firstAssistantMessage = messages.find((message) => message.role === 'assistant');
          const title = firstUserMessage ? truncateSessionText(firstUserMessage.content, 56) : '';
          const preview = firstAssistantMessage ? truncateSessionText(firstAssistantMessage.content, 120) : '';
          return {
            id: state.session.id,
            title: title || 'New chat',
            preview: preview || 'No messages yet',
            status: state.session.status,
            cwd: state.session.cwd,
            createdAt,
            updatedAt,
            messageCount: state.messages.length,
            attachmentCount: state.attachments.filter((attachment) => attachment.promptVisibility === 'available').length,
            reportCount: state.reportArtifacts.length
          };
        });
      const summaries = new Map(persisted.map((summary) => [summary.id, summary]));
      for (const summary of inMemory) {
        summaries.set(summary.id, summary);
      }
      return [...summaries.values()].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    },

    deleteSession(sessionId, cwd) {
      if (!isSafeSessionId(sessionId)) {
        return false;
      }

      const state = sessions.get(sessionId);
      const persisted = state ? null : loadPersistedSession(cwd, sessionId);
      if (!state && !persisted) {
        return false;
      }
      if (state && state.session.cwd !== cwd) {
        return false;
      }

      const reportArtifacts = state?.reportArtifacts ?? persisted?.reports ?? [];
      deleteWorkspaceOwnedReportFiles(cwd, reportArtifacts);
      deletePersistedSessionUploads(cwd, sessionId);
      deletePersistedSession(cwd, sessionId);
      state?.listeners.clear();
      sessions.delete(sessionId);
      return true;
    },

    subscribe(sessionId, listener) {
      const state = getSessionState(sessionId);
      for (const event of state.eventHistory) {
        listener(event);
      }
      state.listeners.add(listener);
      return () => {
        state.listeners.delete(listener);
      };
    },

    async submitPrompt(sessionId, prompt, options) {
      const state = getSessionState(sessionId);
      const stableStatus = state.session.status;
      const turnAttachments = resolveTurnAttachments(state, options?.attachmentIds);
      const previousReportCount = state.reportArtifacts.length;
      const explicitReportRouting = buildExplicitReportSuggestion(prompt, turnAttachments, toolCatalog);
      const visiblePrompt = buildVisibleUserPrompt(prompt, turnAttachments);
      const userMessage = createMessage('user', visiblePrompt);
      state.messages.push(userMessage);

      emit(state, {
        type: 'turn.started',
        sessionId,
        prompt
      });
      emit(state, {
        type: 'message.user',
        sessionId,
        message: userMessage
      });

      if (await handleLocalCommand(state, prompt, stableStatus, turnAttachments)) {
        return;
      }

      if (explicitReportRouting.reportSuggestion && !explicitReportRouting.reportSuggestion.canRun) {
        recordExplicitReportFallback(state, {
          skippedTool: explicitReportRouting.skippedTool,
          reportSuggestion: explicitReportRouting.reportSuggestion
        });
      }

      state.session.status = 'running';
      state.modelHistory.push({
        role: 'user',
        content: buildModelUserPrompt(prompt, turnAttachments, explicitReportRouting.reportSuggestion)
      });
      if (explicitReportRouting.reportSuggestion?.canRun) {
        state.reportSuggestion = explicitReportRouting.reportSuggestion;
      }
      persistState(state);

      await runTurnLoop(state, {
        turnAttachments,
        explicitReportRouting: explicitReportRouting.reportSuggestion?.canRun
          ? {
              skippedTool: explicitReportRouting.skippedTool,
              reportSuggestion: explicitReportRouting.reportSuggestion
            }
          : null
      });

      if (
        !explicitReportRouting.reportSuggestion &&
        turnAttachments.length &&
        state.reportArtifacts.length === previousReportCount
      ) {
        const routing = buildDefaultReportSuggestion(turnAttachments, toolCatalog);
        if (routing.skippedTool) {
          upsertSkippedTool(state, routing.skippedTool);
        }
        state.reportSuggestion = routing.reportSuggestion;
        persistState(state);
      }
    },

    async resolveApproval(sessionId, requestId, resolution: EngineApprovalResolution) {
      const state = getSessionState(sessionId);
      const pending = state.pendingApprovals.find((approval) => approval.requestId === requestId);
      if (!pending) {
        throw new Error(`Unknown approval request: ${requestId}`);
      }

      if (resolution.decision === 'deny') {
        state.pendingApprovals = state.pendingApprovals.filter(
          (approval) => approval.requestId !== requestId
        );
        state.pendingToolQueue = [];
        state.session.status = 'blocked';
        upsertToolActivity(state, {
          requestId,
          toolUseId: pending.toolUseId,
          toolName: pending.toolName,
          source: pending.source,
          category: pending.category,
          producesReports: pending.producesReports,
          status: 'denied',
          input: pending.input,
          reasoning: pending.reasoning,
          error: resolution.reason,
          completedAt: new Date().toISOString()
        });
        pushSystemMessage(
          state,
          `${pending.toolName} denied${resolution.reason ? `: ${resolution.reason}` : ''}`,
          'command-error'
        );
        emit(state, {
          type: 'tool.denied',
          sessionId,
          requestId,
          toolUseId: pending.toolUseId,
          toolName: pending.toolName,
          source: pending.source,
          agentId: pending.agentId,
          agentType: pending.agentType,
          category: pending.category,
          reason: resolution.reason
        });
        emit(state, {
          type: 'turn.completed',
          sessionId,
          status: 'blocked'
        });
        persistState(state);
        return;
      }

      const approvalExecutionOutcome = await completeToolExecution(
        state,
        requestId,
        pending.toolUseId,
        pending.toolName,
        resolution.updatedInput ?? pending.input,
        {
          agentId: pending.agentId,
          agentType: pending.agentType,
          reasoning: pending.reasoning
        }
      );
      if (approvalExecutionOutcome !== 'completed') {
        emit(state, {
          type: 'turn.completed',
          sessionId,
          status: 'blocked'
        });
        persistState(state);
        return;
      }

      if (pending.toolName === 'Agent') {
        await prepareAgentContinuation(state, spawnedAgentIdsForToolUse(state, pending.toolUseId));
        persistState(state);
      }

      if (state.pendingToolQueue.length) {
        const queuedResult = await processMainToolQueue(state, [...state.pendingToolQueue], 1);
        if (queuedResult === 'paused') {
          return;
        }
        if (queuedResult === 'recoverable_failed') {
          state.session.status = 'running';
          await runTurnLoop(state);
          return;
        }
        if (queuedResult === 'blocked') {
          emit(state, {
            type: 'turn.completed',
            sessionId,
            status: 'blocked'
          });
          persistState(state);
          return;
        }
      }

      if (pending.resumeAfterApproval === false) {
        state.session.status = finalizeLocalCommandStatus(state, 'completed');
        emit(state, {
          type: 'turn.completed',
          sessionId,
          status: 'completed'
        });
        persistState(state);
        return;
      }
      state.session.status = 'running';
      await runTurnLoop(state);
    },

    addAttachment(sessionId, attachment) {
      const state = getSessionState(sessionId);
      const existing = findAttachment(state, attachment.id);
      if (existing) {
        state.attachments = state.attachments.map((item) =>
          item.id === attachment.id ? attachment : item
        );
      } else {
        state.attachments = [...state.attachments, attachment];
      }

      emit(state, {
        type: 'attachment.added',
        sessionId,
        attachment
      });
      persistState(state);
      return attachment;
    },

    recordAttachmentUpload(sessionId, attachmentIds) {
      const state = getSessionState(sessionId);
      const attachments = attachmentIds
        .map((attachmentId) => findAttachment(state, attachmentId))
        .filter((attachment): attachment is EngineAttachment => Boolean(attachment));
      if (!attachments.length) {
        return null;
      }

      const archiveNames = Array.from(
        new Set(attachments.map((attachment) => attachment.sourceArchive?.name).filter(Boolean))
      );
      const content = archiveNames.length === 1
        ? `Uploaded ${attachments.length} ${attachments.length === 1 ? 'file' : 'files'} from ${archiveNames[0]}`
        : `Uploaded ${attachments.length} ${attachments.length === 1 ? 'file' : 'files'}`;
      const systemMessage: EngineMessage = {
        ...createMessage('system', content, 'attachment'),
        attachmentIds: attachments.map((attachment) => attachment.id)
      };
      state.messages.push(systemMessage);
      emit(state, {
        type: 'message.system',
        sessionId,
        message: systemMessage
      });
      persistState(state);
      return systemMessage;
    },

    removeAttachment(sessionId, attachmentId) {
      const state = getSessionState(sessionId);
      const attachment = findAttachment(state, attachmentId);
      if (!attachment) {
        return null;
      }

      const removedAttachment: EngineAttachment = {
        ...attachment,
        promptVisibility: 'removed'
      };
      state.attachments = state.attachments.map((item) =>
        item.id === attachmentId ? removedAttachment : item
      );
      emit(state, {
        type: 'attachment.removed',
        sessionId,
        attachmentId
      });
      persistState(state);
      return removedAttachment;
    },

    getAttachment(sessionId, attachmentId) {
      const attachment = findAttachment(getSessionState(sessionId), attachmentId);
      return attachment ? { ...attachment } : null;
    },

    getReportArtifact(sessionId, reportId) {
      const report = getSessionState(sessionId).reportArtifacts.find((artifact) => artifact.id === reportId);
      return report ? { ...report } : null;
    },

    getPendingApprovals(sessionId) {
      return [...getSessionState(sessionId).pendingApprovals];
    },

    getEventHistory(sessionId) {
      return [...getSessionState(sessionId).eventHistory];
    },

    getHistory(sessionId) {
      return [...getSessionState(sessionId).historySummaries];
    },

    getWorkspaceDiff(sessionId) {
      return [...getSessionState(sessionId).workspaceDiffs];
    },

    getCommandCatalog() {
      return [...COMMAND_CATALOG];
    },

    getSnapshot(sessionId): EngineSessionSnapshot {
      return buildSnapshot(getSessionState(sessionId));
    },

    healthCheck() {
      return input.provider.healthCheck();
    },

    cancelTurn(sessionId) {
      return input.provider.cancelTurn(sessionId);
    }
  };
}
