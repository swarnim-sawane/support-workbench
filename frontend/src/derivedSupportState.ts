import type { WorkbenchToolActivity } from './types';

export type LogScanCoverage = {
  scannedFiles: number;
  scannedLines: number;
  errors: number;
  warnings: number;
  severe: number;
  http5xx: number;
  slowRequests: number;
  sharedIdentifierCount: number;
  examplesCapped: boolean;
};

const numberFormat = new Intl.NumberFormat('en-US');

export function formatLogScanActivityTitle(activity: WorkbenchToolActivity): string {
  if (activity.status === 'running') {
    return 'Scanning uploaded logs';
  }
  if (activity.status === 'pending') {
    return 'Queued log scan';
  }
  if (activity.status === 'failed') {
    return activity.recoverable ? 'Recovering from LogScan error' : 'LogScan failed';
  }

  const coverage = parseLogScanMetadata(activity.metadata);
  if (coverage?.scannedFiles && coverage.scannedLines) {
    return `Scanned ${coverage.scannedFiles} ${pluralize(coverage.scannedFiles, 'log')}, ${formatNumber(
      coverage.scannedLines
    )} lines`;
  }
  if (coverage?.scannedFiles) {
    return `Scanned ${coverage.scannedFiles} ${pluralize(coverage.scannedFiles, 'log')}`;
  }

  const inputCount = getInputPathCount(activity.input);
  if (inputCount) {
    return `Scanned ${inputCount} ${pluralize(inputCount, 'log')}`;
  }

  return 'Scanned uploaded logs';
}

function formatNumber(value: number): string {
  return numberFormat.format(value);
}

export function parseLogScanMetadata(metadata: Record<string, unknown> | undefined): LogScanCoverage | null {
  if (!metadata) {
    return null;
  }

  const totals = asRecord(metadata.totals);
  const crossFile = asRecord(metadata.cross_file);
  const sharedIdentifiers = Array.isArray(crossFile?.shared_identifiers)
    ? crossFile.shared_identifiers
    : [];

  const scannedFiles =
    toNumber(metadata.scanned_files) ?? toNumber(metadata.total_files) ?? getMetadataFileCount(metadata);
  const scannedLines = toNumber(totals?.lines) ?? 0;

  if (!scannedFiles && !scannedLines) {
    return null;
  }

  return {
    scannedFiles: scannedFiles ?? 0,
    scannedLines,
    errors: toNumber(totals?.error) ?? 0,
    warnings: toNumber(totals?.warn) ?? 0,
    severe: toNumber(totals?.severe) ?? 0,
    http5xx: toNumber(totals?.http_5xx) ?? 0,
    slowRequests: toNumber(totals?.slow_requests) ?? 0,
    sharedIdentifierCount: sharedIdentifiers.length,
    examplesCapped: metadata.returned_examples_are_capped === true
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function getMetadataFileCount(metadata: Record<string, unknown>): number | null {
  return Array.isArray(metadata.files) ? metadata.files.length : null;
}

function getInputPathCount(input: Record<string, unknown>): number | null {
  const candidates = [input.file_paths, input.paths];
  const arrayInput = candidates.find((value) => Array.isArray(value));
  if (Array.isArray(arrayInput)) {
    return arrayInput.length;
  }
  return typeof input.file_path === 'string' || typeof input.path === 'string' ? 1 : null;
}

function pluralize(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}
