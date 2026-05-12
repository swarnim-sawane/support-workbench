import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { JdMcpBridge, normalizeJdMcpToolInput } from '../src/jdMcp.js';

const ORIGINAL_ENV = {
  JD_MCP_ROOT: process.env.JD_MCP_ROOT,
  JD_MCP_JDTOOLS_JAVA: process.env.JD_MCP_JDTOOLS_JAVA,
  JD_MCP_JDTOOLS_DIR: process.env.JD_MCP_JDTOOLS_DIR,
  JD_MCP_FORMS_HOME: process.env.JD_MCP_FORMS_HOME,
  JDTOOLS_JAVA: process.env.JDTOOLS_JAVA,
  JDTOOLS_DIR: process.env.JDTOOLS_DIR,
  FORMS_HOME: process.env.FORMS_HOME,
  HAR_ANALYZER_API_URL: process.env.HAR_ANALYZER_API_URL,
  HAR_ANALYZER_UI_URL: process.env.HAR_ANALYZER_UI_URL
};

const EXPECTED_JD_MCP_TOOLS = [
  'analyze_adf_logs',
  'read_logs',
  'analyze_thread_dumps',
  'check_ha_compliance',
  'analyze_workspace',
  'review_jbo_activity',
  'extract_db_scripts',
  'analyze_access_logs',
  'analyze_har_file',
  'correlate_har_with_logs',
  'translate_forms_trace',
  'analyze_view_expired',
  'analyze_jdbc_leaks',
  'analyze_adf_perf',
  'analyze_incident',
  'review_forms_traces',
  'analyze_jvm_logs',
  'triage_text_diagnostics',
  'list_directory',
  'read_file_text'
];

const PURE_JS_TOOLS = [
  'analyze_har_file',
  'correlate_har_with_logs',
  'triage_text_diagnostics',
  'list_directory',
  'read_file_text'
];

function restoreEnv() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function clearJdMcpEnv() {
  delete process.env.JD_MCP_ROOT;
  delete process.env.JD_MCP_JDTOOLS_JAVA;
  delete process.env.JD_MCP_JDTOOLS_DIR;
  delete process.env.JD_MCP_FORMS_HOME;
  delete process.env.JDTOOLS_JAVA;
  delete process.env.JDTOOLS_DIR;
  delete process.env.FORMS_HOME;
  delete process.env.HAR_ANALYZER_API_URL;
  delete process.env.HAR_ANALYZER_UI_URL;
}

function configureFakeJdMcpRoot(options: { formsHome?: string } = {}) {
  clearJdMcpEnv();

  const root = mkdtempSync(join(tmpdir(), 'claude-oca-jd-mcp-'));
  const javaExe = join(root, 'java.exe');
  const toolsDir = join(root, 'jars');
  mkdirSync(toolsDir, { recursive: true });
  writeFileSync(javaExe, '');
  writeFileSync(join(toolsDir, 'jdtools.jar'), '');

  process.env.JD_MCP_ROOT = root;
  process.env.JDTOOLS_JAVA = javaExe;
  process.env.JDTOOLS_DIR = toolsDir;
  if (options.formsHome !== undefined) {
    process.env.FORMS_HOME = options.formsHome;
  }

  return { root, javaExe, toolsDir };
}

function workbenchRoot(): string {
  return basename(process.cwd()) === 'backend' ? resolve(process.cwd(), '..') : process.cwd();
}

function siblingJdMcpRoot(): string {
  return resolve(workbenchRoot(), '..', 'jd-mcp');
}

describe('JdMcpBridge', () => {
  afterEach(() => {
    restoreEnv();
  });

  it('exposes all registered jd-mcp tools and excludes unregistered files', () => {
    configureFakeJdMcpRoot();

    const bridge = new JdMcpBridge();
    const catalog = bridge.toolCatalog;

    expect(catalog.map((tool) => tool.name)).toEqual(EXPECTED_JD_MCP_TOOLS);
    expect(catalog.some((tool) => tool.name === 'fwca')).toBe(false);
    expect(catalog.some((tool) => tool.name === 'frmdmp')).toBe(false);
    expect(catalog.find((tool) => tool.name === 'translate_forms_trace')).toMatchObject({
      enabled: false,
      visibility: 'unsupported',
      reason: expect.stringContaining('FORMS_HOME')
    });
  });

  it('enables translate_forms_trace when Forms prerequisites are present', () => {
    configureFakeJdMcpRoot({ formsHome: 'C:/Oracle/Forms' });

    const bridge = new JdMcpBridge();

    expect(bridge.toolCatalog.find((tool) => tool.name === 'translate_forms_trace')).toMatchObject({
      enabled: true,
      visibility: 'enabled'
    });
  });

  it('keeps pure TypeScript jd-mcp tools enabled when Java prerequisites are missing', () => {
    clearJdMcpEnv();
    const root = mkdtempSync(join(tmpdir(), 'claude-oca-jd-mcp-no-java-'));
    process.env.JD_MCP_ROOT = root;

    const bridge = new JdMcpBridge();
    const catalog = bridge.toolCatalog;

    for (const toolName of PURE_JS_TOOLS) {
      expect(catalog.find((tool) => tool.name === toolName)).toMatchObject({
        enabled: true,
        visibility: 'enabled'
      });
    }
    expect(catalog.find((tool) => tool.name === 'analyze_adf_logs')).toMatchObject({
      enabled: false,
      visibility: 'unsupported',
      reason: expect.stringContaining('JDTOOLS_JAVA')
    });
  });

  it('normalizes legacy single-file log input for jdtools folder analyzers', () => {
    const root = mkdtempSync(join(tmpdir(), 'claude-oca-upload-'));
    const filePath = join(root, 'DefaultServer-diagnostic - ADF.log');
    writeFileSync(filePath, '[2026-04-25] test log');

    expect(normalizeJdMcpToolInput('read_logs', { input: filePath })).toEqual({
      log_folder: root
    });
    expect(normalizeJdMcpToolInput('analyze_adf_logs', { input: filePath })).toEqual({
      log_folder: root
    });
    expect(normalizeJdMcpToolInput('triage_text_diagnostics', { input: filePath })).toEqual({
      input_path: filePath
    });
  });

  it('treats non-zero jd-mcp payload exit codes as failed tool executions', async () => {
    configureFakeJdMcpRoot();

    const bridge = new JdMcpBridge();
    (bridge as unknown as {
      invoke: () => Promise<{
        ok: boolean;
        status: 'connected';
        text: string;
      }>;
    }).invoke = async () => ({
      ok: true,
      status: 'connected',
      text: JSON.stringify({
        exitCode: 1,
        reports: [],
        selectedInputPattern: '*.log*',
        matchedInputCount: 1,
        stderr:
          'Exception in thread "main" java.lang.NullPointerException: Cannot invoke "oracle.jtech.la.LogMessage.setMsg(String)" because "logM" is null'
      })
    });

    await expect(
      bridge.executeTool({
        toolName: 'analyze_adf_logs',
        input: {
          log_folder: 'C:/logs'
        },
        cwd: process.cwd(),
        sessionId: 'session-with-bad-log'
      })
    ).rejects.toThrow('Cannot invoke "oracle.jtech.la.LogMessage.setMsg(String)"');
  });

  it.skipIf(!existsSync(siblingJdMcpRoot()))(
    'auto-detects the sibling jd-mcp checkout when JD_MCP_ROOT is unset',
    () => {
      clearJdMcpEnv();

      const bridge = new JdMcpBridge();

      expect(bridge.currentHealth().root).toBe(siblingJdMcpRoot());
    }
  );

  it.skipIf(!existsSync(siblingJdMcpRoot()))(
    'loads the sibling jd-mcp .env fallback and reports connected when jdtools prerequisites exist',
    async () => {
      clearJdMcpEnv();

      const bridge = new JdMcpBridge();
      const health = await bridge.getHealth(true);

      expect(health.root).toBe(siblingJdMcpRoot());
      expect(health.status).toBe('connected');
      expect(health.toolDescriptors.map((tool) => tool.name)).toEqual(EXPECTED_JD_MCP_TOOLS);
      expect(health.tools).toEqual(expect.arrayContaining(PURE_JS_TOOLS));
      expect(health.tools).toContain('analyze_adf_logs');
      expect(health.tools).not.toContain('translate_forms_trace');
    },
    20_000
  );
});
