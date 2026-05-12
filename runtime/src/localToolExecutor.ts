import { execFile as execFileCallback } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { readSkill } from './skills.js';
import type { EngineToolExecutor, EngineToolExecutionResult } from './types.js';

const execFile = promisify(execFileCallback);
const DEFAULT_GREP_MAX_MATCHES = 500;
const MAX_GREP_MAX_MATCHES = 2_000;

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
