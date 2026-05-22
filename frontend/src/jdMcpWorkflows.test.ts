import { describe, expect, it } from 'vitest';
import {
  buildJdMcpComposerActions,
  getJdMcpToolStatus,
  type JdMcpComposerAction
} from './jdMcpWorkflows';
import type { WorkbenchAttachment, WorkbenchIntegrationSnapshot } from './types';

describe('jdMcpWorkflows', () => {
  it('shows stable enabled report tools with matching queued attachments in the main picker', () => {
    const actions = buildJdMcpComposerActions({
      jdMcp: buildJdMcpSnapshot([
        enabledTool('analyze_access_logs'),
        enabledTool('analyze_adf_logs'),
        enabledTool('translate_forms_trace'),
        enabledTool('analyze_thread_dumps'),
        enabledTool('analyze_har_file', { producesReports: false }),
        enabledTool('analyze_jvm_logs', { stability: 'experimental' })
      ]),
      attachments: [
        attachment('att-har', 'checkout.har'),
        attachment('att-access', 'access.log'),
        attachment('att-adf', 'DefaultServer-diagnostic.log'),
        attachment('att-trace', 'forms.trc'),
        attachment('att-dump', 'thread-dump.dmp')
      ],
      queuedAttachmentIds: ['att-har', 'att-access', 'att-adf', 'att-trace', 'att-dump']
    });

    expect(actionNames(actions.available)).toEqual([
      'Access logs',
      'ADF diagnostic logs',
      'Thread dumps',
      'Forms trace HTML'
    ]);
    expect(actionToolNames(actions.available)).not.toContain('analyze_har_file');
    expect(actionToolNames(actions.available)).not.toContain('analyze_jvm_logs');
    expect(actions.available.find((action) => action.toolName === 'analyze_access_logs')).toMatchObject({
      attachmentIds: ['att-access'],
      disabled: false
    });
  });

  it('selects all matching queued files for folder-based log reports', () => {
    const actions = buildJdMcpComposerActions({
      jdMcp: buildJdMcpSnapshot([
        enabledTool('analyze_access_logs'),
        enabledTool('analyze_adf_logs')
      ]),
      attachments: [
        attachment('att-access-1', 'vm1_access.log'),
        attachment('att-access-2', 'vm2_access.log'),
        attachment('att-adf-1', 'vm1-diagnostic.log'),
        attachment('att-adf-2', 'vm2-diagnostic.log')
      ],
      queuedAttachmentIds: ['att-access-1', 'att-access-2', 'att-adf-1', 'att-adf-2']
    });

    expect(actions.available.find((action) => action.toolName === 'analyze_access_logs')).toMatchObject({
      attachmentIds: ['att-access-1', 'att-access-2']
    });
    expect(actions.available.find((action) => action.toolName === 'analyze_adf_logs')).toMatchObject({
      attachmentIds: ['att-adf-1', 'att-adf-2']
    });
  });

  it('keeps unavailable tools behind unavailable details with descriptor reasons', () => {
    const actions = buildJdMcpComposerActions({
      jdMcp: buildJdMcpSnapshot([
        disabledTool('translate_forms_trace', 'FORMS_HOME is not configured.')
      ]),
      attachments: [attachment('att-trace', 'forms.trc')],
      queuedAttachmentIds: ['att-trace']
    });

    expect(actions.available).toEqual([]);
    expect(actions.unavailable).toContainEqual(
      expect.objectContaining({
        label: 'Forms trace HTML',
        toolName: 'translate_forms_trace',
        disabled: true,
        disabledReason: 'FORMS_HOME is not configured.'
      })
    );
    const formsAction = actions.unavailable.find((action) => action.toolName === 'translate_forms_trace');
    expect(getJdMcpToolStatus(formsAction as JdMcpComposerAction)).toContain('FORMS_HOME');
  });

  it('uses available attachments before files are explicitly added to chat', () => {
    const actions = buildJdMcpComposerActions({
      jdMcp: buildJdMcpSnapshot([
        enabledTool('analyze_access_logs')
      ]),
      attachments: [attachment('att-access', 'access.log')],
      queuedAttachmentIds: []
    });

    expect(actions.available).toEqual([
      expect.objectContaining({
        label: 'Access logs',
        toolName: 'analyze_access_logs',
        disabled: false,
        attachmentIds: ['att-access']
      })
    ]);
    expect(actions.unavailable).toEqual([]);
  });

  it('does not offer ADF report tools for plain catalina or Reports JVM logs', () => {
    const actions = buildJdMcpComposerActions({
      jdMcp: buildJdMcpSnapshot([
        enabledTool('analyze_adf_logs'),
        enabledTool('read_logs'),
        enabledTool('analyze_adf_perf'),
        enabledTool('analyze_view_expired')
      ]),
      attachments: [
        attachment('att-catalina', 'AVBCS-41519_vm1_catalina.log'),
        attachment('att-reports-jvm', '4-0002802986_2026-05-18T08-46-49-repojvm_node7.log')
      ],
      queuedAttachmentIds: ['att-catalina', 'att-reports-jvm']
    });

    expect(actionToolNames(actions.available)).not.toContain('analyze_adf_logs');
    expect(actionToolNames(actions.available)).not.toContain('read_logs');
    expect(actionToolNames(actions.available)).not.toContain('analyze_adf_perf');
    expect(actionToolNames(actions.available)).not.toContain('analyze_view_expired');
    expect(actions.unavailable).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolName: 'analyze_adf_logs',
          disabledReason: 'Attach a matching diagnostic file first.'
        })
      ])
    );
  });
});

function actionNames(actions: JdMcpComposerAction[]): string[] {
  return actions.map((action) => action.label);
}

function actionToolNames(actions: JdMcpComposerAction[]): string[] {
  return actions.map((action) => action.toolName);
}

function attachment(id: string, originalName: string): WorkbenchAttachment {
  return {
    id,
    originalName,
    storedName: originalName,
    mediaType: 'text/plain',
    kind: 'text',
    localPath: `C:/repo/uploads/${originalName}`,
    size: 128,
    promptVisibility: 'available',
    ocrStatus: 'unavailable',
    uploadedAt: '2026-05-14T00:00:00.000Z'
  };
}

function buildJdMcpSnapshot(
  toolDescriptors: WorkbenchIntegrationSnapshot['jdMcp']['toolDescriptors']
): WorkbenchIntegrationSnapshot['jdMcp'] {
  return {
    available: toolDescriptors.length > 0,
    connected: toolDescriptors.some((tool) => tool.visibility === 'enabled'),
    note: 'jd-mcp test catalog',
    tools: toolDescriptors.filter((tool) => tool.visibility === 'enabled').map((tool) => tool.name),
    categories: ['diagnostics', 'reports'],
    toolDescriptors
  };
}

function enabledTool(
  name: string,
  options: Partial<WorkbenchIntegrationSnapshot['jdMcp']['toolDescriptors'][number]> = {}
): WorkbenchIntegrationSnapshot['jdMcp']['toolDescriptors'][number] {
  return {
    name,
    description: `${name} description`,
    source: 'jd-mcp',
    requiresApproval: true,
    category: 'diagnostics',
    producesReports: true,
    enabled: true,
    visibility: 'enabled',
    stability: 'stable',
    ...options
  };
}

function disabledTool(
  name: string,
  reason: string
): WorkbenchIntegrationSnapshot['jdMcp']['toolDescriptors'][number] {
  return {
    ...enabledTool(name),
    enabled: false,
    visibility: 'unsupported',
    reason
  };
}
