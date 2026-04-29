import type { WorkbenchCommandInfo } from './types';

export const DIAGNOSTIC_COMMANDS: WorkbenchCommandInfo[] = [
  {
    name: '/auto-triage',
    description: 'Use the current source or attach one, then run the right diagnostics end to end.',
    category: 'workflow'
  },
  {
    name: '/adf-logs',
    description: 'Analyze an ADF or ODL log folder without composing the prompt manually.',
    category: 'workflow'
  },
  {
    name: '/adf-performance',
    description: 'Build a timing view from request and server logs for slow-page diagnosis.',
    category: 'workflow'
  },
  {
    name: '/jdbc-leaks',
    description: 'Trace connection pool starvation and blocked database handles from captured dumps.',
    category: 'workflow'
  },
  {
    name: '/thread-dumps',
    description: 'Inspect thread dump files for deadlocks, hotspots, and waiting chains.',
    category: 'workflow'
  },
  {
    name: '/jbo-activity',
    description: 'Replay JBO session activity to surface SQL, entity, and transaction issues.',
    category: 'workflow'
  },
  {
    name: '/workspace',
    description: 'Inspect a JDeveloper workspace or .jws file with a guided source picker.',
    category: 'workflow'
  },
  {
    name: '/incident-folder',
    description: 'Process an ADR incident folder or extracted package without hand-editing the prompt.',
    category: 'workflow'
  },
  {
    name: '/forms-logs',
    description: 'Analyze Oracle Forms log folders with a direct guided workflow.',
    category: 'workflow'
  },
  {
    name: '/jvm-controller-logs',
    description: 'Inspect Forms JVM controller events and request transitions.',
    category: 'workflow'
  },
  {
    name: '/forms-traces',
    description: 'Review Forms crash dumps and trace files from a selected file source.',
    category: 'workflow'
  },
  {
    name: '/translate-forms-trace',
    description: 'Convert a Forms .trc file into a readable report without prompt setup.',
    category: 'workflow'
  },
  {
    name: '/reports-logs',
    description: 'Analyze Oracle Reports logs directly from a chosen folder source.',
    category: 'workflow'
  },
  {
    name: '/har-file',
    description: 'Analyze a HAR capture from an uploaded file or pasted file path.',
    category: 'workflow'
  },
  {
    name: '/correlate-har-logs',
    description: 'Attach a HAR plus server logs, then run correlation when both sources are ready.',
    category: 'workflow'
  },
  {
    name: '/compare',
    description: 'Set two sources explicitly, then send a complete compare prompt in one step.',
    category: 'workflow'
  }
];

export function mergeCommandCatalog(commands: WorkbenchCommandInfo[]): WorkbenchCommandInfo[] {
  const merged = new Map<string, WorkbenchCommandInfo>();
  for (const command of [...commands, ...DIAGNOSTIC_COMMANDS]) {
    merged.set(command.name, command);
  }
  return [...merged.values()];
}
