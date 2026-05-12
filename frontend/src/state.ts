import type {
  WorkbenchAttachment,
  WorkbenchBackgroundAgent,
  PendingApproval,
  WorkbenchHistorySummary,
  WorkbenchMessage,
  WorkbenchReportArtifact,
  WorkbenchSessionSnapshot,
  WorkbenchTask,
  WorkbenchToolActivity
} from './types';

type EngineEvent =
  | {
      type: 'session.created';
      sessionId: string;
      cwd: string;
    }
  | {
      type: 'message.user';
      sessionId: string;
      message: WorkbenchMessage;
    }
  | {
      type: 'message.system';
      sessionId: string;
      message: WorkbenchMessage;
    }
  | {
      type: 'message.assistant.delta';
      sessionId: string;
      text: string;
    }
  | {
      type: 'message.assistant.done';
      sessionId: string;
      message: WorkbenchMessage;
    }
  | {
      type: 'permission.requested';
      sessionId: string;
      requestId: string;
      toolUseId: string;
      toolName: string;
      source?: 'builtin' | 'jd-mcp';
      agentId?: string;
      agentType?: 'general' | 'research' | 'review' | 'diagnostics';
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
      source?: 'builtin' | 'jd-mcp';
      agentId?: string;
      agentType?: 'general' | 'research' | 'review' | 'diagnostics';
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
      summary: string;
      source?: 'builtin' | 'jd-mcp';
      agentId?: string;
      agentType?: 'general' | 'research' | 'review' | 'diagnostics';
      category?: string;
      producesReports?: boolean;
      metadata?: Record<string, unknown>;
      artifacts?: WorkbenchReportArtifact[];
    }
  | {
      type: 'tool.execution.failed';
      sessionId: string;
      requestId: string;
      toolUseId: string;
      toolName: string;
      source?: 'builtin' | 'jd-mcp';
      agentId?: string;
      agentType?: 'general' | 'research' | 'review' | 'diagnostics';
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
      attachment: WorkbenchAttachment;
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
      tasks: WorkbenchTask[];
    }
  | {
      type: 'memory.updated';
      sessionId: string;
      entries: WorkbenchSessionSnapshot['memory']['entries'];
    }
  | {
      type: 'history.compacted';
      sessionId: string;
      summary: WorkbenchHistorySummary;
    }
  | {
      type: 'report.generated';
      sessionId: string;
      artifacts: WorkbenchReportArtifact[];
    }
  | {
      type: 'agent.spawned' | 'agent.updated' | 'agent.completed' | 'agent.failed' | 'agent.cancelled';
      sessionId: string;
      agent: WorkbenchBackgroundAgent;
    }
  | {
      type: 'tool.denied';
      sessionId: string;
      requestId: string;
      toolUseId: string;
      toolName: string;
      source?: 'builtin' | 'jd-mcp';
      agentId?: string;
      agentType?: 'general' | 'research' | 'review' | 'diagnostics';
      category?: string;
      reason?: string;
    }
  | {
      type: 'turn.started';
      sessionId: string;
      prompt: string;
    }
  | {
      type: 'turn.completed';
      sessionId: string;
      status: 'completed' | 'blocked';
    };

function toSystemMessage(
  content: string,
  kind: WorkbenchMessage['kind'] = 'default'
): WorkbenchMessage {
  return {
    id: `system-${crypto.randomUUID()}`,
    role: 'system',
    content,
    kind
  };
}

function upsertToolActivity(
  toolActivity: WorkbenchSessionSnapshot['toolActivity'],
  nextActivity: WorkbenchToolActivity
): WorkbenchSessionSnapshot['toolActivity'] {
  return [
    nextActivity,
    ...toolActivity.filter((activity) => activity.requestId !== nextActivity.requestId)
  ];
}

function upsertAgent(
  agents: WorkbenchSessionSnapshot['agents'],
  nextAgent: WorkbenchBackgroundAgent
): WorkbenchSessionSnapshot['agents'] {
  return [nextAgent, ...agents.filter((agent) => agent.id !== nextAgent.id)];
}

export function reduceEngineEvent(
  snapshot: WorkbenchSessionSnapshot,
  event: EngineEvent
): WorkbenchSessionSnapshot {
  switch (event.type) {
    case 'turn.started':
      return {
        ...snapshot,
        status: 'running'
      };
    case 'message.user':
    case 'message.system':
      return {
        ...snapshot,
        messages: [...snapshot.messages, event.message]
      };
    case 'message.assistant.delta': {
      const last = snapshot.messages.at(-1);
      if (last?.role === 'assistant') {
        const updated = {
          ...last,
          content: `${last.content}${event.text}`
        };
        return {
          ...snapshot,
          messages: [...snapshot.messages.slice(0, -1), updated]
        };
      }

      return {
        ...snapshot,
        messages: [
          ...snapshot.messages,
          {
            id: `assistant-draft-${crypto.randomUUID()}`,
            role: 'assistant',
            content: event.text,
            kind: 'default'
          }
        ]
      };
    }
    case 'message.assistant.done': {
      const last = snapshot.messages.at(-1);
      if (last?.role === 'assistant') {
        return {
          ...snapshot,
          messages: [...snapshot.messages.slice(0, -1), event.message]
        };
      }

      return {
        ...snapshot,
        messages: [...snapshot.messages, event.message]
      };
    }
    case 'permission.requested': {
      const pendingApproval: PendingApproval = {
        requestId: event.requestId,
        toolUseId: event.toolUseId,
        toolName: event.toolName,
        source: event.source,
        agentId: event.agentId,
        agentType: event.agentType,
        category: event.category,
        input: event.input,
        reasoning: event.reasoning,
        producesReports: event.producesReports
      };
      return {
        ...snapshot,
        status: 'awaiting_approval',
        pendingApprovals: [...snapshot.pendingApprovals, pendingApproval],
        toolActivity: upsertToolActivity(snapshot.toolActivity, {
          requestId: event.requestId,
          toolUseId: event.toolUseId,
          toolName: event.toolName,
          source: event.source ?? 'builtin',
          agentId: event.agentId,
          agentType: event.agentType,
          category: event.category,
          producesReports: event.producesReports,
          status: 'pending',
          input: event.input,
          reasoning: event.reasoning
        })
      };
    }
    case 'tool.execution.started':
      return {
        ...snapshot,
        status: event.agentId ? snapshot.status : 'running',
        pendingApprovals: snapshot.pendingApprovals.filter(
          (approval) => approval.requestId !== event.requestId
        ),
        toolActivity: upsertToolActivity(snapshot.toolActivity, {
          requestId: event.requestId,
          toolUseId: event.toolUseId,
          toolName: event.toolName,
          source: event.source ?? 'builtin',
          agentId: event.agentId,
          agentType: event.agentType,
          category: event.category,
          producesReports: event.producesReports,
          status: 'running',
          input: event.input,
          reasoning: event.reasoning,
          startedAt: new Date().toISOString()
        }),
        messages: event.agentId
          ? snapshot.messages
          : [
              ...snapshot.messages,
              toSystemMessage(
                `Running ${event.toolName}${event.source ? ` via ${event.source}` : ''}`,
                'tool'
              )
            ]
      };
    case 'tool.execution.completed':
      return {
        ...snapshot,
        toolActivity: upsertToolActivity(snapshot.toolActivity, {
          requestId: event.requestId,
          toolUseId: event.toolUseId,
          toolName: event.toolName,
          source: event.source ?? 'builtin',
          agentId: event.agentId,
          agentType: event.agentType,
          category: event.category,
          producesReports: event.producesReports,
          status: 'completed',
          input:
            snapshot.toolActivity.find((activity) => activity.requestId === event.requestId)?.input ?? {},
          summary: event.summary,
          metadata: event.metadata,
          artifacts: event.artifacts,
          startedAt:
            snapshot.toolActivity.find((activity) => activity.requestId === event.requestId)?.startedAt,
          completedAt: new Date().toISOString()
        }),
        messages: event.agentId
          ? snapshot.messages
          : [...snapshot.messages, toSystemMessage(`${event.toolName}: ${event.summary}`, 'tool')]
      };
    case 'tool.execution.failed': {
      const recoverableFailure = event.recoverable === true;
      return {
        ...snapshot,
        status: event.agentId || recoverableFailure ? snapshot.status : 'blocked',
        toolActivity: upsertToolActivity(snapshot.toolActivity, {
          requestId: event.requestId,
          toolUseId: event.toolUseId,
          toolName: event.toolName,
          source: event.source ?? 'builtin',
          agentId: event.agentId,
          agentType: event.agentType,
          category: event.category,
          producesReports: event.producesReports,
          status: 'failed',
          input:
            snapshot.toolActivity.find((activity) => activity.requestId === event.requestId)?.input ?? {},
          metadata: event.metadata,
          error: event.error,
          recoverable: event.recoverable,
          recoveryAttempt: event.recoveryAttempt,
          recoveryInstruction: event.recoveryInstruction,
          startedAt:
            snapshot.toolActivity.find((activity) => activity.requestId === event.requestId)?.startedAt,
          completedAt: new Date().toISOString()
        }),
        reportSuggestion: event.producesReports ? null : snapshot.reportSuggestion,
        messages: event.agentId
          ? snapshot.messages
          : [
              ...snapshot.messages,
              toSystemMessage(`${event.toolName} failed: ${event.error}`, 'command-error')
            ]
      };
    }
    case 'report.generated':
      return {
        ...snapshot,
        reports: {
          artifacts: [
            ...snapshot.reports.artifacts.filter(
              (artifact) => !event.artifacts.some((next) => next.id === artifact.id)
            ),
            ...event.artifacts
          ]
        }
      };
    case 'agent.spawned':
    case 'agent.updated':
    case 'agent.completed':
    case 'agent.failed':
    case 'agent.cancelled':
      return {
        ...snapshot,
        agents: upsertAgent(snapshot.agents, event.agent)
      };
    case 'workspace.changed':
      return {
        ...snapshot,
        workspace: {
          ...snapshot.workspace,
          changedFiles: Array.from(new Set([...snapshot.workspace.changedFiles, ...event.changedFiles]))
        }
      };
    case 'attachment.added':
      return {
        ...snapshot,
        attachments: [
          ...snapshot.attachments.filter((attachment) => attachment.id !== event.attachment.id),
          event.attachment
        ]
      };
    case 'attachment.removed':
      return {
        ...snapshot,
        attachments: snapshot.attachments.map((attachment) =>
          attachment.id === event.attachmentId
            ? { ...attachment, promptVisibility: 'removed' }
            : attachment
        )
      };
    case 'command.executed':
      return {
        ...snapshot,
        messages: [...snapshot.messages, toSystemMessage(`${event.commandName}: ${event.summary}`, 'command')]
      };
    case 'command.error':
      {
        const content =
          event.suggestions.length && !event.suggestions.some((suggestion) => event.message.includes(suggestion))
            ? `${event.message} Suggestions: ${event.suggestions.join(', ')}`
            : event.message;
      return {
        ...snapshot,
        messages: [...snapshot.messages, toSystemMessage(content, 'command-error')]
      };
      }
    case 'task.updated':
      return {
        ...snapshot,
        tasks: event.tasks
      };
    case 'memory.updated':
      return {
        ...snapshot,
        memory: {
          entries: event.entries
        }
      };
    case 'history.compacted':
      return {
        ...snapshot,
        history: {
          summaries: [...snapshot.history.summaries, event.summary]
        },
        messages:
          snapshot.messages.at(-1)?.content.includes('/compact') === true
            ? snapshot.messages
            : [
                ...snapshot.messages,
                toSystemMessage(`/compact: saved summary ${event.summary.id}`, 'command')
              ]
      };
    case 'tool.denied':
      return {
        ...snapshot,
        status: 'blocked',
        pendingApprovals: snapshot.pendingApprovals.filter(
          (approval) => approval.requestId !== event.requestId
        ),
        toolActivity: upsertToolActivity(snapshot.toolActivity, {
          requestId: event.requestId,
          toolUseId: event.toolUseId,
          toolName: event.toolName,
          source: event.source ?? 'builtin',
          agentId: event.agentId,
          agentType: event.agentType,
          category: event.category,
          status: 'denied',
          input:
            snapshot.toolActivity.find((activity) => activity.requestId === event.requestId)?.input ?? {},
          error: event.reason,
          startedAt:
            snapshot.toolActivity.find((activity) => activity.requestId === event.requestId)?.startedAt,
          completedAt: new Date().toISOString()
        }),
        messages: event.agentId
          ? snapshot.messages
          : [
              ...snapshot.messages,
              toSystemMessage(
                `${event.toolName} denied${event.reason ? `: ${event.reason}` : ''}`,
                'command-error'
              )
            ]
      };
    case 'turn.completed':
      return {
        ...snapshot,
        status: event.status === 'blocked' ? 'blocked' : 'completed'
      };
    case 'session.created':
      return {
        ...snapshot,
        sessionId: event.sessionId,
        workspace: {
          ...snapshot.workspace,
          cwd: event.cwd
        }
      };
    default:
      return snapshot;
  }
}
