import { describe, expect, it } from 'vitest';
import { formatLogScanActivityTitle, parseLogScanMetadata } from './derivedSupportState';
import type { WorkbenchToolActivity } from './types';

describe('derived support state', () => {
  it('formats concise LogScan coverage from metadata', () => {
    const activity = buildLogScanActivity({
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
    });

    expect(parseLogScanMetadata(activity.metadata)).toMatchObject({
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
    expect(formatLogScanActivityTitle(activity)).toBe('Scanned 2 logs, 2,103 lines');
  });

  it('falls back to input path counts when LogScan metadata has no coverage totals', () => {
    expect(
      formatLogScanActivityTitle(
        buildLogScanActivity({
          input: {
            file_paths: ['access.log', 'catalina.log', 'forms.log']
          }
        })
      )
    ).toBe('Scanned 3 logs');

    expect(
      formatLogScanActivityTitle(
        buildLogScanActivity({
          input: {
            file_path: 'access.log'
          }
        })
      )
    ).toBe('Scanned 1 log');
  });

  it('uses actionable labels for active and failed LogScan activity', () => {
    expect(formatLogScanActivityTitle(buildLogScanActivity({ status: 'running' }))).toBe(
      'Scanning uploaded logs'
    );
    expect(formatLogScanActivityTitle(buildLogScanActivity({ status: 'pending' }))).toBe('Queued log scan');
    expect(formatLogScanActivityTitle(buildLogScanActivity({ status: 'failed', recoverable: true }))).toBe(
      'Recovering from LogScan error'
    );
    expect(formatLogScanActivityTitle(buildLogScanActivity({ status: 'failed', recoverable: false }))).toBe(
      'LogScan failed'
    );
  });
});

function buildLogScanActivity(overrides: Partial<WorkbenchToolActivity> = {}): WorkbenchToolActivity {
  return {
    requestId: 'req-logscan',
    toolUseId: 'tool-logscan',
    toolName: 'LogScan',
    source: 'builtin',
    status: 'completed',
    input: {},
    ...overrides
  } as WorkbenchToolActivity;
}
