import { describe, expect, it } from 'vitest';
import {
  buildJdMcpComposerActions,
  getJdMcpToolStatus,
  type JdMcpComposerAction
} from './jdMcpWorkflows';
import type { WorkbenchAttachment, WorkbenchIntegrationSnapshot } from './types';

describe('jdMcpWorkflows', () => {
  it('suggests primary composer actions from queued diagnostic attachments', () => {
    const actions = buildJdMcpComposerActions({
      jdMcp: buildJdMcpSnapshot([
        enabledTool('analyze_har_file'),
        enabledTool('correlate_har_with_logs'),
        enabledTool('analyze_access_logs'),
        enabledTool('translate_forms_trace'),
        enabledTool('analyze_thread_dumps')
      ]),
      attachments: [
        attachment('att-har', 'checkout.har'),
        attachment('att-access', 'access.log'),
        attachment('att-trace', 'forms.trc'),
        attachment('att-dump', 'thread-dump.dmp')
      ],
      queuedAttachmentIds: ['att-har', 'att-access', 'att-trace', 'att-dump']
    });

    expect(actionNames(actions.primary)).toEqual([
      'Correlate HAR with logs',
      'Analyze HAR',
      'Analyze access logs',
      'Analyze thread dumps',
      'Forms trace workflow'
    ]);
    expect(actions.primary.find((action) => action.toolName === 'correlate_har_with_logs')).toMatchObject({
      attachmentIds: ['att-har', 'att-access'],
      disabled: false
    });
  });

  it('marks unavailable tools with descriptor reasons instead of hiding them', () => {
    const actions = buildJdMcpComposerActions({
      jdMcp: buildJdMcpSnapshot([
        enabledTool('analyze_har_file'),
        disabledTool('translate_forms_trace', 'FORMS_HOME is not configured.')
      ]),
      attachments: [attachment('att-trace', 'forms.trc')],
      queuedAttachmentIds: ['att-trace']
    });

    expect(actions.primary).toContainEqual(
      expect.objectContaining({
        label: 'Forms trace workflow',
        toolName: 'translate_forms_trace',
        disabled: true,
        disabledReason: 'FORMS_HOME is not configured.'
      })
    );
    const formsAction = actions.primary.find((action) => action.toolName === 'translate_forms_trace');
    expect(getJdMcpToolStatus(formsAction as JdMcpComposerAction)).toContain('FORMS_HOME');
  });

  it('keeps primary composer actions discoverable before matching files are queued', () => {
    const actions = buildJdMcpComposerActions({
      jdMcp: buildJdMcpSnapshot([
        enabledTool('analyze_har_file'),
        enabledTool('analyze_access_logs')
      ]),
      attachments: [],
      queuedAttachmentIds: []
    });

    expect(actions.primary).toEqual([
      expect.objectContaining({
        label: 'Analyze HAR',
        toolName: 'analyze_har_file',
        disabled: true,
        disabledReason: 'Attach a matching diagnostic file first.'
      }),
      expect.objectContaining({
        label: 'Analyze access logs',
        toolName: 'analyze_access_logs',
        disabled: true,
        disabledReason: 'Attach a matching diagnostic file first.'
      })
    ]);
  });
});

function actionNames(actions: JdMcpComposerAction[]): string[] {
  return actions.map((action) => action.label);
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

function enabledTool(name: string): WorkbenchIntegrationSnapshot['jdMcp']['toolDescriptors'][number] {
  return {
    name,
    description: `${name} description`,
    source: 'jd-mcp',
    requiresApproval: true,
    category: 'diagnostics',
    producesReports: false,
    enabled: true,
    visibility: 'enabled',
    stability: 'stable'
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
