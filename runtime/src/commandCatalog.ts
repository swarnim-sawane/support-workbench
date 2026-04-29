import type { EngineCommandInfo } from './types.js';

export const COMMAND_CATALOG: EngineCommandInfo[] = [
  {
    name: '/commands',
    description: 'List the local Claude Code-style slash commands available in the browser shell.',
    category: 'workflow'
  },
  {
    name: '/tasks',
    description: 'Manage Todo-style task tracking for the current session.',
    category: 'workflow'
  },
  {
    name: '/memory',
    description: 'Inspect or append persistent local memory notes for the current session.',
    category: 'memory'
  },
  {
    name: '/compact',
    description: 'Condense the current session into a local summary for later turns and resume.',
    category: 'workflow'
  },
  {
    name: '/report',
    description: 'Force the jd-mcp diagnostic report path for the current attachment set when available.',
    category: 'workflow'
  },
  {
    name: '/session',
    description: 'Show current session metadata, counts, and runtime state.',
    category: 'inspection'
  },
  {
    name: '/diff',
    description: 'Show tracked workspace diffs for files changed through the runtime.',
    category: 'inspection'
  },
  {
    name: '/skills',
    description: 'List locally discovered skills that the Skill tool can load.',
    category: 'integration'
  },
  {
    name: '/config',
    description: 'Inspect the local runtime configuration and integration status.',
    category: 'config'
  }
];
