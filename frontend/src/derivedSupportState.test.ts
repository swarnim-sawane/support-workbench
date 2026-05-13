import { describe, expect, it } from 'vitest';
import {
  deriveAttachmentGroups,
  deriveEvidenceCoverage,
  formatLogScanActivityTitle
} from './derivedSupportState';
import type { WorkbenchAttachment, WorkbenchSessionSnapshot } from './types';

describe('derived support state', () => {
  it('groups support logs by inferred type, node, and capture phase', () => {
    const attachments = [
      buildAttachment('att-old-access', 'vm1_access_old.log'),
      buildAttachment('att-new-access', 'vm1_access_new.log'),
      buildAttachment('att-catalina', 'vm2_catalina_new.log'),
      buildAttachment('att-readme', 'readme.txt')
    ];

    const result = deriveAttachmentGroups(attachments, ['att-new-access', 'att-catalina']);

    expect(result.totalFiles).toBe(4);
    expect(result.queuedFiles).toBe(2);
    expect(result.typeGroups.map((group) => `${group.label}:${group.count}`)).toEqual([
      'Access logs:2',
      'Catalina logs:1',
      'Unclassified:1'
    ]);
    expect(result.nodeGroups.map((group) => `${group.label}:${group.count}`)).toEqual([
      'vm1:2',
      'vm2:1',
      'Unknown node:1'
    ]);
    expect(result.captureGroups.map((group) => `${group.label}:${group.count}`)).toEqual([
      'New capture:2',
      'Old capture:1',
      'Unknown capture:1'
    ]);
  });

  it('derives concise evidence coverage from LogScan metadata', () => {
    const snapshot = buildSnapshot({
      toolActivity: [
        {
          requestId: 'req-logscan',
          toolUseId: 'tool-logscan',
          toolName: 'LogScan',
          source: 'builtin',
          status: 'completed',
          input: {
            file_paths: ['vm1_access_old.log', 'vm2_catalina_new.log']
          },
          summary:
            'LogScan scanned 2 file(s), 2103 line(s); found 17 error(s), 1 severe event(s), 2 HTTP 5xx, and 9 slow request(s).',
          metadata: {
            scanned_entire_files: true,
            returned_examples_are_capped: true,
            scanned_files: 2,
            totals: {
              lines: 2103,
              error: 17,
              warn: 42,
              severe: 1,
              http_5xx: 2,
              slow_requests: 9
            },
            cross_file: {
              shared_identifiers: [
                {
                  key: 'ECID',
                  value: 'abc',
                  count: 4,
                  files: ['vm1_access_old.log', 'vm2_catalina_new.log']
                }
              ]
            }
          }
        }
      ]
    });

    const coverage = deriveEvidenceCoverage(snapshot);

    expect(coverage.logScan).toMatchObject({
      scannedFiles: 2,
      scannedLines: 2103,
      errors: 17,
      warnings: 42,
      severe: 1,
      http5xx: 2,
      slowRequests: 9,
      sharedIdentifierCount: 1,
      examplesCapped: true
    });
    expect(formatLogScanActivityTitle(snapshot.toolActivity[0])).toBe('Scanned 2 logs, 2,103 lines');
  });

  it('surfaces recoverable failures as recovery state', () => {
    const snapshot = buildSnapshot({
      status: 'running',
      toolActivity: [
        {
          requestId: 'req-recovery',
          toolUseId: 'tool-recovery',
          toolName: 'LogScan',
          source: 'builtin',
          status: 'failed',
          input: {
            file_paths: ['vm1_access_old.log']
          },
          error: 'LogScan requires at least one matching file path or glob',
          recoverable: true,
          recoveryAttempt: 1,
          recoveryInstruction: 'Retry with exact uploaded file paths.'
        }
      ]
    });

    expect(deriveEvidenceCoverage(snapshot).recovery).toEqual({
      toolName: 'LogScan',
      instruction: 'Retry with exact uploaded file paths.',
      attempt: 1
    });
  });
});

function buildAttachment(id: string, originalName: string): WorkbenchAttachment {
  return {
    id,
    originalName,
    storedName: originalName,
    mediaType: 'text/plain',
    kind: 'text',
    localPath: `C:/repo/.claude-oca/uploads/session/${originalName}`,
    size: 128,
    promptVisibility: 'available',
    ocrStatus: 'unavailable',
    uploadedAt: '2026-04-24T00:00:00.000Z'
  };
}

function buildSnapshot(
  overrides: Partial<WorkbenchSessionSnapshot> = {}
): WorkbenchSessionSnapshot {
  return {
    sessionId: 'session-test',
    status: 'completed',
    messages: [],
    tasks: [],
    memory: {
      entries: []
    },
    history: {
      summaries: []
    },
    agents: [],
    pendingApprovals: [],
    progressActivity: [],
    toolActivity: [],
    workspace: {
      cwd: 'C:/repo',
      changedFiles: [],
      diffs: []
    },
    attachments: [],
    commands: [],
    session: {
      branch: 'main'
    },
    integrations: {
      skills: [],
      mcp: {
        available: false,
        servers: []
      },
      lsp: {
        available: false,
        note: 'Not configured'
      },
      jdMcp: {
        available: false,
        connected: false,
        tools: [],
        categories: [],
        toolDescriptors: []
      }
    },
    reports: {
      artifacts: []
    },
    skippedTools: [],
    reportSuggestion: null,
    ...overrides
  };
}
