export type WorkbenchMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  kind?: 'default' | 'command' | 'command-error' | 'tool' | 'attachment';
  attachmentIds?: string[];
};

export type WorkbenchAgentType = 'general' | 'research' | 'review' | 'diagnostics';
export type WorkbenchAgentStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export type PendingApproval = {
  requestId: string;
  toolUseId: string;
  toolName: string;
  source?: 'builtin' | 'jd-mcp';
  agentId?: string;
  agentType?: WorkbenchAgentType;
  category?: string;
  input: Record<string, unknown>;
  reasoning?: string;
  producesReports?: boolean;
};

export type WorkbenchTask = {
  id: string;
  content: string;
  status: 'pending' | 'completed';
};

export type WorkbenchAttachment = {
  id: string;
  originalName: string;
  storedName: string;
  mediaType: string;
  kind: 'text' | 'image';
  localPath: string;
  size: number;
  promptVisibility: 'available' | 'removed';
  ocrStatus: 'pending' | 'completed' | 'failed' | 'unavailable';
  extractedText?: string;
  sourceArchive?: {
    id: string;
    name: string;
    relativePath: string;
  };
  uploadedAt: string;
};

export type WorkbenchMemoryEntry = {
  id: string;
  content: string;
  createdAt: string;
};

export type WorkbenchHistorySummary = {
  id: string;
  title: string;
  preview: string;
  transcript: string[];
  openTasks: string[];
  rememberedNotes: string[];
  changedFiles: string[];
  createdAt: string;
  text?: string;
};

export type WorkbenchWorkspaceDiff = {
  path: string;
  before: string;
  after: string;
};

export type WorkbenchBackgroundAgent = {
  id: string;
  parentSessionId: string;
  parentToolUseId: string;
  agentType: WorkbenchAgentType;
  status: WorkbenchAgentStatus;
  prompt: string;
  messages: WorkbenchMessage[];
  toolActivity: WorkbenchToolActivity[];
  resultSummary?: string;
  resultContent?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

export type WorkbenchCommandInfo = {
  name: string;
  description: string;
  category: 'workflow' | 'inspection' | 'memory' | 'integration' | 'config';
};

export type WorkbenchReportArtifact = {
  id: string;
  requestId?: string;
  sessionId: string;
  toolName: string;
  source: 'builtin' | 'jd-mcp';
  kind: 'html-report';
  title: string;
  filePath: string;
  fileName: string;
  createdAt: string;
  size: number;
};

export type WorkbenchSkillInfo = {
  name: string;
  description: string;
  path: string;
};

export type WorkbenchIntegrationSnapshot = {
  skills: WorkbenchSkillInfo[];
  mcp: {
    available: boolean;
    servers: string[];
    note?: string;
  };
  lsp: {
    available: boolean;
    note: string;
  };
  jdMcp: {
    available: boolean;
    connected: boolean;
    note?: string;
    tools: string[];
    categories: string[];
    toolDescriptors: WorkbenchToolDescriptor[];
  };
};

export type WorkbenchToolDescriptor = {
  name: string;
  description: string;
  source: 'builtin' | 'jd-mcp';
  requiresApproval: boolean;
  category?: string;
  producesReports?: boolean;
  enabled?: boolean;
  visibility?: 'enabled' | 'unsupported' | 'hidden';
  stability?: 'stable' | 'experimental' | 'flaky';
  reason?: string;
};

export type WorkbenchToolActivity = {
  requestId: string;
  toolUseId: string;
  toolName: string;
  source: 'builtin' | 'jd-mcp';
  agentId?: string;
  agentType?: WorkbenchAgentType;
  category?: string;
  producesReports?: boolean;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'denied';
  input: Record<string, unknown>;
  reasoning?: string;
  summary?: string;
  metadata?: Record<string, unknown>;
  artifacts?: WorkbenchReportArtifact[];
  error?: string;
  recoverable?: boolean;
  recoveryAttempt?: number;
  recoveryInstruction?: string;
  startedAt?: string;
  completedAt?: string;
};

export type WorkbenchToolSkipReasonCode =
  | 'analyzer_unavailable_direct_analysis_used'
  | 'builtin_better_for_single_file'
  | 'explicit_tool_request_not_honored'
  | 'tool_requires_folder_not_file'
  | 'tool_output_likely_weaker_than_direct_analysis'
  | 'tool_unavailable_or_unsupported'
  | 'user_did_not_request_report_mode';

export type WorkbenchSkippedToolRecord = {
  toolName: string;
  source: 'builtin' | 'jd-mcp';
  reasonCode: WorkbenchToolSkipReasonCode;
  explanation: string;
  canOverride: boolean;
  createdAt: string;
};

export type WorkbenchReportSuggestion = {
  available: boolean;
  canRun: boolean;
  suggestedToolName: string;
  source: 'builtin' | 'jd-mcp';
  explanation: string;
  attachmentIds: string[];
  input: Record<string, unknown>;
  reasonCode: WorkbenchToolSkipReasonCode;
};

export type WorkbenchSessionSnapshot = {
  sessionId: string;
  status: 'idle' | 'running' | 'awaiting_approval' | 'blocked' | 'completed';
  messages: WorkbenchMessage[];
  tasks: WorkbenchTask[];
  memory: {
    entries: WorkbenchMemoryEntry[];
  };
  history: {
    summaries: WorkbenchHistorySummary[];
  };
  agents: WorkbenchBackgroundAgent[];
  skippedTools: WorkbenchSkippedToolRecord[];
  reportSuggestion: WorkbenchReportSuggestion | null;
  pendingApprovals: PendingApproval[];
  toolActivity: WorkbenchToolActivity[];
  attachments: WorkbenchAttachment[];
  reports: {
    artifacts: WorkbenchReportArtifact[];
  };
  workspace: {
    cwd: string;
    changedFiles: string[];
    diffs: WorkbenchWorkspaceDiff[];
  };
  commands: WorkbenchCommandInfo[];
  session: {
    branch: string | null;
    activeTurnStartedAt?: string;
  };
  integrations: WorkbenchIntegrationSnapshot;
};

export type WorkbenchHealth = {
  ok: boolean;
  provider: string;
  model: string | null;
  error?: string;
};

export type WorkbenchSessionSummary = {
  id: string;
  title: string;
  preview: string;
  status: WorkbenchSessionSnapshot['status'];
  cwd: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  attachmentCount: number;
  reportCount: number;
};
