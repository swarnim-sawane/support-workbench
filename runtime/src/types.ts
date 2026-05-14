export type EngineRole = 'user' | 'assistant' | 'system';

export type BuiltInToolName =
  | 'Bash'
  | 'PowerShell'
  | 'Read'
  | 'Write'
  | 'Edit'
  | 'Glob'
  | 'Grep'
  | 'LogScan'
  | 'WebFetch'
  | 'WebSearch'
  | 'Agent'
  | 'Skill'
  | 'TodoWrite'
  | 'TaskOutput';

export type LeakedToolName = BuiltInToolName;
export type EngineToolName = BuiltInToolName | string;
export type EngineToolSource = 'builtin' | 'jd-mcp';
export type EngineToolVisibility = 'enabled' | 'unsupported' | 'hidden';
export type EngineToolStability = 'stable' | 'experimental' | 'flaky';

export type EngineTaskStatus = 'pending' | 'completed';
export type EngineAgentType = 'general' | 'research' | 'review' | 'diagnostics';
export type EngineAgentStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export type EngineAttachmentKind = 'text' | 'image';

export type EngineAttachmentPromptVisibility = 'available' | 'removed';

export type EngineAttachmentOcrStatus = 'pending' | 'completed' | 'failed' | 'unavailable';

export type EngineAttachment = {
  id: string;
  originalName: string;
  storedName: string;
  mediaType: string;
  kind: EngineAttachmentKind;
  localPath: string;
  size: number;
  promptVisibility: EngineAttachmentPromptVisibility;
  ocrStatus: EngineAttachmentOcrStatus;
  extractedText?: string;
  ocrError?: string;
  sourceArchive?: {
    id: string;
    name: string;
    relativePath: string;
  };
  uploadedAt: string;
};

export type EngineTask = {
  id: string;
  content: string;
  status: EngineTaskStatus;
};

export type EngineAgent = {
  id: string;
  parentSessionId: string;
  parentToolUseId: string;
  agentType: EngineAgentType;
  status: EngineAgentStatus;
  prompt: string;
  messages: EngineMessage[];
  toolActivity: EngineToolActivity[];
  resultSummary?: string;
  resultContent?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

export type EngineMemoryEntry = {
  id: string;
  content: string;
  createdAt: string;
};

export type EngineHistorySummary = {
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

export type EngineWorkspaceDiff = {
  path: string;
  before: string;
  after: string;
};

export type EngineCommandInfo = {
  name: string;
  description: string;
  category: 'workflow' | 'inspection' | 'memory' | 'integration' | 'config';
};

export type EngineSkillInfo = {
  name: string;
  description: string;
  path: string;
};

export type EngineToolDescriptor = {
  name: string;
  description: string;
  source: EngineToolSource;
  requiresApproval: boolean;
  category?: string;
  producesReports?: boolean;
  enabled?: boolean;
  visibility?: EngineToolVisibility;
  stability?: EngineToolStability;
  reason?: string;
};

export type EngineReportArtifact = {
  id: string;
  requestId?: string;
  sessionId: string;
  toolName: string;
  source: EngineToolSource;
  kind: 'html-report';
  title: string;
  filePath: string;
  fileName: string;
  createdAt: string;
  size: number;
};

export type EngineIntegrationSnapshot = {
  skills: EngineSkillInfo[];
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
    toolDescriptors: EngineToolDescriptor[];
  };
};

export type EngineToolActivityStatus = 'pending' | 'running' | 'completed' | 'failed' | 'denied';

export type EngineToolSkipReasonCode =
  | 'analyzer_unavailable_direct_analysis_used'
  | 'builtin_better_for_single_file'
  | 'explicit_tool_request_not_honored'
  | 'tool_requires_folder_not_file'
  | 'tool_output_likely_weaker_than_direct_analysis'
  | 'tool_unavailable_or_unsupported'
  | 'user_did_not_request_report_mode';

export type EngineSkippedToolRecord = {
  toolName: string;
  source: EngineToolSource;
  reasonCode: EngineToolSkipReasonCode;
  explanation: string;
  canOverride: boolean;
  createdAt: string;
};

export type EngineReportSuggestion = {
  available: boolean;
  canRun: boolean;
  suggestedToolName: string;
  source: EngineToolSource;
  explanation: string;
  attachmentIds: string[];
  input: Record<string, unknown>;
  reasonCode: EngineToolSkipReasonCode;
};

export type EngineProgressPhase =
  | 'attachments.discovering'
  | 'attachments.classifying'
  | 'model.thinking'
  | 'tool.executing'
  | 'answer.preparing';

export type EngineProgressActivityStatus = 'running' | 'completed';

export type EngineProgressActivity = {
  id: string;
  phase: EngineProgressPhase;
  label: string;
  detail?: string;
  status: EngineProgressActivityStatus;
  attachmentIds?: string[];
  toolName?: string;
  startedAt: string;
  completedAt?: string;
};

export type EngineToolActivity = {
  requestId: string;
  toolUseId: string;
  toolName: string;
  source: EngineToolSource;
  agentId?: string;
  agentType?: EngineAgentType;
  category?: string;
  producesReports?: boolean;
  status: EngineToolActivityStatus;
  input: Record<string, unknown>;
  reasoning?: string;
  summary?: string;
  metadata?: Record<string, unknown>;
  artifacts?: EngineReportArtifact[];
  error?: string;
  recoverable?: boolean;
  recoveryAttempt?: number;
  recoveryInstruction?: string;
  startedAt?: string;
  completedAt?: string;
};

export type EngineMessage = {
  id: string;
  role: EngineRole;
  content: string;
  createdAt: string;
  kind?: 'default' | 'command' | 'command-error' | 'tool' | 'attachment';
  attachmentIds?: string[];
};

export type EngineModelMessage =
  | {
      role: 'user' | 'assistant';
      content: string;
    }
  | {
      role: 'tool';
      toolName: string;
      toolUseId: string;
      content: string;
    };

export type EngineSessionStatus =
  | 'idle'
  | 'running'
  | 'awaiting_approval'
  | 'blocked'
  | 'completed';

export type EngineApprovalDecision = 'allow' | 'deny';

export type EngineApprovalResolution = {
  decision: EngineApprovalDecision;
  reason?: string;
  updatedInput?: Record<string, unknown>;
};

export type PendingApproval = {
  requestId: string;
  toolUseId: string;
  toolName: string;
  source: EngineToolSource;
  agentId?: string;
  agentType?: EngineAgentType;
  category?: string;
  input: Record<string, unknown>;
  reasoning?: string;
  producesReports?: boolean;
  requestedAt: string;
  resumeAfterApproval?: boolean;
};

export type EngineHealth = {
  ok: boolean;
  provider: string;
  model: string | null;
  error?: string;
};

export type EngineModelEvent =
  | {
      type: 'assistant_delta';
      text: string;
    }
  | {
      type: 'assistant_done';
    }
  | {
      type: 'tool_call';
      toolUseId?: string;
      toolName: string;
      input: Record<string, unknown>;
      reasoning?: string;
    };

export type EngineModelProvider = {
  sendTurn(
    messages: EngineModelMessage[],
    options: {
      sessionId: string;
      cwd: string;
      systemPrompt: string;
      tools: EngineToolDescriptor[];
    }
  ): AsyncIterable<EngineModelEvent>;
  cancelTurn(sessionId: string): Promise<void>;
  healthCheck(): Promise<EngineHealth>;
};

export type EngineToolExecutionResult = {
  summary: string;
  source?: EngineToolSource;
  metadata?: Record<string, unknown>;
  changedFiles?: string[];
  artifacts?: EngineReportArtifact[];
};

export type EngineToolExecutor = (args: {
  toolName: string;
  input: Record<string, unknown>;
  cwd: string;
  sessionId: string;
}) => Promise<EngineToolExecutionResult>;

export type EngineEvent =
  | {
      type: 'session.created';
      sessionId: string;
      cwd: string;
    }
  | {
      type: 'turn.started';
      sessionId: string;
      prompt: string;
      startedAt: string;
    }
  | {
      type: 'message.user';
      sessionId: string;
      message: EngineMessage;
    }
  | {
      type: 'message.system';
      sessionId: string;
      message: EngineMessage;
    }
  | {
      type: 'message.assistant.delta';
      sessionId: string;
      text: string;
    }
  | {
      type: 'message.assistant.done';
      sessionId: string;
      message: EngineMessage;
    }
  | {
      type: 'progress.started';
      sessionId: string;
      id: string;
      phase: EngineProgressPhase;
      label: string;
      detail?: string;
      status: 'running';
      attachmentIds?: string[];
      toolName?: string;
      startedAt: string;
    }
  | {
      type: 'progress.completed';
      sessionId: string;
      id: string;
      phase: EngineProgressPhase;
      label: string;
      detail?: string;
      status: 'completed';
      attachmentIds?: string[];
      toolName?: string;
      startedAt: string;
      completedAt: string;
    }
  | {
      type: 'permission.requested';
      sessionId: string;
      requestId: string;
      toolUseId: string;
      toolName: string;
      source: EngineToolSource;
      agentId?: string;
      agentType?: EngineAgentType;
      category?: string;
      input: Record<string, unknown>;
      reasoning?: string;
      producesReports?: boolean;
    }
  | {
      type: 'tool.execution.started';
      sessionId: string;
      requestId: string;
      toolUseId: string;
      toolName: string;
      source: EngineToolSource;
      agentId?: string;
      agentType?: EngineAgentType;
      category?: string;
      input: Record<string, unknown>;
      reasoning?: string;
      producesReports?: boolean;
    }
  | {
      type: 'tool.execution.completed';
      sessionId: string;
      requestId: string;
      toolUseId: string;
      toolName: string;
      source: EngineToolSource;
      agentId?: string;
      agentType?: EngineAgentType;
      category?: string;
      producesReports?: boolean;
      summary: string;
      metadata?: Record<string, unknown>;
      artifacts?: EngineReportArtifact[];
    }
  | {
      type: 'tool.execution.failed';
      sessionId: string;
      requestId: string;
      toolUseId: string;
      toolName: string;
      source: EngineToolSource;
      agentId?: string;
      agentType?: EngineAgentType;
      category?: string;
      producesReports?: boolean;
      error: string;
      metadata?: Record<string, unknown>;
      recoverable?: boolean;
      recoveryAttempt?: number;
      recoveryInstruction?: string;
    }
  | {
      type: 'workspace.changed';
      sessionId: string;
      changedFiles: string[];
    }
  | {
      type: 'attachment.added';
      sessionId: string;
      attachment: EngineAttachment;
    }
  | {
      type: 'attachment.removed';
      sessionId: string;
      attachmentId: string;
    }
  | {
      type: 'command.executed';
      sessionId: string;
      commandName: string;
      summary: string;
    }
  | {
      type: 'command.error';
      sessionId: string;
      commandName: string;
      message: string;
      suggestions: string[];
    }
  | {
      type: 'task.updated';
      sessionId: string;
      tasks: EngineTask[];
    }
  | {
      type: 'memory.updated';
      sessionId: string;
      entries: EngineMemoryEntry[];
    }
  | {
      type: 'history.compacted';
      sessionId: string;
      summary: EngineHistorySummary;
    }
  | {
      type: 'report.generated';
      sessionId: string;
      artifacts: EngineReportArtifact[];
    }
  | {
      type: 'agent.spawned';
      sessionId: string;
      agent: EngineAgent;
    }
  | {
      type: 'agent.updated';
      sessionId: string;
      agent: EngineAgent;
    }
  | {
      type: 'agent.completed';
      sessionId: string;
      agent: EngineAgent;
    }
  | {
      type: 'agent.failed';
      sessionId: string;
      agent: EngineAgent;
    }
  | {
      type: 'agent.cancelled';
      sessionId: string;
      agent: EngineAgent;
    }
  | {
      type: 'tool.denied';
      sessionId: string;
      requestId: string;
      toolUseId: string;
      toolName: string;
      source?: EngineToolSource;
      agentId?: string;
      agentType?: EngineAgentType;
      category?: string;
      reason?: string;
    }
  | {
      type: 'turn.completed';
      sessionId: string;
      status: 'completed' | 'blocked';
    };

export type EngineSessionSnapshot = {
  sessionId: string;
  status: EngineSessionStatus;
  messages: EngineMessage[];
  tasks: EngineTask[];
  memory: {
    entries: EngineMemoryEntry[];
  };
  history: {
    summaries: EngineHistorySummary[];
  };
  agents: EngineAgent[];
  skippedTools: EngineSkippedToolRecord[];
  reportSuggestion: EngineReportSuggestion | null;
  pendingApprovals: PendingApproval[];
  progressActivity: EngineProgressActivity[];
  toolActivity: EngineToolActivity[];
  attachments: EngineAttachment[];
  reports: {
    artifacts: EngineReportArtifact[];
  };
  workspace: {
    cwd: string;
    changedFiles: string[];
    diffs: EngineWorkspaceDiff[];
  };
  commands: EngineCommandInfo[];
  session: {
    branch: string | null;
    activeTurnStartedAt?: string;
  };
  integrations: EngineIntegrationSnapshot;
};

export type EngineSession = {
  id: string;
  cwd: string;
  status: EngineSessionStatus;
  activeTurnStartedAt?: string;
};

export type EngineSessionSummary = {
  id: string;
  title: string;
  preview: string;
  status: EngineSessionStatus;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  attachmentCount: number;
  reportCount: number;
};

export type WorkbenchEngine = {
  createSession(input: { cwd: string; sessionId?: string; ownerId?: string | null }): EngineSession;
  listSessions(cwd: string, ownerId?: string | null): EngineSessionSummary[];
  deleteSession(sessionId: string, cwd: string, ownerId?: string | null): boolean;
  subscribe(sessionId: string, listener: (event: EngineEvent) => void, ownerId?: string | null): () => void;
  submitPrompt(
    sessionId: string,
    prompt: string,
    options?: {
      attachmentIds?: string[];
      ownerId?: string | null;
      jdMcpToolName?: string;
    }
  ): Promise<void>;
  resolveApproval(
    sessionId: string,
    requestId: string,
    resolution: EngineApprovalResolution,
    ownerId?: string | null
  ): Promise<void>;
  addAttachment(sessionId: string, attachment: EngineAttachment, ownerId?: string | null): EngineAttachment;
  recordAttachmentUpload(sessionId: string, attachmentIds: string[], ownerId?: string | null): EngineMessage | null;
  removeAttachment(sessionId: string, attachmentId: string, ownerId?: string | null): EngineAttachment | null;
  getAttachment(sessionId: string, attachmentId: string, ownerId?: string | null): EngineAttachment | null;
  getReportArtifact(sessionId: string, reportId: string, ownerId?: string | null): EngineReportArtifact | null;
  getPendingApprovals(sessionId: string, ownerId?: string | null): PendingApproval[];
  getEventHistory(sessionId: string, ownerId?: string | null): EngineEvent[];
  getHistory(sessionId: string, ownerId?: string | null): EngineHistorySummary[];
  getWorkspaceDiff(sessionId: string, ownerId?: string | null): EngineWorkspaceDiff[];
  getCommandCatalog(): EngineCommandInfo[];
  getSnapshot(sessionId: string, ownerId?: string | null): EngineSessionSnapshot;
  healthCheck(): Promise<EngineHealth>;
  cancelTurn(sessionId: string): Promise<void>;
};
