import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { JD_MCP_TOOL_META, jdMcpToolRequiresJava } from './jdMcpToolDefinitions.js';
import { applyToolSchemaDefaults } from './toolSchema.js';

type WorkerRequest = {
  action: 'status' | 'execute';
  root: string;
  toolName?: string;
  input?: Record<string, unknown>;
};

type RegisteredTool = {
  name: string;
  description: string;
  schema: unknown;
  handler: (input: Record<string, unknown>) => Promise<{
    content?: Array<{ type?: string; text?: string }>;
  }>;
};

class FakeMcpServer {
  readonly tools = new Map<string, RegisteredTool>();

  tool(
    name: string,
    description: string,
    schema: unknown,
    handler: RegisteredTool['handler']
  ): void {
    this.tools.set(name, {
      name,
      description,
      schema,
      handler
    });
  }
}

function jdMcpModuleUrl(root: string, pathFromRoot: string): URL {
  return pathToFileURL(resolve(root, pathFromRoot));
}

function buildStubConfig() {
  return {
    javaExe: process.env.JDTOOLS_JAVA ?? '',
    toolsDir: process.env.JDTOOLS_DIR ?? '',
    formsHome: process.env.FORMS_HOME
  };
}

async function registerTools(root: string, config = buildStubConfig()): Promise<FakeMcpServer> {
  const registryModule = await import(jdMcpModuleUrl(root, 'src/tools/registry.ts').href);
  const server = new FakeMcpServer();
  registryModule.registerAllTools(server, config);
  return server;
}

async function loadConfig(root: string) {
  const configModule = await import(jdMcpModuleUrl(root, 'src/config.ts').href);
  return configModule.loadConfig();
}

function collectToolCatalog(server: FakeMcpServer) {
  const toolNames = [...server.tools.keys()].filter((toolName) => JD_MCP_TOOL_META[toolName]);
  const categories = [...new Set(toolNames.map((toolName) => JD_MCP_TOOL_META[toolName].category))];

  return {
    tools: toolNames,
    categories
  };
}

async function main(): Promise<void> {
  const request = JSON.parse(process.argv[2] ?? '{}') as WorkerRequest;
  const root = request.root ? resolve(request.root) : '';

  if (!root || !existsSync(root)) {
    process.stdout.write(
      JSON.stringify({
        ok: false,
        status: 'unavailable',
        note: `Specialized tools root not found: ${root || '(missing)'}`,
        tools: [],
        categories: []
      })
    );
    return;
  }

  if (request.action === 'status') {
    const catalogServer = await registerTools(root);
    const catalog = collectToolCatalog(catalogServer);

    try {
      await loadConfig(root);
      process.stdout.write(
        JSON.stringify({
          ok: true,
          status: 'connected',
          note: 'Specialized tool handlers are available.',
          ...catalog
        })
      );
      return;
    } catch (error) {
      process.stdout.write(
        JSON.stringify({
          ok: false,
          status: 'available',
          note: error instanceof Error ? error.message : String(error),
          ...catalog
        })
      );
      return;
    }
  }

  if (!request.toolName) {
    throw new Error('toolName is required for execute');
  }

  const catalogServer = await registerTools(root);
  if (!catalogServer.tools.has(request.toolName)) {
    throw new Error(`Unknown specialized tool: ${request.toolName}`);
  }

  if (!JD_MCP_TOOL_META[request.toolName]) {
    throw new Error(`Unsupported specialized tool: ${request.toolName}`);
  }

  const server = jdMcpToolRequiresJava(request.toolName)
    ? await registerTools(root, await loadConfig(root))
    : catalogServer;
  const tool = server.tools.get(request.toolName);
  if (!tool) {
    throw new Error(`Unknown specialized tool: ${request.toolName}`);
  }

  const response = await tool.handler(applyToolSchemaDefaults(tool.schema, request.input ?? {}));
  const text = response.content?.find((entry) => entry.type === 'text')?.text ?? '';

  process.stdout.write(
    JSON.stringify({
      ok: true,
      toolName: request.toolName,
      text
    })
  );
}

void main().catch((error) => {
  process.stdout.write(
    JSON.stringify({
      ok: false,
      status: 'unavailable',
      note: error instanceof Error ? error.message : String(error),
      tools: [],
      categories: []
    })
  );
  process.exitCode = 1;
});
