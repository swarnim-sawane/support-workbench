import type { WorkbenchAttachment, WorkbenchIntegrationSnapshot } from './types';

export type JdMcpComposerAction = {
  label: string;
  toolName: string;
  description: string;
  attachmentIds: string[];
  primary: boolean;
  disabled: boolean;
  disabledReason?: string;
};

export type JdMcpComposerActions = {
  primary: JdMcpComposerAction[];
  advanced: JdMcpComposerAction[];
};

type WorkflowDefinition = {
  label: string;
  toolName: string;
  description: string;
  primary: boolean;
  matcher: (attachments: WorkbenchAttachment[]) => WorkbenchAttachment[];
};

export const JD_MCP_WORKFLOW_DEFINITIONS: WorkflowDefinition[] = [
  {
    label: 'Correlate HAR with logs',
    toolName: 'correlate_har_with_logs',
    description: 'Match HAR requests to ADF or WebLogic log evidence by ECID.',
    primary: true,
    matcher: (attachments) => takeFirstEach(attachments, isHarAttachment, isServerLogAttachment)
  },
  {
    label: 'Analyze HAR',
    toolName: 'analyze_har_file',
    description: 'Inspect browser timing, failed requests, cache issues, and Oracle product hints.',
    primary: true,
    matcher: (attachments) => takeFirst(attachments, isHarAttachment)
  },
  {
    label: 'Analyze access logs',
    toolName: 'analyze_access_logs',
    description: 'Review WebLogic or OHS access logs for errors, slow requests, and status patterns.',
    primary: true,
    matcher: (attachments) => takeFirst(attachments, isAccessLogAttachment)
  },
  {
    label: 'Analyze ADF diagnostic logs',
    toolName: 'analyze_adf_logs',
    description: 'Generate the full JD MCP ADF, Forms, or Reports ODL diagnostic review.',
    primary: true,
    matcher: (attachments) => takeFirst(attachments, isDiagnosticLogAttachment)
  },
  {
    label: 'Analyze thread dumps',
    toolName: 'analyze_thread_dumps',
    description: 'Check thread dumps or dump bundles for locks, stuck threads, and error clusters.',
    primary: true,
    matcher: (attachments) => takeFirst(attachments, isThreadDumpAttachment)
  },
  {
    label: 'Forms trace workflow',
    toolName: 'translate_forms_trace',
    description: 'Translate a Forms .trc file into an HTML trace report.',
    primary: true,
    matcher: (attachments) => takeFirst(attachments, isFormsTraceAttachment)
  },
  {
    label: 'Review Forms trace dumps',
    toolName: 'review_forms_traces',
    description: 'Analyze frmweb_dump_* files for Forms runtime errors and locations.',
    primary: false,
    matcher: (attachments) => takeFirst(attachments, isFormsDumpAttachment)
  },
  {
    label: 'Pre-scan text diagnostics',
    toolName: 'triage_text_diagnostics',
    description: 'Quickly classify unknown logs and choose the next analyzer.',
    primary: false,
    matcher: (attachments) => takeFirst(attachments, isLogLikeAttachment)
  },
  {
    label: 'Read/group ODL logs',
    toolName: 'read_logs',
    description: 'Group ODL logs by none, app, or ECID before deeper analysis.',
    primary: false,
    matcher: (attachments) => takeFirst(attachments, isDiagnosticLogAttachment)
  },
  {
    label: 'Analyze ADF performance logs',
    toolName: 'analyze_adf_perf',
    description: 'Build a request timing hierarchy from ADF diagnostics at CONFIG level.',
    primary: false,
    matcher: (attachments) => takeFirst(attachments, isDiagnosticLogAttachment)
  },
  {
    label: 'Analyze workspace',
    toolName: 'analyze_workspace',
    description: 'Inspect an extracted JDeveloper workspace or project bundle.',
    primary: false,
    matcher: (attachments) => takeFirst(attachments, isWorkspaceAttachment)
  },
  {
    label: 'Check HA compliance',
    toolName: 'check_ha_compliance',
    description: 'Check ADF clustering and high availability compliance.',
    primary: false,
    matcher: (attachments) => takeFirst(attachments, isWorkspaceAttachment)
  },
  {
    label: 'Analyze ADR incident',
    toolName: 'analyze_incident',
    description: 'Inspect an Oracle ADR incident folder.',
    primary: false,
    matcher: (attachments) => takeFirst(attachments, isIncidentAttachment)
  },
  {
    label: 'Analyze JVM Controller logs',
    toolName: 'analyze_jvm_logs',
    description: 'Review Oracle Forms JVM Controller logs.',
    primary: false,
    matcher: (attachments) => takeFirst(attachments, isLogLikeAttachment)
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

  const actions = JD_MCP_WORKFLOW_DEFINITIONS.map((definition) => {
    const descriptor = descriptors.get(definition.toolName);
    const matches = definition.matcher(candidates);
    const descriptorReason =
      descriptor && (descriptor.enabled === false || descriptor.visibility === 'unsupported')
        ? descriptor.reason ?? 'Tool is unavailable in this session.'
        : undefined;
    const disabledReason = descriptorReason
      ?? (!descriptor ? 'Tool is not present in the current JD MCP catalog.' : undefined)
      ?? (!matches.length ? 'Attach a matching diagnostic file first.' : undefined);

    return {
      label: definition.label,
      toolName: definition.toolName,
      description: definition.description,
      attachmentIds: matches.map((attachment) => attachment.id),
      primary: definition.primary,
      disabled: Boolean(disabledReason),
      disabledReason
    } satisfies JdMcpComposerAction;
  });

  return {
    primary: actions.filter(
      (action) =>
        action.primary &&
        action.disabledReason !== 'Tool is not present in the current JD MCP catalog.'
    ),
    advanced: actions.filter(
      (action) =>
        !action.primary &&
        action.disabledReason !== 'Tool is not present in the current JD MCP catalog.'
    )
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

function takeFirstEach(
  attachments: WorkbenchAttachment[],
  ...predicates: Array<(attachment: WorkbenchAttachment) => boolean>
): WorkbenchAttachment[] {
  const matches: WorkbenchAttachment[] = [];
  for (const predicate of predicates) {
    const match = attachments.find(
      (attachment) => predicate(attachment) && !matches.some((item) => item.id === attachment.id)
    );
    if (!match) {
      return [];
    }
    matches.push(match);
  }
  return matches;
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

function isHarAttachment(attachment: WorkbenchAttachment): boolean {
  return extension(attachment) === '.har';
}

function isAccessLogAttachment(attachment: WorkbenchAttachment): boolean {
  return /\baccess[^\\/]*\.(log|txt|out)/i.test(lookupText(attachment));
}

function isServerLogAttachment(attachment: WorkbenchAttachment): boolean {
  return isAccessLogAttachment(attachment) || isDiagnosticLogAttachment(attachment);
}

function isDiagnosticLogAttachment(attachment: WorkbenchAttachment): boolean {
  const text = lookupText(attachment);
  return (
    ['.log', '.out', '.txt'].includes(extension(attachment)) &&
    /(diagnostic|defaultserver|server|adf|weblogic|wls|ohs|forms|reports|catalina)/i.test(text)
  );
}

function isLogLikeAttachment(attachment: WorkbenchAttachment): boolean {
  return ['.log', '.out', '.txt'].includes(extension(attachment));
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
