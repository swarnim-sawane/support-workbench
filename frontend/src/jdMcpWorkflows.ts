import type { WorkbenchAttachment, WorkbenchIntegrationSnapshot } from './types';

export type JdMcpComposerAction = {
  label: string;
  toolName: string;
  description: string;
  group: JdMcpWorkflowGroup;
  attachmentIds: string[];
  disabled: boolean;
  disabledReason?: string;
  producesReports: boolean;
  requiresApproval: boolean;
};

export type JdMcpComposerActions = {
  available: JdMcpComposerAction[];
  unavailable: JdMcpComposerAction[];
};

export type JdMcpWorkflowGroup =
  | 'Logs'
  | 'ADF'
  | 'Forms/Reports'
  | 'Dumps'
  | 'Workspace/Incident';

type WorkflowDefinition = {
  label: string;
  toolName: string;
  description: string;
  group: JdMcpWorkflowGroup;
  matcher: (attachments: WorkbenchAttachment[]) => WorkbenchAttachment[];
};

export const JD_MCP_WORKFLOW_DEFINITIONS: WorkflowDefinition[] = [
  {
    label: 'Access logs',
    toolName: 'analyze_access_logs',
    description: 'Review WebLogic or OHS access logs for errors, slow requests, and status patterns.',
    group: 'Logs',
    matcher: (attachments) => takeAll(attachments, isAccessLogAttachment)
  },
  {
    label: 'ADF diagnostic logs',
    toolName: 'analyze_adf_logs',
    description: 'Generate the full ADF, Forms, or Reports ODL diagnostic review.',
    group: 'ADF',
    matcher: (attachments) => takeAll(attachments, isDiagnosticLogAttachment)
  },
  {
    label: 'Thread dumps',
    toolName: 'analyze_thread_dumps',
    description: 'Check thread dumps or dump bundles for locks, stuck threads, and error clusters.',
    group: 'Dumps',
    matcher: (attachments) => takeFirst(attachments, isThreadDumpAttachment)
  },
  {
    label: 'Forms trace HTML',
    toolName: 'translate_forms_trace',
    description: 'Translate a Forms .trc file into an HTML trace report.',
    group: 'Forms/Reports',
    matcher: (attachments) => takeFirst(attachments, isFormsTraceAttachment)
  },
  {
    label: 'Forms trace dumps',
    toolName: 'review_forms_traces',
    description: 'Analyze frmweb_dump_* files for Forms runtime errors and locations.',
    group: 'Forms/Reports',
    matcher: (attachments) => takeFirst(attachments, isFormsDumpAttachment)
  },
  {
    label: 'ODL grouped logs',
    toolName: 'read_logs',
    description: 'Group ODL logs by none, app, or ECID before deeper analysis.',
    group: 'Logs',
    matcher: (attachments) => takeAll(attachments, isDiagnosticLogAttachment)
  },
  {
    label: 'ADF performance logs',
    toolName: 'analyze_adf_perf',
    description: 'Build a request timing hierarchy from ADF diagnostics at CONFIG level.',
    group: 'ADF',
    matcher: (attachments) => takeAll(attachments, isDiagnosticLogAttachment)
  },
  {
    label: 'JBO activity',
    toolName: 'review_jbo_activity',
    description: 'Generate a JBO and ADF BC activity report from diagnostic logs.',
    group: 'ADF',
    matcher: (attachments) => takeFirst(attachments, isDiagnosticLogAttachment)
  },
  {
    label: 'JDeveloper workspace',
    toolName: 'analyze_workspace',
    description: 'Inspect an extracted JDeveloper workspace or project bundle.',
    group: 'Workspace/Incident',
    matcher: (attachments) => takeFirst(attachments, isWorkspaceAttachment)
  },
  {
    label: 'ADR incident folder',
    toolName: 'analyze_incident',
    description: 'Inspect an Oracle ADR incident folder.',
    group: 'Workspace/Incident',
    matcher: (attachments) => takeFirst(attachments, isIncidentAttachment)
  },
  {
    label: 'JDBC leak dump',
    toolName: 'analyze_jdbc_leaks',
    description: 'Analyze JDBC profiling dumps to identify connection leak causes.',
    group: 'ADF',
    matcher: (attachments) => takeFirst(attachments, isJdbcLeakAttachment)
  },
  {
    label: 'ViewExpired logs',
    toolName: 'analyze_view_expired',
    description: 'Analyze ViewExpired exceptions from ADF logs.',
    group: 'ADF',
    matcher: (attachments) => takeAll(attachments, isDiagnosticLogAttachment)
  }
];

export function buildJdMcpComposerActions(input: {
  jdMcp: WorkbenchIntegrationSnapshot['jdMcp'];
  attachments: WorkbenchAttachment[];
  queuedAttachmentIds: string[];
}): JdMcpComposerActions {
  const availableAttachments = input.attachments.filter(
    (attachment) => attachment.promptVisibility === 'available'
  );
  const queued = availableAttachments.filter((attachment) =>
    input.queuedAttachmentIds.includes(attachment.id)
  );
  const candidates = queued.length ? queued : availableAttachments;
  const descriptors = new Map(input.jdMcp.toolDescriptors.map((tool) => [tool.name, tool]));

  const actions = JD_MCP_WORKFLOW_DEFINITIONS.flatMap((definition) => {
    const descriptor = descriptors.get(definition.toolName);
    if (
      !descriptor ||
      descriptor.producesReports !== true ||
      descriptor.stability !== 'stable' ||
      descriptor.visibility === 'hidden'
    ) {
      return [];
    }

    const matches = definition.matcher(candidates);
    const descriptorReason =
      descriptor && (descriptor.enabled === false || descriptor.visibility === 'unsupported')
        ? descriptor.reason ?? 'Tool is unavailable in this session.'
        : undefined;
    const disabledReason = descriptorReason
      ?? (!matches.length ? 'Attach a matching diagnostic file first.' : undefined);

    const action: JdMcpComposerAction = {
      label: definition.label,
      toolName: definition.toolName,
      description: definition.description,
      group: definition.group,
      attachmentIds: matches.map((attachment) => attachment.id),
      disabled: Boolean(disabledReason),
      disabledReason,
      producesReports: descriptor.producesReports === true,
      requiresApproval: descriptor.requiresApproval
    };

    return [action];
  });

  return {
    available: actions.filter((action) => !action.disabled),
    unavailable: actions.filter((action) => action.disabled)
  };
}

export function getJdMcpToolStatus(action: JdMcpComposerAction): string {
  if (action.disabled) {
    return action.disabledReason ?? 'Unavailable';
  }
  return `${action.attachmentIds.length} ${action.attachmentIds.length === 1 ? 'file' : 'files'} selected`;
}

export function friendlyJdMcpStatus(jdMcp: WorkbenchIntegrationSnapshot['jdMcp']): string {
  if (jdMcp.connected) {
    return 'Connected';
  }
  if (jdMcp.available) {
    return 'Partially configured';
  }
  return 'Unavailable';
}

function takeFirst(
  attachments: WorkbenchAttachment[],
  predicate: (attachment: WorkbenchAttachment) => boolean
): WorkbenchAttachment[] {
  const match = attachments.find(predicate);
  return match ? [match] : [];
}

function takeAll(
  attachments: WorkbenchAttachment[],
  predicate: (attachment: WorkbenchAttachment) => boolean
): WorkbenchAttachment[] {
  return attachments.filter(predicate);
}

function lookupText(attachment: WorkbenchAttachment): string {
  return [
    attachment.originalName,
    attachment.storedName,
    attachment.sourceArchive?.relativePath ?? ''
  ].join(' ').toLowerCase();
}

function extension(attachment: WorkbenchAttachment): string {
  const match = attachment.originalName.toLowerCase().match(/\.[^.\\/]+$/);
  return match?.[0] ?? '';
}

function isAccessLogAttachment(attachment: WorkbenchAttachment): boolean {
  return /(^|[_\-.])access[^\\/]*\.(log|txt|out)/i.test(lookupText(attachment));
}

function isDiagnosticLogAttachment(attachment: WorkbenchAttachment): boolean {
  const text = lookupText(attachment);
  if (/(^|[_\-.])(access|catalina|repojvm|jvm|gc|thread|javacore)([_\-.]|$)/i.test(text)) {
    return false;
  }
  return (
    ['.log', '.out', '.txt'].includes(extension(attachment)) &&
    /(^|[_\-.])(diagnostic|odl)([_\-.]|$)|defaultserver-diagnostic|adf-diagnostic|wls-diagnostic/i.test(text)
  );
}

function isThreadDumpAttachment(attachment: WorkbenchAttachment): boolean {
  return (
    ['.dmp', '.dump', '.tdump', '.zip'].includes(extension(attachment)) ||
    /(thread|javacore|threaddump|thread-dump)/i.test(lookupText(attachment))
  );
}

function isFormsTraceAttachment(attachment: WorkbenchAttachment): boolean {
  return extension(attachment) === '.trc';
}

function isFormsDumpAttachment(attachment: WorkbenchAttachment): boolean {
  return /frmweb_dump_/i.test(lookupText(attachment));
}

function isWorkspaceAttachment(attachment: WorkbenchAttachment): boolean {
  return /(workspace|jdeveloper|\.jws|\.jpr|model|viewcontroller|\.ear)/i.test(lookupText(attachment));
}

function isIncidentAttachment(attachment: WorkbenchAttachment): boolean {
  return /(incident|adr|diag)/i.test(lookupText(attachment));
}

function isJdbcLeakAttachment(attachment: WorkbenchAttachment): boolean {
  return /(jdbc|leak|connection|profile)/i.test(lookupText(attachment));
}
