export type JdMcpToolDefinition = {
  name: string;
  description: string;
  category: string;
  producesReports: boolean;
  stability: 'stable' | 'flaky' | 'experimental';
  requiresJava: boolean;
  requiresFormsHome?: boolean;
};

export const JD_MCP_TOOL_DEFINITIONS: JdMcpToolDefinition[] = [
  {
    name: 'analyze_adf_logs',
    description: 'Full analysis of ODL diagnostic logs for ADF, Forms, or Oracle Reports apps.',
    category: 'reports',
    producesReports: true,
    stability: 'stable',
    requiresJava: true
  },
  {
    name: 'read_logs',
    description: 'Generic ODL log analyzer with application and ECID grouping support.',
    category: 'reports',
    producesReports: true,
    stability: 'stable',
    requiresJava: true
  },
  {
    name: 'analyze_thread_dumps',
    description: 'Analyze thread dumps from a folder or ZIP files and generate a jd-mcp HTML report.',
    category: 'reports',
    producesReports: true,
    stability: 'stable',
    requiresJava: true
  },
  {
    name: 'check_ha_compliance',
    description: 'Check ADF application HA and clustering compliance.',
    category: 'diagnostics',
    producesReports: false,
    stability: 'stable',
    requiresJava: true
  },
  {
    name: 'analyze_workspace',
    description: 'Analyze a JDeveloper workspace and report structure, libraries, and known issues.',
    category: 'reports',
    producesReports: true,
    stability: 'stable',
    requiresJava: true
  },
  {
    name: 'review_jbo_activity',
    description: 'Review JBO and ADF BC activity with per-session HTML reports.',
    category: 'reports',
    producesReports: true,
    stability: 'stable',
    requiresJava: true
  },
  {
    name: 'extract_db_scripts',
    description: 'Extract approximate CREATE and ALTER SQL from ADF model entities.',
    category: 'diagnostics',
    producesReports: false,
    stability: 'stable',
    requiresJava: true
  },
  {
    name: 'analyze_access_logs',
    description: 'Analyze WebLogic or Oracle HTTP Server access logs.',
    category: 'reports',
    producesReports: true,
    stability: 'stable',
    requiresJava: true
  },
  {
    name: 'analyze_har_file',
    description: 'Analyze a HAR file for performance issues, HTTP errors, and Oracle product signatures.',
    category: 'diagnostics',
    producesReports: false,
    stability: 'stable',
    requiresJava: false
  },
  {
    name: 'correlate_har_with_logs',
    description: 'Correlate a HAR file with ADF or WebLogic server logs using ECID values.',
    category: 'diagnostics',
    producesReports: false,
    stability: 'stable',
    requiresJava: false
  },
  {
    name: 'translate_forms_trace',
    description: 'Translate an Oracle Forms .trc trace file into HTML.',
    category: 'reports',
    producesReports: true,
    stability: 'stable',
    requiresJava: true,
    requiresFormsHome: true
  },
  {
    name: 'analyze_view_expired',
    description: 'Analyze ViewExpired exceptions from ADF logs.',
    category: 'reports',
    producesReports: true,
    stability: 'stable',
    requiresJava: true
  },
  {
    name: 'analyze_jdbc_leaks',
    description: 'Analyze JDBC profiling dumps to identify connection leak causes.',
    category: 'reports',
    producesReports: true,
    stability: 'stable',
    requiresJava: true
  },
  {
    name: 'analyze_adf_perf',
    description: 'Analyze ADF diagnostic performance logs with a request timing hierarchy.',
    category: 'reports',
    producesReports: true,
    stability: 'stable',
    requiresJava: true
  },
  {
    name: 'analyze_incident',
    description: 'Analyze Oracle ADR incident folders with combined incident, log, and thread diagnostics.',
    category: 'reports',
    producesReports: true,
    stability: 'stable',
    requiresJava: true
  },
  {
    name: 'review_forms_traces',
    description: 'Analyze Oracle Forms frmweb_dump trace files and report error locations.',
    category: 'reports',
    producesReports: true,
    stability: 'stable',
    requiresJava: true
  },
  {
    name: 'analyze_jvm_logs',
    description: 'Analyze JVM Controller log files from Oracle Forms environments.',
    category: 'reports',
    producesReports: true,
    stability: 'experimental',
    requiresJava: true
  },
  {
    name: 'triage_text_diagnostics',
    description: 'Quickly triage text logs and recommend the next specialized analyzer.',
    category: 'diagnostics',
    producesReports: false,
    stability: 'stable',
    requiresJava: false
  },
  {
    name: 'list_directory',
    description: 'List a diagnostic directory tree before selecting a specialized analyzer.',
    category: 'helpers',
    producesReports: false,
    stability: 'stable',
    requiresJava: false
  },
  {
    name: 'read_file_text',
    description: 'Read bounded text from logs, configs, XML, JSON, and other diagnostic files.',
    category: 'helpers',
    producesReports: false,
    stability: 'stable',
    requiresJava: false
  }
];

export const JD_MCP_TOOL_META: Record<string, JdMcpToolDefinition> = Object.fromEntries(
  JD_MCP_TOOL_DEFINITIONS.map((tool) => [tool.name, tool])
);

export function jdMcpToolRequiresJava(toolName: string): boolean {
  return JD_MCP_TOOL_META[toolName]?.requiresJava !== false;
}
