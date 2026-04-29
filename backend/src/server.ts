import {
  buildDefaultIntegrationSnapshot,
  createEngine,
  executeLocalTool,
  OcaModelProvider
} from '@claude-oca/runtime';
import { createWorkbenchApp } from './app.js';
import { loadLocalEnv } from './env.js';
import { JdMcpBridge } from './jdMcp.js';

loadLocalEnv();

const provider = new OcaModelProvider();
const jdMcpBridge = new JdMcpBridge();
const engine = createEngine({
  provider,
  executeTool: async (args) =>
    jdMcpBridge.hasTool(args.toolName)
      ? jdMcpBridge.executeTool({
          toolName: args.toolName,
          input: args.input,
          sessionId: args.sessionId
        })
      : executeLocalTool(args),
  toolCatalog: jdMcpBridge.toolCatalog,
  getIntegrationSnapshot: (cwd, toolCatalog) =>
    jdMcpBridge.toIntegrationSnapshot(buildDefaultIntegrationSnapshot(cwd, toolCatalog))
});
const app = createWorkbenchApp({
  engine,
  jdMcpHealth: () => jdMcpBridge.getHealth()
});
const port = Number(process.env.PORT ?? 4317);

app.listen(port, () => {
  process.stdout.write(`Claude OCA backend listening on http://localhost:${port}\n`);
});
