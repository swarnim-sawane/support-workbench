import { execFile as execFileCallback } from 'node:child_process';
import { createReadStream, promises as fs } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { readSkill } from './skills.js';
import type { EngineToolExecutor, EngineToolExecutionResult } from './types.js';

const execFile = promisify(execFileCallback);
const DEFAULT_GREP_MAX_MATCHES = 500;
const MAX_GREP_MAX_MATCHES = 2_000;
const DEFAULT_LOG_SCAN_MAX_EXAMPLES_PER_FILE = 12;
const MAX_LOG_SCAN_MAX_EXAMPLES_PER_FILE = 50;
const DEFAULT_LOG_SCAN_SLOW_MS_THRESHOLD = 5_000;
const MAX_REASONABLE_ACCESS_DURATION_MS = 30 * 60 * 1_000;
const MAX_LOG_SCAN_VALUE_LENGTH = 500;

type LogScanSeverityKey =
  | 'fatal'
  | 'severe'
  | 'error'
  | 'warn'
  | 'exception'
  | 'ora'
  | 'timeout';

type LogScanExample = {
  file: string;
  line: number;
  kind: string;
  content: string;
  timestamp?: string;
  duration_ms?: number;
  status?: string;
};

type LogScanFileSummary = {
  file: string;
  size_bytes: number;
  kind: string;
  line_count: number;
  time_range: {
    first: string | null;
    last: string | null;
  };
  severity_counts: Record<LogScanSeverityKey, number>;
  status_counts: Record<string, number>;
  slow_request_count: number;
  slow_requests: LogScanExample[];
  critical_examples: LogScanExample[];
  top_signatures: Array<{ signature: string; count: number; first_line: number; first_example: string }>;
  identifiers: Array<{ key: string; value: string; count: number }>;
};

const LOG_SCAN_SEVERITY_PATTERNS: Array<{ key: LogScanSeverityKey; regex: RegExp }> = [
  { key: 'fatal', regex: /\bFATAL\b/i },
  { key: 'severe', regex: /\bSEVERE\b/i },
  { key: 'error', regex: /\bERROR\b|(?:^|\s)[A-Za-z_$][\w.$]*Exception\b/i },
  { key: 'warn', regex: /\bWARN(?:ING)?\b/i },
  { key: 'exception', regex: /\b[A-Za-z_$][\w.$]*Exception\b/ },
  { key: 'ora', regex: /\bORA-\d{5}\b/i },
  { key: 'timeout', regex: /\b(?:timeout|timed out|request may timeout)\b/i }
];

function resolveWithinCwd(cwd: string, targetPath: string): string {
  const absolute = isAbsolute(targetPath) ? resolve(targetPath) : resolve(cwd, targetPath);
  const rel = relative(cwd, absolute);
  if (rel === '..' || rel.startsWith(`..${sep}`)) {
    throw new Error(`Path escapes cwd: ${targetPath}`);
  }
  return absolute;
}

function toDisplayPath(cwd: string, absolutePath: string): string {
  const rel = relative(cwd, absolutePath);
  return rel && !rel.startsWith('..') ? rel.split(sep).join('/') : absolutePath;
}

function lineNumberContent(content: string, offset = 1): string {
  return content
    .split('\n')
    .map((line, index) => `${String(offset + index).padStart(6, ' ')}\t${line}`)
    .join('\n');
}

async function listFilesRecursive(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = resolve(root, entry.name);
      if (entry.isDirectory()) {
        return listFilesRecursive(absolutePath);
      }
      if (entry.isFile()) {
        return [absolutePath];
      }
      return [];
    })
  );

  return files.flat();
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function globToRegExp(pattern: string): RegExp {
  const normalized = pattern.replace(/\\/g, '/');
  let regex = '^';

  for (let index = 0; index < normalized.length; index += 1) {
    const current = normalized[index];
    const next = normalized[index + 1];

    if (current === '*' && next === '*') {
      regex += '.*';
      index += 1;
      continue;
    }

    if (current === '*') {
      regex += '[^/]*';
      continue;
    }

    if (current === '?') {
      regex += '.';
      continue;
    }

    regex += escapeRegExp(current);
  }

  regex += '$';
  return new RegExp(regex);
}

function stripHtml(source: string): string {
  return source
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function positiveIntegerInput(value: unknown, fallback: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(Math.floor(parsed), maximum);
}

function truncateLogScanValue(value: string, maxLength = MAX_LOG_SCAN_VALUE_LENGTH): string {
  const cleaned = value.trim();
  return cleaned.length <= maxLength ? cleaned : `${cleaned.slice(0, maxLength - 1).trimEnd()}...`;
}

function createEmptySeverityCounts(): Record<LogScanSeverityKey, number> {
  return {
    fatal: 0,
    severe: 0,
    error: 0,
    warn: 0,
    exception: 0,
    ora: 0,
    timeout: 0
  };
}

function incrementSignature(
  map: Map<string, { count: number; firstLine: number; firstExample: string }>,
  signature: string,
  lineNumber: number,
  line: string
): void {
  const existing = map.get(signature);
  if (existing) {
    existing.count += 1;
    return;
  }

  map.set(signature, {
    count: 1,
    firstLine: lineNumber,
    firstExample: truncateLogScanValue(line)
  });
}

function classifyLogFile(displayPath: string): string {
  const normalized = displayPath.toLowerCase();
  if (normalized.includes('access')) {
    return 'access-log';
  }
  if (normalized.includes('catalina')) {
    return 'catalina-log';
  }
  if (normalized.endsWith('.out')) {
    return 'server-output-log';
  }
  if (normalized.endsWith('.log')) {
    return 'application-log';
  }
  return 'text-log';
}

function extractTimestampCandidate(line: string): string | null {
  const iso = line.match(/\b\d{4}-\d{2}-\d{2}[T ][0-2]\d:[0-5]\d:[0-5]\d(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/);
  if (iso?.[0]) {
    return iso[0];
  }

  const access = line.match(/\[[0-3]\d\/[A-Za-z]{3}\/\d{4}:[0-2]\d:[0-5]\d:[0-5]\d\s+[+-]\d{4}\]/);
  if (access?.[0]) {
    return access[0].slice(1, -1);
  }

  const dayMonth = line.match(/\b[0-3]?\d-[A-Za-z]{3}-\d{4}\s+[0-2]?\d:[0-5]\d:[0-5]\d\b/);
  return dayMonth?.[0] ?? null;
}

function extractHttpRequest(line: string): { method: string; target: string; status: string; after: string } | null {
  const request = line.match(/"\s*(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+([^"]*?)\s+HTTP\/[\d.]+"\s+(\d{3})\b(.*)$/i);
  if (!request?.[1] || !request[2] || !request[3]) {
    return null;
  }

  return {
    method: request[1].toUpperCase(),
    target: request[2],
    status: request[3],
    after: request[4] ?? ''
  };
}

function extractDurationMs(line: string, httpRequest: ReturnType<typeof extractHttpRequest>): number | null {
  const explicit = line.match(
    /\b(?:duration|elapsed|response[_-]?time|request[_-]?time|took|timeTaken|time_taken)\b\s*[=:]?\s*(\d+(?:\.\d+)?)\s*(ms|msec|millisecond(?:s)?|s|sec|second(?:s)?)?\b/i
  );
  if (explicit?.[1]) {
    const value = Number(explicit[1]);
    const unit = explicit[2]?.toLowerCase() ?? 'ms';
    if (Number.isFinite(value)) {
      return unit.startsWith('s') ? Math.round(value * 1000) : Math.round(value);
    }
  }

  const msLiteral = line.match(/\b(\d+(?:\.\d+)?)\s*(ms|msec|millisecond(?:s)?)\b/i);
  if (msLiteral?.[1]) {
    const value = Number(msLiteral[1]);
    return Number.isFinite(value) ? Math.round(value) : null;
  }

  if (!httpRequest) {
    return null;
  }

  const leadingNumbers: number[] = [];
  for (const token of httpRequest.after.trim().split(/\s+/)) {
    if (!token || token === '-') {
      continue;
    }
    if (!/^\d+(?:\.\d+)?$/.test(token)) {
      break;
    }
    leadingNumbers.push(Number(token));
  }
  const candidate = leadingNumbers.at(-1);
  if (
    typeof candidate === 'number' &&
    Number.isFinite(candidate) &&
    candidate > 0 &&
    candidate <= MAX_REASONABLE_ACCESS_DURATION_MS
  ) {
    return Math.round(candidate);
  }

  return null;
}

function extractSignature(line: string, status?: string): string | null {
  const explicit = line.match(/\b(?:[A-Za-z_$][\w.$]*Exception|ORA-\d{5}|JBO-\d+|ADF_FACES-\d+|BEA-\d+)\b/);
  if (explicit?.[0]) {
    return explicit[0];
  }

  if (/query criteria attributes are not indexed/i.test(line)) {
    return 'Unindexed query criteria may timeout';
  }

  if (status && /^[45]\d\d$/.test(status)) {
    return `HTTP ${status}`;
  }

  if (/\b(?:FATAL|SEVERE|ERROR|WARN(?:ING)?)\b/i.test(line)) {
    return truncateLogScanValue(
      line
        .replace(/\b\d{4}-\d{2}-\d{2}[T ][0-2]\d:[0-5]\d:[0-5]\d(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/g, '<timestamp>')
        .replace(/\b[0-9a-f]{8,}\b/gi, '<id>')
        .replace(/\b\d+\b/g, '<n>'),
      180
    );
  }

  return null;
}

function extractIdentifiers(line: string): Array<{ key: string; value: string }> {
  const identifiers: Array<{ key: string; value: string }> = [];
  const regex =
    /\b(tenantId|tenant_id|userId|user_id|requestId|request_id|opc-request-id|ecid|ECID|sessionId|session_id|traceId|trace_id|correlationId|correlation_id)\s*[=:]\s*([A-Za-z0-9_.:@/-]+)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(line)) !== null) {
    if (match[1] && match[2]) {
      identifiers.push({
        key: match[1],
        value: match[2]
      });
    }
  }

  return identifiers;
}

function isLogScanCriticalLine(
  severityCounts: Record<LogScanSeverityKey, number>,
  status: string | undefined,
  slowDurationMs: number | null
): boolean {
  return (
    severityCounts.fatal > 0 ||
    severityCounts.severe > 0 ||
    severityCounts.error > 0 ||
    severityCounts.ora > 0 ||
    severityCounts.timeout > 0 ||
    Boolean(status && /^[45]\d\d$/.test(status)) ||
    slowDurationMs !== null
  );
}

function listInputPaths(input: Record<string, unknown>): string[] {
  const paths: string[] = [];
  for (const key of ['file_paths', 'paths']) {
    const value = input[key];
    if (Array.isArray(value)) {
      paths.push(
        ...value
          .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
          .map((item) => item.trim())
      );
    }
  }

  for (const key of ['file_path', 'path', 'input_path', 'input']) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) {
      paths.push(value.trim());
    }
  }

  return [...new Set(paths)];
}

async function resolveLogScanFiles(cwd: string, input: Record<string, unknown>): Promise<string[]> {
  const explicitPaths = listInputPaths(input);
  if (explicitPaths.length) {
    return [...new Set(explicitPaths.map((item) => resolveWithinCwd(cwd, item)))];
  }

  const glob = typeof input.glob === 'string' && input.glob.trim() ? input.glob.trim() : null;
  if (!glob) {
    throw new Error('LogScan requires file_paths, paths, file_path, path, or glob');
  }

  const matcher = globToRegExp(glob);
  const files = await listFilesRecursive(cwd);
  return files.filter((file) => matcher.test(toDisplayPath(cwd, file).replace(/\\/g, '/')));
}

function toTopSignatures(
  signatures: Map<string, { count: number; firstLine: number; firstExample: string }>
): Array<{ signature: string; count: number; first_line: number; first_example: string }> {
  return [...signatures.entries()]
    .sort((left, right) => right[1].count - left[1].count || left[0].localeCompare(right[0]))
    .slice(0, 12)
    .map(([signature, entry]) => ({
      signature,
      count: entry.count,
      first_line: entry.firstLine,
      first_example: entry.firstExample
    }));
}

function toIdentifierSummary(identifiers: Map<string, { key: string; count: number }>): Array<{ key: string; value: string; count: number }> {
  return [...identifiers.entries()]
    .sort((left, right) => right[1].count - left[1].count || left[0].localeCompare(right[0]))
    .slice(0, 20)
    .map(([value, entry]) => ({
      key: entry.key,
      value,
      count: entry.count
    }));
}

async function scanOneLogFile(
  cwd: string,
  absolutePath: string,
  options: {
    maxExamplesPerFile: number;
    slowMsThreshold: number;
    identifierFiles: Map<string, { key: string; files: Set<string>; count: number }>;
  }
): Promise<LogScanFileSummary> {
  const displayPath = toDisplayPath(cwd, absolutePath);
  const stats = await fs.stat(absolutePath);
  const kind = classifyLogFile(displayPath);
  const severityCounts = createEmptySeverityCounts();
  const statusCounts: Record<string, number> = {};
  const slowRequests: LogScanExample[] = [];
  const criticalExamples: LogScanExample[] = [];
  const signatures = new Map<string, { count: number; firstLine: number; firstExample: string }>();
  const identifiers = new Map<string, { key: string; count: number }>();
  let lineCount = 0;
  let firstTimestamp: string | null = null;
  let lastTimestamp: string | null = null;
  let slowRequestCount = 0;

  const stream = createReadStream(absolutePath, { encoding: 'utf8' });
  const reader = createInterface({
    input: stream,
    crlfDelay: Infinity
  });

  for await (const line of reader) {
    lineCount += 1;
    const timestamp = extractTimestampCandidate(line);
    if (timestamp) {
      firstTimestamp ??= timestamp;
      lastTimestamp = timestamp;
    }

    const lineSeverityCounts = createEmptySeverityCounts();
    for (const pattern of LOG_SCAN_SEVERITY_PATTERNS) {
      pattern.regex.lastIndex = 0;
      if (pattern.regex.test(line)) {
        severityCounts[pattern.key] += 1;
        lineSeverityCounts[pattern.key] += 1;
      }
    }

    const httpRequest = extractHttpRequest(line);
    const status = httpRequest?.status;
    if (status) {
      statusCounts[status] = (statusCounts[status] ?? 0) + 1;
    }

    const durationMs = extractDurationMs(line, httpRequest);
    const isSlow = durationMs !== null && durationMs >= options.slowMsThreshold;
    if (isSlow) {
      slowRequestCount += 1;
    }

    const signature = extractSignature(line, status);
    if (signature) {
      incrementSignature(signatures, signature, lineCount, line);
    }

    for (const identifier of extractIdentifiers(line)) {
      const key = `${identifier.key}:${identifier.value}`;
      const fileIdentifier = identifiers.get(identifier.value);
      identifiers.set(identifier.value, {
        key: fileIdentifier?.key ?? identifier.key,
        count: (fileIdentifier?.count ?? 0) + 1
      });

      const globalIdentifier = options.identifierFiles.get(key);
      if (globalIdentifier) {
        globalIdentifier.files.add(displayPath);
        globalIdentifier.count += 1;
      } else {
        options.identifierFiles.set(key, {
          key: identifier.key,
          files: new Set([displayPath]),
          count: 1
        });
      }
    }

    if (isSlow && slowRequests.length < options.maxExamplesPerFile) {
      slowRequests.push({
        file: displayPath,
        line: lineCount,
        kind: 'slow_request',
        content: truncateLogScanValue(line),
        timestamp: timestamp ?? undefined,
        duration_ms: durationMs ?? undefined,
        status
      });
    }

    if (
      isLogScanCriticalLine(lineSeverityCounts, status, isSlow ? durationMs : null) &&
      criticalExamples.length < options.maxExamplesPerFile
    ) {
      criticalExamples.push({
        file: displayPath,
        line: lineCount,
        kind: signature ?? (isSlow ? 'slow_request' : status ? `HTTP ${status}` : 'critical'),
        content: truncateLogScanValue(line),
        timestamp: timestamp ?? undefined,
        duration_ms: isSlow ? (durationMs ?? undefined) : undefined,
        status
      });
    }
  }

  return {
    file: displayPath,
    size_bytes: stats.size,
    kind,
    line_count: lineCount,
    time_range: {
      first: firstTimestamp,
      last: lastTimestamp
    },
    severity_counts: severityCounts,
    status_counts: statusCounts,
    slow_request_count: slowRequestCount,
    slow_requests: slowRequests,
    critical_examples: criticalExamples,
    top_signatures: toTopSignatures(signatures),
    identifiers: toIdentifierSummary(identifiers)
  };
}

async function executeLogScan(
  cwd: string,
  input: Record<string, unknown>
): Promise<EngineToolExecutionResult> {
  const files = await resolveLogScanFiles(cwd, input);
  if (!files.length) {
    throw new Error('LogScan requires at least one matching file path or glob');
  }

  const maxExamplesPerFile = positiveIntegerInput(
    input.max_examples_per_file,
    DEFAULT_LOG_SCAN_MAX_EXAMPLES_PER_FILE,
    MAX_LOG_SCAN_MAX_EXAMPLES_PER_FILE
  );
  const slowMsThreshold = positiveIntegerInput(
    input.slow_ms_threshold,
    DEFAULT_LOG_SCAN_SLOW_MS_THRESHOLD,
    MAX_REASONABLE_ACCESS_DURATION_MS
  );
  const identifierFiles = new Map<string, { key: string; files: Set<string>; count: number }>();
  const summaries: LogScanFileSummary[] = [];

  for (const file of files) {
    summaries.push(
      await scanOneLogFile(cwd, file, {
        maxExamplesPerFile,
        slowMsThreshold,
        identifierFiles
      })
    );
  }

  const totals = summaries.reduce(
    (accumulator, file) => {
      accumulator.lines += file.line_count;
      accumulator.bytes += file.size_bytes;
      accumulator.slow_requests += file.slow_request_count;
      for (const key of Object.keys(file.severity_counts) as LogScanSeverityKey[]) {
        accumulator[key] += file.severity_counts[key];
      }
      for (const [status, count] of Object.entries(file.status_counts)) {
        if (/^4\d\d$/.test(status)) {
          accumulator.http_4xx += count;
        }
        if (/^5\d\d$/.test(status)) {
          accumulator.http_5xx += count;
        }
      }
      return accumulator;
    },
    {
      lines: 0,
      bytes: 0,
      fatal: 0,
      severe: 0,
      error: 0,
      warn: 0,
      exception: 0,
      ora: 0,
      timeout: 0,
      http_4xx: 0,
      http_5xx: 0,
      slow_requests: 0
    }
  );

  const criticalExamples = summaries.flatMap((file) => file.critical_examples).slice(0, 200);
  const slowRequests = summaries.flatMap((file) => file.slow_requests).slice(0, 100);
  const sharedIdentifiers = [...identifierFiles.entries()]
    .filter(([, entry]) => entry.files.size > 1)
    .sort((left, right) => right[1].files.size - left[1].files.size || right[1].count - left[1].count)
    .slice(0, 25)
    .map(([compoundKey, entry]) => ({
      key: entry.key,
      value: compoundKey.slice(entry.key.length + 1),
      count: entry.count,
      files: [...entry.files].sort()
    }));

  return {
    summary: `LogScan scanned ${summaries.length} file(s), ${totals.lines} line(s); found ${totals.error} error(s), ${totals.severe} severe event(s), ${totals.http_5xx} HTTP 5xx, and ${totals.slow_requests} slow request(s).`,
    metadata: {
      scanned_entire_files: true,
      returned_examples_are_capped: true,
      max_examples_per_file: maxExamplesPerFile,
      slow_ms_threshold: slowMsThreshold,
      total_files: files.length,
      scanned_files: summaries.length,
      totals,
      files: summaries,
      critical_examples: criticalExamples,
      slow_requests: slowRequests,
      cross_file: {
        shared_identifiers: sharedIdentifiers
      }
    }
  };
}

async function executeRead(
  cwd: string,
  input: Record<string, unknown>
): Promise<EngineToolExecutionResult> {
  const filePath = String(input.file_path ?? '');
  if (!filePath) {
    throw new Error('Read requires input.file_path');
  }

  const absolutePath = resolveWithinCwd(cwd, filePath);
  const raw = await fs.readFile(absolutePath, 'utf8');
  const lines = raw.split('\n');
  const offset = Math.max(1, Number(input.offset ?? 1));
  const limit = Number(input.limit ?? lines.length);
  const slice = lines.slice(offset - 1, offset - 1 + limit);
  const content = lineNumberContent(slice.join('\n'), offset);

  return {
    summary: `Read ${toDisplayPath(cwd, absolutePath)}`,
    metadata: {
      file_path: absolutePath,
      display_path: toDisplayPath(cwd, absolutePath),
      content
    }
  };
}

async function executeWrite(
  cwd: string,
  input: Record<string, unknown>
): Promise<EngineToolExecutionResult> {
  const filePath = String(input.file_path ?? '');
  const content = String(input.content ?? '');
  if (!filePath) {
    throw new Error('Write requires input.file_path');
  }

  const absolutePath = resolveWithinCwd(cwd, filePath);
  let before = '';
  try {
    before = await fs.readFile(absolutePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  await fs.mkdir(dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, content, 'utf8');

  const displayPath = toDisplayPath(cwd, absolutePath);
  return {
    summary: `Wrote ${displayPath}`,
    metadata: {
      file_path: absolutePath,
      display_path: displayPath,
      contentLength: content.length,
      before,
      after: content
    },
    changedFiles: [displayPath]
  };
}

async function executeEdit(
  cwd: string,
  input: Record<string, unknown>
): Promise<EngineToolExecutionResult> {
  const filePath = String(input.file_path ?? '');
  const oldString = String(input.old_string ?? '');
  const newString = String(input.new_string ?? '');
  const replaceAll = Boolean(input.replace_all ?? false);

  if (!filePath) {
    throw new Error('Edit requires input.file_path');
  }

  const absolutePath = resolveWithinCwd(cwd, filePath);
  let original = '';
  try {
    original = await fs.readFile(absolutePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  let nextContent = original;
  if (!original && oldString === '') {
    nextContent = newString;
  } else if (replaceAll) {
    if (!original.includes(oldString)) {
      throw new Error('Edit could not find old_string in the target file');
    }
    nextContent = original.split(oldString).join(newString);
  } else {
    const firstIndex = original.indexOf(oldString);
    if (firstIndex === -1) {
      throw new Error('Edit could not find old_string in the target file');
    }
    const secondIndex = original.indexOf(oldString, firstIndex + oldString.length);
    if (secondIndex !== -1) {
      throw new Error('Edit found multiple matches. Use replace_all or provide more context.');
    }
    nextContent =
      original.slice(0, firstIndex) +
      newString +
      original.slice(firstIndex + oldString.length);
  }

  await fs.mkdir(dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, nextContent, 'utf8');

  const displayPath = toDisplayPath(cwd, absolutePath);
  return {
    summary: `Edited ${displayPath}`,
    metadata: {
      file_path: absolutePath,
      display_path: displayPath,
      replace_all: replaceAll,
      before: original,
      after: nextContent
    },
    changedFiles: [displayPath]
  };
}

async function executeGlob(
  cwd: string,
  input: Record<string, unknown>
): Promise<EngineToolExecutionResult> {
  const pattern = String(input.pattern ?? '');
  if (!pattern) {
    throw new Error('Glob requires input.pattern');
  }

  const files = await listFilesRecursive(cwd);
  const matcher = globToRegExp(pattern);
  const matches = files
    .map((file) => toDisplayPath(cwd, file))
    .filter((file) => matcher.test(file.replace(/\\/g, '/')))
    .sort();

  return {
    summary: `Glob matched ${matches.length} file(s)`,
    metadata: {
      pattern,
      matches
    }
  };
}

async function executeGrep(
  cwd: string,
  input: Record<string, unknown>
): Promise<EngineToolExecutionResult> {
  const rawPattern = String(input.pattern ?? '');
  let pattern = rawPattern;
  if (!pattern) {
    throw new Error('Grep requires input.pattern');
  }

  const glob = typeof input.glob === 'string' ? input.glob : '**/*';
  const outputMode = String(input.output_mode ?? 'files_with_matches');
  const maxMatches = positiveIntegerInput(
    input.max_matches,
    DEFAULT_GREP_MAX_MATCHES,
    MAX_GREP_MAX_MATCHES
  );
  const multiline = Boolean(input.multiline ?? false);
  let ignoreCase = Boolean(input.ignore_case ?? false);
  if (typeof input.case_sensitive === 'boolean') {
    ignoreCase = !input.case_sensitive;
  }
  if (pattern.startsWith('(?i)')) {
    ignoreCase = true;
    pattern = pattern.slice(4);
  }
  const matcher = globToRegExp(glob);
  const flags = `g${multiline ? 'm' : ''}${ignoreCase ? 'i' : ''}`;
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, flags);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      [
        `Invalid Grep regular expression: ${message}`,
        `pattern=${JSON.stringify(rawPattern)}`,
        'Use JavaScript-compatible regex syntax, remove unsupported inline flags such as (?i), or set ignore_case=true.'
      ].join(' ')
    );
  }

  const files = await listFilesRecursive(cwd);
  const matchingFiles = files.filter((file) =>
    matcher.test(toDisplayPath(cwd, file).replace(/\\/g, '/'))
  );

  const matches: Array<Record<string, unknown>> = [];
  const matchCountsByFile: Array<{ file: string; count: number }> = [];
  let totalMatchCount = 0;
  for (const file of matchingFiles) {
    const content = await fs.readFile(file, 'utf8');
    const displayPath = toDisplayPath(cwd, file);
    let fileMatchCount = 0;
    if (outputMode === 'content') {
      const lines = content.split('\n');
      lines.forEach((line, index) => {
        regex.lastIndex = 0;
        if (regex.test(line)) {
          totalMatchCount += 1;
          fileMatchCount += 1;
          if (matches.length < maxMatches) {
            matches.push({
              file: displayPath,
              line: index + 1,
              content: line
            });
          }
        }
      });
      if (fileMatchCount) {
        matchCountsByFile.push({
          file: displayPath,
          count: fileMatchCount
        });
      }
      continue;
    }

    regex.lastIndex = 0;
    if (regex.test(content)) {
      totalMatchCount += 1;
      fileMatchCount = 1;
      if (matches.length < maxMatches) {
        matches.push({
          file: displayPath
        });
      }
    }
    if (fileMatchCount) {
      matchCountsByFile.push({
        file: displayPath,
        count: fileMatchCount
      });
    }
  }

  const truncated = totalMatchCount > matches.length;
  const omittedMatchCount = Math.max(0, totalMatchCount - matches.length);

  return {
    summary: truncated
      ? `Grep matched ${totalMatchCount} result(s); returned ${matches.length} and omitted ${omittedMatchCount}. Refine the pattern, glob, or max_matches for more detail.`
      : `Grep matched ${totalMatchCount} result(s)`,
    metadata: {
      pattern,
      original_pattern: rawPattern,
      ignore_case: ignoreCase,
      glob,
      output_mode: outputMode,
      max_matches: maxMatches,
      total_match_count: totalMatchCount,
      returned_match_count: matches.length,
      omitted_match_count: omittedMatchCount,
      truncated,
      match_counts_by_file: matchCountsByFile,
      matches
    }
  };
}

async function executeWebFetch(input: Record<string, unknown>): Promise<EngineToolExecutionResult> {
  const url = String(input.url ?? '');
  if (!url) {
    throw new Error('WebFetch requires input.url');
  }

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'claude-oca-local-runtime/1.0'
    }
  });
  if (!response.ok) {
    throw new Error(`WebFetch failed with status ${response.status}`);
  }

  const html = await response.text();
  const content = stripHtml(html);

  return {
    summary: `Fetched ${url}`,
    metadata: {
      url,
      prompt: typeof input.prompt === 'string' ? input.prompt : null,
      content
    }
  };
}

async function executeWebSearch(input: Record<string, unknown>): Promise<EngineToolExecutionResult> {
  const query = String(input.query ?? '');
  if (!query) {
    throw new Error('WebSearch requires input.query');
  }

  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'claude-oca-local-runtime/1.0'
    }
  });
  if (!response.ok) {
    throw new Error(`WebSearch failed with status ${response.status}`);
  }

  const html = await response.text();
  const results = Array.from(
    html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi),
    (match) => ({
      url: match[1] ?? '',
      title: stripHtml(match[2] ?? '')
    })
  ).filter((result) => result.title && /^https?:/i.test(result.url));

  return {
    summary: `WebSearch returned ${results.length} result(s)`,
    metadata: {
      query,
      results
    }
  };
}

async function executeShell(
  cwd: string,
  toolName: 'Bash' | 'PowerShell',
  input: Record<string, unknown>
): Promise<EngineToolExecutionResult> {
  const command = String(input.command ?? '');
  if (!command) {
    throw new Error(`${toolName} requires input.command`);
  }

  const timeout = Number(input.timeout_ms ?? 30_000);
  const shell =
    toolName === 'PowerShell'
      ? 'powershell.exe'
      : process.platform === 'win32'
        ? 'bash.exe'
        : 'bash';
  const args =
    toolName === 'PowerShell'
      ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command]
      : ['-lc', command];

  const { stdout, stderr } = await execFile(shell, args, {
    cwd,
    timeout
  });

  return {
    summary: `Executed ${toolName} command`,
    metadata: {
      command,
      stdout,
      stderr
    }
  };
}

async function executeSkill(
  cwd: string,
  input: Record<string, unknown>
): Promise<EngineToolExecutionResult> {
  const command = String(input.command ?? '');
  if (!command) {
    throw new Error('Skill requires input.command');
  }

  const loaded = readSkill(cwd, command);
  if (!loaded) {
    return {
      summary: `Skill ${command} was not found`,
      metadata: {
        command,
        found: false
      }
    };
  }

  return {
    summary: `Loaded skill ${loaded.skill.name}`,
    metadata: {
      command,
      name: loaded.skill.name,
      description: loaded.skill.description,
      path: loaded.skill.path,
      content: loaded.content
    }
  };
}

async function executeAgent(input: Record<string, unknown>): Promise<EngineToolExecutionResult> {
  return {
    summary: 'Agent delegation is not wired into the local browser shell yet',
    metadata: {
      task: typeof input.task === 'string' ? input.task : null,
      implemented: false
    }
  };
}

export const executeLocalTool: EngineToolExecutor = async ({ toolName, input, cwd }) => {
  switch (toolName) {
    case 'Read':
      return executeRead(cwd, input);
    case 'Write':
      return executeWrite(cwd, input);
    case 'Edit':
      return executeEdit(cwd, input);
    case 'Glob':
      return executeGlob(cwd, input);
    case 'Grep':
      return executeGrep(cwd, input);
    case 'LogScan':
      return executeLogScan(cwd, input);
    case 'WebFetch':
      return executeWebFetch(input);
    case 'WebSearch':
      return executeWebSearch(input);
    case 'Bash':
      return executeShell(cwd, 'Bash', input);
    case 'PowerShell':
      return executeShell(cwd, 'PowerShell', input);
    case 'Skill':
      return executeSkill(cwd, input);
    case 'Agent':
      return executeAgent(input);
    case 'TodoWrite':
      return {
        summary: 'TodoWrite is handled by the engine session state',
        metadata: {
          delegatedToEngine: true
        }
      };
    default:
      throw new Error(`Unsupported tool: ${toolName}`);
  }
};
