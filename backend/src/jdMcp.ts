import { execFile as execFileCallback } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync
} from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type {
  EngineIntegrationSnapshot,
  EngineReportArtifact,
  EngineToolDescriptor,
  EngineToolExecutionResult
} from '@claude-oca/runtime';
import { parseDotEnv } from './env.js';
import { JD_MCP_TOOL_DEFINITIONS } from './jdMcpToolDefinitions.js';

const execFile = promisify(execFileCallback);

const FOLDER_ANALYZER_TOOLS = new Set([
  'read_logs',
  'analyze_adf_logs',
  'analyze_access_logs',
  'analyze_adf_perf',
  'analyze_view_expired'
]);
const FILTERABLE_FOLDER_ANALYZER_TOOLS = new Set([
  'read_logs',
  'analyze_adf_logs',
  'analyze_access_logs',
  'analyze_adf_perf',
  'analyze_view_expired'
]);

type JdMcpWorkerResponse = {
  ok: boolean;
  status?: 'connected' | 'available' | 'unavailable';
  note?: string;
  tools?: string[];
  categories?: string[];
  text?: string;
};

type ExecFileFailure = Error & {
  stdout?: string | Buffer;
  stderr?: string | Buffer;
};

export type JdMcpHealth = {
  ok: boolean;
  provider: 'jd-mcp';
  model: null;
  status: 'connected' | 'available' | 'unavailable';
  note?: string;
  tools: string[];
  categories: string[];
  toolDescriptors: EngineToolDescriptor[];
  root: string | null;
};

function repoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
}

function workerPath(): string {
  return resolve(repoRoot(), 'backend', 'src', 'jdMcpWorker.ts');
}

function tsxCliPath(): string {
  return resolve(repoRoot(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
}

function autoDetectedJdMcpRoot(): string | null {
  const siblingRoot = resolve(repoRoot(), '..', 'jd-mcp');
  return existsSync(siblingRoot) ? siblingRoot : null;
}

function resolveJdMcpRoot(): string | null {
  const root = process.env.JD_MCP_ROOT?.trim();
  return root ? resolve(root) : autoDetectedJdMcpRoot();
}

function missingRootReason(root: string | null): string {
  if (root) {
    return `Specialized tools root does not exist: ${root}`;
  }
  return 'Specialized tools root is not configured and no sibling specialized tools checkout was found.';
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.map(nonEmpty).find(Boolean);
}

function resolveConfigPath(root: string | null, value: string | undefined): string | undefined {
  const resolved = nonEmpty(value);
  if (!resolved) {
    return undefined;
  }
  return root && !isAbsolute(resolved) ? resolve(root, resolved) : resolved;
}

function loadJdMcpDotEnv(root: string | null): Record<string, string> {
  if (!root) {
    return {};
  }

  const envPath = resolve(root, '.env');
  if (!existsSync(envPath)) {
    return {};
  }

  return parseDotEnv(readFileSync(envPath, 'utf8'));
}

function resolveJdMcpProcessEnv(root: string | null = resolveJdMcpRoot()): {
  env: NodeJS.ProcessEnv;
  javaExe?: string;
  toolsDir?: string;
  formsHome?: string;
} {
  const rootEnv = loadJdMcpDotEnv(root);
  const javaExe = resolveConfigPath(
    root,
    firstNonEmpty(process.env.JD_MCP_JDTOOLS_JAVA, process.env.JDTOOLS_JAVA, rootEnv.JDTOOLS_JAVA)
  );
  const toolsDir = resolveConfigPath(
    root,
    firstNonEmpty(process.env.JD_MCP_JDTOOLS_DIR, process.env.JDTOOLS_DIR, rootEnv.JDTOOLS_DIR)
  );
  const formsHome = resolveConfigPath(
    root,
    firstNonEmpty(process.env.JD_MCP_FORMS_HOME, process.env.FORMS_HOME, rootEnv.FORMS_HOME)
  );
  const harAnalyzerApiUrl = firstNonEmpty(process.env.HAR_ANALYZER_API_URL, rootEnv.HAR_ANALYZER_API_URL);
  const harAnalyzerUiUrl = firstNonEmpty(process.env.HAR_ANALYZER_UI_URL, rootEnv.HAR_ANALYZER_UI_URL);

  return {
    env: {
      ...rootEnv,
      ...process.env,
      ...(javaExe ? { JDTOOLS_JAVA: javaExe } : {}),
      ...(toolsDir ? { JDTOOLS_DIR: toolsDir } : {}),
      ...(formsHome ? { FORMS_HOME: formsHome } : {}),
      ...(harAnalyzerApiUrl ? { HAR_ANALYZER_API_URL: harAnalyzerApiUrl } : {}),
      ...(harAnalyzerUiUrl ? { HAR_ANALYZER_UI_URL: harAnalyzerUiUrl } : {})
    },
    javaExe,
    toolsDir,
    formsHome
  };
}

function validateJavaPrerequisites(root: string | null): string | undefined {
  const { javaExe, toolsDir } = resolveJdMcpProcessEnv(root);

  if (!javaExe) {
    return 'JDTOOLS_JAVA is not configured.';
  }
  if (!existsSync(javaExe)) {
    return `java.exe not found: ${javaExe}`;
  }
  if (!toolsDir) {
    return 'JDTOOLS_DIR is not configured.';
  }

  const jdtoolsJar = join(toolsDir, 'jdtools.jar');
  if (!existsSync(jdtoolsJar)) {
    return `jdtools.jar not found in JDTOOLS_DIR: ${toolsDir}`;
  }

  return undefined;
}

function parsePayload(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function outputText(value: string | Buffer | undefined): string {
  if (typeof value === 'string') {
    return value;
  }
  return value?.toString('utf8') ?? '';
}

function normalizeFolderPath(pathValue: string): string {
  const resolved = resolve(pathValue);
  if (existsSync(resolved) && statSync(resolved).isFile()) {
    return dirname(resolved);
  }
  return resolved;
}

function isMissingPathInput(value: unknown): boolean {
  if (typeof value !== 'string') {
    return true;
  }

  const normalized = value.trim().toLowerCase();
  return !normalized || normalized === 'undefined' || normalized === 'null';
}

function inputPathArray(input: Record<string, unknown>): string[] {
  for (const key of ['file_paths', 'paths']) {
    const value = input[key];
    if (!Array.isArray(value)) {
      continue;
    }

    const paths = value
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .map((item) => resolve(item.trim()));
    if (paths.length) {
      return paths;
    }
  }

  const singlePath =
    typeof input.file_path === 'string' && input.file_path.trim()
      ? input.file_path.trim()
      : typeof input.path === 'string' && input.path.trim()
        ? input.path.trim()
        : undefined;
  return singlePath ? [resolve(singlePath)] : [];
}

function firstPathInput(input: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = input[key];
    if (!isMissingPathInput(value)) {
      return String(value).trim();
    }
  }
  return undefined;
}

function readFilePrefix(filePath: string, maxBytes = 64 * 1024): string {
  try {
    return readFileSync(filePath, 'utf8').slice(0, maxBytes);
  } catch {
    return '';
  }
}

function isAdfOdlDiagnosticFile(filePath: string): boolean {
  const name = basename(filePath).toLowerCase();
  const extension = extname(name);
  if (!['.log', '.out', '.txt'].includes(extension) && !name.includes('.log')) {
    return false;
  }
  if (/\b(access|catalina|repojvm|jvm|gc|thread|javacore)\b/.test(name)) {
    return false;
  }
  if (/(^|[-_.])diagnostic([-_.]|$)|odl/.test(name)) {
    return true;
  }

  const prefix = readFilePrefix(filePath).toLowerCase();
  return (
    /\[[^\]]+\]\s+\[[^\]]+\]\s+\[(?:incident_error|error|warning|notice|trace|debug)\]/.test(prefix) &&
    /\boracle\.|\bweblogic\.|\badf\b|\bjbo\b/.test(prefix)
  );
}

function isAccessLogFile(filePath: string): boolean {
  const name = basename(filePath).toLowerCase();
  return /(^|[_\-.])access[^\\/]*\.(log|txt|out)(?:\.\d+)?$/.test(name);
}

function isCompatibleAnalyzerFile(toolName: string, filePath: string): boolean {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    return false;
  }

  if (toolName === 'analyze_access_logs') {
    return isAccessLogFile(filePath);
  }

  if (
    toolName === 'analyze_adf_logs' ||
    toolName === 'read_logs' ||
    toolName === 'analyze_adf_perf' ||
    toolName === 'analyze_view_expired'
  ) {
    return isAdfOdlDiagnosticFile(filePath);
  }

  return true;
}

function incompatibleInputMessage(toolName: string): string {
  if (toolName === 'analyze_access_logs') {
    return 'No compatible access log files were found for analyze_access_logs.';
  }
  return `No compatible ADF diagnostic log files were found for ${toolName}. Use built-in LogScan for plain catalina, access, Reports JVM, or mixed enterprise logs.`;
}

function safeLinkOrCopy(source: string, destination: string): void {
  try {
    linkSync(source, destination);
  } catch {
    copyFileSync(source, destination);
  }
}

function createFilteredAnalyzerFolder(
  toolName: string,
  logFolder: string,
  selectedPaths: string[]
): string {
  const compatiblePaths = selectedPaths.filter((filePath) => isCompatibleAnalyzerFile(toolName, filePath));
  if (!compatiblePaths.length) {
    throw new Error(incompatibleInputMessage(toolName));
  }

  const stagingRoot = join(resolve(logFolder), '.specialized-tools');
  mkdirSync(stagingRoot, { recursive: true });
  const filteredFolder = mkdtempSync(join(stagingRoot, `${toolName}-`));
  const usedNames = new Map<string, number>();

  for (const source of compatiblePaths) {
    const originalName = basename(source);
    const seen = usedNames.get(originalName) ?? 0;
    usedNames.set(originalName, seen + 1);
    const stagedName = seen === 0 ? originalName : `${seen + 1}-${originalName}`;
    safeLinkOrCopy(source, join(filteredFolder, stagedName));
  }

  return filteredFolder;
}

function maybeFilterFolderAnalyzerInput(
  toolName: string,
  input: Record<string, unknown>
): Record<string, unknown> {
  if (!FILTERABLE_FOLDER_ANALYZER_TOOLS.has(toolName)) {
    return input;
  }

  const selectedPaths = inputPathArray(input);
  if (!selectedPaths.length) {
    return input;
  }

  const logFolder = !isMissingPathInput(input.log_folder)
    ? String(input.log_folder).trim()
    : dirname(selectedPaths[0]!);
  const filteredFolder = createFilteredAnalyzerFolder(toolName, logFolder, selectedPaths);
  const next: Record<string, unknown> = {
    ...input,
    log_folder: filteredFolder
  };
  delete next.file_paths;
  delete next.paths;
  delete next.file_path;
  delete next.path;
  return next;
}

export function normalizeJdMcpToolInput(
  toolName: string,
  input: Record<string, unknown>
): Record<string, unknown> {
  const next = { ...input };
  const legacyInput = typeof next.input === 'string' && next.input.trim() ? next.input : undefined;

  if (FOLDER_ANALYZER_TOOLS.has(toolName)) {
    const logFolder = !isMissingPathInput(next.log_folder)
      ? String(next.log_folder).trim()
      : !isMissingPathInput(legacyInput)
        ? legacyInput
        : undefined;
    if (logFolder) {
      next.log_folder = normalizeFolderPath(logFolder);
      delete next.input;
    }
  }

  if (toolName === 'triage_text_diagnostics' && legacyInput && typeof next.input_path !== 'string') {
    next.input_path = resolve(legacyInput);
    delete next.input;
  }

  if (toolName === 'analyze_har_file') {
    const harPath = firstPathInput(next, ['har_file_path', 'file_path', 'path', 'input_path', 'input']);
    if (harPath) {
      next.har_file_path = resolve(harPath);
      delete next.file_path;
      delete next.path;
      delete next.input_path;
      delete next.input;
    }
  }

  if (toolName === 'correlate_har_with_logs') {
    const harPath = firstPathInput(next, ['har_file_path', 'file_path', 'path', 'input_path', 'input']);
    if (harPath) {
      next.har_file_path = resolve(harPath);
      delete next.file_path;
      delete next.path;
      delete next.input_path;
      delete next.input;
    }
  }

  return maybeFilterFolderAnalyzerInput(toolName, next);
}

function validateJdMcpToolInput(toolName: string, input: Record<string, unknown>): void {
  if (toolName === 'analyze_har_file' || toolName === 'correlate_har_with_logs') {
    const attempted =
      typeof input.har_file_path === 'string' && input.har_file_path.trim()
        ? input.har_file_path.trim()
        : '(missing)';
    const resolved = typeof input.har_file_path === 'string' ? resolve(input.har_file_path) : null;
    if (
      isMissingPathInput(input.har_file_path) ||
      !resolved ||
      !existsSync(resolved) ||
      !statSync(resolved).isFile() ||
      extname(resolved).toLowerCase() !== '.har'
    ) {
      throw new Error(
        `${toolName} requires har_file_path to reference an existing .har file. Attempted har_file_path: ${attempted}`
      );
    }
  }

  if (!FOLDER_ANALYZER_TOOLS.has(toolName)) {
    return;
  }

  const attempted =
    typeof input.log_folder === 'string' && input.log_folder.trim()
      ? input.log_folder.trim()
      : '(missing)';
  const resolved = typeof input.log_folder === 'string' ? resolve(input.log_folder) : null;
  if (
    isMissingPathInput(input.log_folder) ||
    !resolved ||
    !existsSync(resolved) ||
    !statSync(resolved).isDirectory()
  ) {
    throw new Error(
      `${toolName} requires log_folder to reference an existing folder. Attempted log_folder: ${attempted}`
    );
  }
}

function extractReportArtifacts(
  parsed: Record<string, unknown> | null,
  sessionId: string,
  toolName: string
): EngineReportArtifact[] {
  if (!parsed) {
    return [];
  }

  const candidates = [
    ...(typeof parsed.report === 'string' ? [parsed.report] : []),
    ...(Array.isArray(parsed.reports)
      ? parsed.reports.filter((value): value is string => typeof value === 'string')
      : [])
  ]
    .map((filePath) => resolve(filePath))
    .filter((filePath) => filePath.toLowerCase().endsWith('.html'));

  return candidates.map((filePath, index) => ({
    id: `${toolName}-${index + 1}-${Buffer.from(filePath).toString('base64url').slice(0, 12)}`,
    sessionId,
    toolName,
    source: 'jd-mcp',
    kind: 'html-report',
    title: `${toolName} report ${index + 1}`,
    filePath,
    fileName: filePath.split(/[\\/]/).at(-1) ?? filePath,
    createdAt: new Date().toISOString(),
    size: existsSync(filePath) ? statSync(filePath).size : 0
  }));
}

function toSummary(
  toolName: string,
  parsed: Record<string, unknown> | null,
  rawText: string,
  artifacts: EngineReportArtifact[]
): string {
  if (artifacts.length) {
    return `Generated ${artifacts.length} specialized HTML report artifact${artifacts.length === 1 ? '' : 's'}`;
  }

  if (typeof parsed?.note === 'string' && parsed.note.trim()) {
    return parsed.note.trim();
  }

  if (typeof parsed?.stdout === 'string' && parsed.stdout.trim()) {
    return parsed.stdout.trim().slice(0, 240);
  }

  if (typeof parsed?.stderr === 'string' && parsed.stderr.trim()) {
    return parsed.stderr.trim().slice(0, 240);
  }

  return rawText.trim().slice(0, 240) || `${toolName} completed through specialized tools`;
}

function payloadFailureMessage(parsed: Record<string, unknown> | null): string | undefined {
  const exitCode = parsed?.exitCode;
  if (typeof exitCode !== 'number' || exitCode === 0) {
    return undefined;
  }

  const stderr = typeof parsed?.stderr === 'string' ? parsed.stderr.trim() : '';
  const note = typeof parsed?.note === 'string' ? parsed.note.trim() : '';
  const stdout = typeof parsed?.stdout === 'string' ? parsed.stdout.trim() : '';
  return stderr || note || stdout || `Specialized tool exited with code ${exitCode}`;
}

export class JdMcpBridge {
  private lastHealth: { at: number; value: JdMcpHealth } | null = null;

  get toolCatalog(): EngineToolDescriptor[] {
    return this.describeTools();
  }

  hasTool(toolName: string): boolean {
    return this.describeTools().some(
      (tool) => tool.name === toolName && tool.visibility === 'enabled' && tool.enabled !== false
    );
  }

  async getHealth(force = false): Promise<JdMcpHealth> {
    if (!force && this.lastHealth && Date.now() - this.lastHealth.at < 5_000) {
      return this.lastHealth.value;
    }

    const root = resolveJdMcpRoot();
    if (!root) {
      return this.cache(this.buildHealth({
        ok: false,
        status: 'unavailable',
        note: missingRootReason(root),
        root: null
      }));
    }

    if (!existsSync(root)) {
      return this.cache(this.buildHealth({
        ok: false,
        status: 'unavailable',
        note: `Specialized tools root does not exist: ${root}`,
        root
      }));
    }

    try {
      const response = await this.invoke({
        action: 'status',
        root
      });

      return this.cache(this.buildHealth({
        ok: response.ok,
        status: response.status ?? (response.ok ? 'connected' : 'available'),
        note: response.note,
        root,
        registeredTools: response.tools
      }));
    } catch (error) {
      return this.cache(this.buildHealth({
        ok: false,
        status: 'unavailable',
        note: error instanceof Error ? error.message : String(error),
        root
      }));
    }
  }

  currentHealth(): JdMcpHealth {
    if (this.lastHealth) {
      return this.lastHealth.value;
    }

    const root = resolveJdMcpRoot();
    return this.buildHealth({
      ok: false,
      status: root ? 'available' : 'unavailable',
      note: root
        ? 'Specialized tools root configured or auto-detected. Run the specialized tools health check to verify connectivity.'
        : missingRootReason(root),
      root
    });
  }

  toIntegrationSnapshot(base: EngineIntegrationSnapshot): EngineIntegrationSnapshot {
    const health = this.currentHealth();
    return {
      ...base,
      jdMcp: {
        available: health.status !== 'unavailable',
        connected: health.status === 'connected',
        note: health.note,
        tools: health.tools,
        categories: health.categories,
        toolDescriptors: health.toolDescriptors
      }
    };
  }

  async executeTool(args: {
    toolName: string;
    input: Record<string, unknown>;
    sessionId: string;
  }): Promise<EngineToolExecutionResult> {
    const root = resolveJdMcpRoot();
    if (!root) {
      throw new Error(missingRootReason(root));
    }

    const tool = this.describeTools().find((descriptor) => descriptor.name === args.toolName);
    if (!tool || tool.enabled === false || tool.visibility !== 'enabled') {
      throw new Error(tool?.reason ?? `Specialized tool is unavailable: ${args.toolName}`);
    }

    const normalizedInput = normalizeJdMcpToolInput(args.toolName, args.input);
    validateJdMcpToolInput(args.toolName, normalizedInput);

    const response = await this.invoke({
      action: 'execute',
      root,
      toolName: args.toolName,
      input: normalizedInput
    });
    if (!response.ok) {
      throw new Error(response.note ?? `Specialized tool failed: ${args.toolName}`);
    }

    const parsed = parsePayload(response.text ?? '');
    const failureMessage = payloadFailureMessage(parsed);
    if (failureMessage) {
      throw new Error(failureMessage);
    }

    const artifacts = extractReportArtifacts(parsed, args.sessionId, args.toolName);
    const summary = toSummary(args.toolName, parsed, response.text ?? '', artifacts);

    return {
      summary,
      source: 'jd-mcp',
      metadata: {
        provider: 'jd-mcp',
        parsed,
        rawText: response.text ?? '',
        status: response.status ?? 'connected',
        note: typeof parsed?.note === 'string' ? parsed.note : undefined,
        stdout: typeof parsed?.stdout === 'string' ? parsed.stdout : undefined,
        stderr: typeof parsed?.stderr === 'string' ? parsed.stderr : undefined
      },
      artifacts
    };
  }

  private describeTools(registeredTools?: string[]): EngineToolDescriptor[] {
    const root = resolveJdMcpRoot();
    const rootExists = Boolean(root && existsSync(root));
    const { formsHome } = resolveJdMcpProcessEnv(root);
    const javaPrerequisiteReason = rootExists ? validateJavaPrerequisites(root) : undefined;
    const formsHomeAvailable = Boolean(formsHome);

    return JD_MCP_TOOL_DEFINITIONS.map((tool) => {
      let enabled = rootExists;
      let visibility: EngineToolDescriptor['visibility'] = rootExists ? 'enabled' : 'unsupported';
      let reason: string | undefined = rootExists ? undefined : missingRootReason(root);

      if (registeredTools && !registeredTools.includes(tool.name)) {
        enabled = false;
        visibility = 'unsupported';
        reason = 'This specialized tool is not available from the current registry.';
      }

      if (enabled && tool.requiresJava && javaPrerequisiteReason) {
        enabled = false;
        visibility = 'unsupported';
        reason = javaPrerequisiteReason;
      }

      if (enabled && tool.requiresFormsHome && !formsHomeAvailable) {
        enabled = false;
        visibility = 'unsupported';
        reason = 'FORMS_HOME is not configured.';
      }

      return {
        name: tool.name,
        description: tool.description,
        source: 'jd-mcp',
        requiresApproval: true,
        category: tool.category,
        producesReports: tool.producesReports,
        enabled,
        visibility,
        stability: tool.stability,
        reason
      } satisfies EngineToolDescriptor;
    });
  }

  private buildHealth(input: {
    ok: boolean;
    status: 'connected' | 'available' | 'unavailable';
    note?: string;
    root: string | null;
    registeredTools?: string[];
  }): JdMcpHealth {
    const toolDescriptors = this.describeTools(input.registeredTools);
    const enabledTools = toolDescriptors.filter(
      (tool) => tool.visibility === 'enabled' && tool.enabled !== false
    );

    return {
      ok: input.ok,
      provider: 'jd-mcp',
      model: null,
      status: input.status,
      note: input.note,
      tools: enabledTools.map((tool) => tool.name),
      categories: [...new Set(enabledTools.map((tool) => tool.category).filter(Boolean))] as string[],
      toolDescriptors,
      root: input.root
    };
  }

  private parseWorkerOutput(stdout: string): JdMcpWorkerResponse {
    const lines = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const lastLine = lines.at(-1);
    if (!lastLine) {
      throw new Error('Specialized tools worker returned no output');
    }

    return JSON.parse(lastLine) as JdMcpWorkerResponse;
  }

  private async invoke(payload: Record<string, unknown>): Promise<JdMcpWorkerResponse> {
    const root = typeof payload.root === 'string' ? payload.root : resolveJdMcpRoot();
    const { env } = resolveJdMcpProcessEnv(root);
    try {
      const { stdout } = await execFile(process.execPath, [tsxCliPath(), workerPath(), JSON.stringify(payload)], {
        cwd: root && existsSync(root) ? root : repoRoot(),
        env,
        maxBuffer: 8 * 1024 * 1024
      });

      return this.parseWorkerOutput(stdout);
    } catch (error) {
      const failure = error as ExecFileFailure;
      const stdout = outputText(failure.stdout);
      if (stdout.trim()) {
        return this.parseWorkerOutput(stdout);
      }

      const stderr = outputText(failure.stderr).trim();
      throw new Error(stderr || failure.message);
    }
  }

  private cache(value: JdMcpHealth): JdMcpHealth {
    this.lastHealth = {
      at: Date.now(),
      value
    };
    return value;
  }
}
