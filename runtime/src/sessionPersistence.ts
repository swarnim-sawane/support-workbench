import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  EngineAttachment,
  EngineAgent,
  EngineEvent,
  EngineHistorySummary,
  EngineMemoryEntry,
  EngineMessage,
  EngineModelMessage,
  EngineProgressActivity,
  EngineReportSuggestion,
  EngineReportArtifact,
  EngineSession,
  EngineSessionSummary,
  EngineSkippedToolRecord,
  EngineTask,
  EngineToolActivity,
  EngineWorkspaceDiff,
  PendingApproval
} from './types.js';

export type PersistedSessionRecord = {
  ownerId?: string | null;
  session: EngineSession;
  createdAt?: string;
  updatedAt?: string;
  messages: EngineMessage[];
  modelHistory: EngineModelMessage[];
  pendingApprovals: PendingApproval[];
  changedFiles: string[];
  workspaceDiffs: EngineWorkspaceDiff[];
  eventHistory: EngineEvent[];
  currentAssistantDraft: string;
  tasks: EngineTask[];
  memoryEntries: EngineMemoryEntry[];
  historySummaries: EngineHistorySummary[];
  progressActivity?: EngineProgressActivity[];
  toolActivity?: EngineToolActivity[];
  agents?: EngineAgent[];
  skippedTools?: EngineSkippedToolRecord[];
  reportSuggestion?: EngineReportSuggestion | null;
  attachments: EngineAttachment[];
  reports: EngineReportArtifact[];
  branch: string | null;
};

function sessionDir(cwd: string): string {
  return join(cwd, '.claude-oca', 'sessions');
}

function sessionPath(cwd: string, sessionId: string): string {
  return join(sessionDir(cwd), `${sessionId}.json`);
}

export function loadPersistedSession(
  cwd: string,
  sessionId: string
): PersistedSessionRecord | null {
  const path = sessionPath(cwd, sessionId);
  if (!existsSync(path)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(path, 'utf8')) as PersistedSessionRecord;
  } catch {
    return null;
  }
}

export function savePersistedSession(cwd: string, record: PersistedSessionRecord): void {
  const directory = sessionDir(cwd);
  mkdirSync(directory, { recursive: true });
  writeFileSync(sessionPath(cwd, record.session.id), JSON.stringify(record, null, 2), 'utf8');
}

export function deletePersistedSession(cwd: string, sessionId: string): boolean {
  const path = sessionPath(cwd, sessionId);
  const existed = existsSync(path);
  rmSync(path, { force: true });
  return existed;
}

export function deletePersistedSessionUploads(cwd: string, sessionId: string): void {
  rmSync(join(cwd, '.claude-oca', 'uploads', sessionId), {
    force: true,
    recursive: true
  });
}

export function listPersistedSessionSummaries(
  cwd: string,
  ownerId?: string | null
): EngineSessionSummary[] {
  const directory = sessionDir(cwd);
  if (!existsSync(directory)) {
    return [];
  }

  return readdirSync(directory)
    .filter((fileName) => fileName.endsWith('.json'))
    .map((fileName) => readSessionSummary(cwd, fileName, ownerId))
    .filter((summary): summary is EngineSessionSummary => summary !== null)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export function persistedSessionOwner(record: PersistedSessionRecord): string | null {
  return typeof record.ownerId === 'string' ? record.ownerId : null;
}

function ownerMatches(record: PersistedSessionRecord, ownerId?: string | null): boolean {
  return ownerId === undefined || persistedSessionOwner(record) === ownerId;
}

function readSessionSummary(
  cwd: string,
  fileName: string,
  ownerId?: string | null
): EngineSessionSummary | null {
  const path = join(sessionDir(cwd), fileName);
  try {
    const record = JSON.parse(readFileSync(path, 'utf8')) as PersistedSessionRecord;
    if (!ownerMatches(record, ownerId)) {
      return null;
    }
    if (!isMeaningfulSessionRecord(record)) {
      return null;
    }

    const stats = statSync(path);
    const createdAt = firstDate(
      record.createdAt,
      record.messages[0]?.createdAt,
      record.eventHistory[0]?.type === 'session.created' ? stats.birthtime.toISOString() : undefined,
      stats.birthtime.toISOString(),
      stats.ctime.toISOString()
    );
    const updatedAt = firstDate(
      record.updatedAt,
      record.messages.at(-1)?.createdAt,
      record.eventHistory.at(-1)?.type ? stats.mtime.toISOString() : undefined,
      stats.mtime.toISOString(),
      createdAt
    );

    return {
      id: record.session.id,
      title: deriveSessionTitle(record.messages),
      preview: deriveSessionPreview(record.messages),
      status: record.session.status,
      cwd: record.session.cwd,
      createdAt,
      updatedAt,
      messageCount: record.messages.length,
      attachmentCount: record.attachments?.filter((attachment) => attachment.promptVisibility === 'available').length ?? 0,
      reportCount: record.reports?.length ?? 0
    };
  } catch {
    return null;
  }
}

export function isMeaningfulSessionRecord(record: PersistedSessionRecord): boolean {
  return (
    record.messages.length > 0 ||
    record.pendingApprovals.length > 0 ||
    record.changedFiles.length > 0 ||
    record.workspaceDiffs.length > 0 ||
    record.tasks.length > 0 ||
    record.memoryEntries.length > 0 ||
    record.historySummaries.length > 0 ||
    (record.progressActivity?.length ?? 0) > 0 ||
    (record.toolActivity?.length ?? 0) > 0 ||
    (record.agents?.length ?? 0) > 0 ||
    (record.skippedTools?.length ?? 0) > 0 ||
    record.attachments.some((attachment) => attachment.promptVisibility === 'available') ||
    record.reports.length > 0 ||
    Boolean(record.currentAssistantDraft.trim())
  );
}

function firstDate(...values: Array<string | undefined>): string {
  for (const value of values) {
    if (value && !Number.isNaN(Date.parse(value))) {
      return value;
    }
  }
  return new Date().toISOString();
}

function deriveSessionTitle(messages: EngineMessage[]): string {
  const firstUserMessage = messages.find((message) => message.role === 'user');
  if (!firstUserMessage) {
    return 'New chat';
  }

  const cleaned = stripAttachmentSuffix(firstUserMessage.content)
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned ? truncate(cleaned, 56) : 'New chat';
}

function deriveSessionPreview(messages: EngineMessage[]): string {
  const firstMessage = messages.find((message) => message.role === 'assistant') ?? messages.find(Boolean);
  if (!firstMessage) {
    return 'No messages yet';
  }

  const cleaned = stripAttachmentSuffix(firstMessage.content)
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned ? truncate(cleaned, 120) : 'No messages yet';
}

function stripAttachmentSuffix(content: string): string {
  return content.replace(/\n\nAttachments:[\s\S]*$/i, '');
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1).trimEnd()}...`;
}
