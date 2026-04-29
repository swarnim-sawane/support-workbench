import type { EngineToolDescriptor } from './types.js';

export const BUILTIN_TOOL_CATALOG: EngineToolDescriptor[] = [
  {
    name: 'Bash',
    description: 'Execute Unix-style shell commands for terminal operations only.',
    source: 'builtin',
    requiresApproval: true,
    category: 'terminal',
    enabled: true,
    visibility: 'enabled',
    stability: 'stable'
  },
  {
    name: 'PowerShell',
    description: 'Execute PowerShell commands for terminal operations only.',
    source: 'builtin',
    requiresApproval: true,
    category: 'terminal',
    enabled: true,
    visibility: 'enabled',
    stability: 'stable'
  },
  {
    name: 'Read',
    description: 'Read a file from the local filesystem.',
    source: 'builtin',
    requiresApproval: false,
    category: 'filesystem',
    enabled: true,
    visibility: 'enabled',
    stability: 'stable'
  },
  {
    name: 'Write',
    description: 'Create or fully rewrite a file.',
    source: 'builtin',
    requiresApproval: true,
    category: 'filesystem',
    enabled: true,
    visibility: 'enabled',
    stability: 'stable'
  },
  {
    name: 'Edit',
    description: 'Modify an existing file by exact string replacement.',
    source: 'builtin',
    requiresApproval: true,
    category: 'filesystem',
    enabled: true,
    visibility: 'enabled',
    stability: 'stable'
  },
  {
    name: 'Glob',
    description: 'Find files by glob pattern.',
    source: 'builtin',
    requiresApproval: false,
    category: 'search',
    enabled: true,
    visibility: 'enabled',
    stability: 'stable'
  },
  {
    name: 'Grep',
    description: 'Search file contents with ripgrep-style semantics.',
    source: 'builtin',
    requiresApproval: false,
    category: 'search',
    enabled: true,
    visibility: 'enabled',
    stability: 'stable'
  },
  {
    name: 'WebFetch',
    description: 'Fetch and summarize the contents of a specific URL.',
    source: 'builtin',
    requiresApproval: false,
    category: 'web',
    enabled: true,
    visibility: 'enabled',
    stability: 'stable'
  },
  {
    name: 'WebSearch',
    description: 'Search the web for up-to-date information.',
    source: 'builtin',
    requiresApproval: false,
    category: 'web',
    enabled: true,
    visibility: 'enabled',
    stability: 'stable'
  },
  {
    name: 'Agent',
    description: 'Delegate bounded work to an agent when available.',
    source: 'builtin',
    requiresApproval: true,
    category: 'workflow',
    enabled: true,
    visibility: 'enabled',
    stability: 'stable'
  },
  {
    name: 'Skill',
    description: 'Execute an installed skill when relevant.',
    source: 'builtin',
    requiresApproval: true,
    category: 'workflow',
    enabled: true,
    visibility: 'enabled',
    stability: 'stable'
  },
  {
    name: 'TodoWrite',
    description: 'Update or append session tasks in the current coding plan.',
    source: 'builtin',
    requiresApproval: false,
    category: 'workflow',
    enabled: true,
    visibility: 'enabled',
    stability: 'stable'
  },
  {
    name: 'TaskOutput',
    description: 'Read the output and status of a background agent task.',
    source: 'builtin',
    requiresApproval: false,
    category: 'workflow',
    enabled: true,
    visibility: 'enabled',
    stability: 'stable'
  }
];

export function mergeToolCatalog(extraTools: EngineToolDescriptor[] = []): EngineToolDescriptor[] {
  const merged = new Map<string, EngineToolDescriptor>();

  for (const tool of [...BUILTIN_TOOL_CATALOG, ...extraTools]) {
    merged.set(tool.name, tool);
  }

  return [...merged.values()];
}
