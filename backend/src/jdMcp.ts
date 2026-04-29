import { execFile as execFileCallback } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
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
    return `jd-mcp root does not exist: ${root}`;
  }
  return 'JD_MCP_ROOT is not configured and no sibling jd-mcp checkout was found.';
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

export function normalizeJdMcpToolInput(
  toolName: string,
  input: Record<string, unknown>
): Record<string, unknown> {
  const next = { ...input };
  const legacyInput = typeof next.input === 'string' && next.input.trim() ? next.input : undefined;

  if (toolName === 'read_logs') {
    const logFolder = typeof next.log_folder === 'string' && next.log_folder.trim()
      ? next.log_folder
      : legacyInput;
    if (logFolder) {
      next.log_folder = normalizeFolderPath(logFolder);
      delete next.input;
    }
  }

  if (toolName === 'analyze_adf_logs') {
    const logFolder = typeof next.log_folder === 'string' && next.log_folder.trim()
      ? next.log_folder
      : legacyInput;
    if (logFolder) {
      next.log_folder = normalizeFolderPath(logFolder);
      delete next.input;
    }
  }

  if (toolName === 'triage_text_diagnostics' && legacyInput && typeof next.input_path !== 'string') {
    next.input_path = resolve(legacyInput);
    delete next.input;
  }

  return next;
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
    return `Generated ${artifacts.length} jd-mcp HTML report artifact${artifacts.length === 1 ? '' : 's'}`;
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

  return rawText.trim().slice(0, 240) || `${toolName} completed through jd-mcp`;
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
        note: `JD_MCP_ROOT does not exist: ${root}`,
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
        ? 'jd-mcp root configured or auto-detected. Run /api/health/jd-mcp to verify connectivity.'
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
      throw new Error(tool?.reason ?? `jd-mcp tool is unavailable: ${args.toolName}`);
    }

    const response = await this.invoke({
      action: 'execute',
      root,
      toolName: args.toolName,
      input: normalizeJdMcpToolInput(args.toolName, args.input)
    });
    if (!response.ok) {
      throw new Error(response.note ?? `jd-mcp tool failed: ${args.toolName}`);
    }

    const parsed = parsePayload(response.text ?? '');
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
        reason = 'This jd-mcp tool is not available from the current registry.';
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
      throw new Error('jd-mcp worker returned no output');
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
