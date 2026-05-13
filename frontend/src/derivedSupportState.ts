import type { WorkbenchAttachment, WorkbenchSessionSnapshot, WorkbenchToolActivity } from './types';

export type SupportEvidenceGroup = {
  key: string;
  label: string;
  count: number;
  queuedCount: number;
  examples: string[];
};

export type AttachmentGroupSummary = {
  totalFiles: number;
  queuedFiles: number;
  typeGroups: SupportEvidenceGroup[];
  nodeGroups: SupportEvidenceGroup[];
  captureGroups: SupportEvidenceGroup[];
};

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

export type EvidenceCoverageSummary = {
  logScan: LogScanCoverage | null;
  recovery: {
    toolName: string;
    instruction: string;
    attempt: number;
  } | null;
};

const numberFormat = new Intl.NumberFormat('en-US');
const TYPE_ORDER = ['access', 'vb-access', 'catalina', 'other-log', 'unclassified'];
const CAPTURE_ORDER = ['new', 'old', 'unknown'];

export function deriveAttachmentGroups(
  attachments: WorkbenchAttachment[],
  queuedAttachmentIds: string[] = []
): AttachmentGroupSummary {
  const available = attachments.filter((attachment) => attachment.promptVisibility === 'available');
  const queued = new Set(queuedAttachmentIds);

  return {
    totalFiles: available.length,
    queuedFiles: available.filter((attachment) => queued.has(attachment.id)).length,
    typeGroups: buildGroups(available, queued, inferLogType, TYPE_ORDER),
    nodeGroups: buildGroups(available, queued, inferNode).sort(sortUnknownLast),
    captureGroups: buildGroups(available, queued, inferCapture, CAPTURE_ORDER)
  };
}

export function deriveEvidenceCoverage(snapshot: WorkbenchSessionSnapshot): EvidenceCoverageSummary {
  const logScanActivity = snapshot.toolActivity.find(
    (activity) => activity.toolName === 'LogScan' && activity.status === 'completed'
  );
  const recoverableFailure = snapshot.toolActivity.find(
    (activity) => activity.status === 'failed' && activity.recoverable
  );

  return {
    logScan: logScanActivity ? parseLogScanMetadata(logScanActivity.metadata) : null,
    recovery:
      recoverableFailure && snapshot.status === 'running'
        ? {
            toolName: recoverableFailure.toolName,
            instruction:
              recoverableFailure.recoveryInstruction ??
              recoverableFailure.error ??
              'The runtime is retrying with safer inputs.',
            attempt: recoverableFailure.recoveryAttempt ?? 1
          }
        : null
  };
}

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

export function formatNumber(value: number): string {
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

function buildGroups(
  attachments: WorkbenchAttachment[],
  queued: Set<string>,
  infer: (attachment: WorkbenchAttachment) => { key: string; label: string },
  order?: string[]
): SupportEvidenceGroup[] {
  const groups = new Map<string, SupportEvidenceGroup>();

  for (const attachment of attachments) {
    const inferred = infer(attachment);
    const group = groups.get(inferred.key) ?? {
      key: inferred.key,
      label: inferred.label,
      count: 0,
      queuedCount: 0,
      examples: []
    };
    group.count += 1;
    if (queued.has(attachment.id)) {
      group.queuedCount += 1;
    }
    if (group.examples.length < 3) {
      group.examples.push(attachment.sourceArchive?.relativePath ?? attachment.originalName);
    }
    groups.set(inferred.key, group);
  }

  const values = [...groups.values()];
  if (!order) {
    return values;
  }

  return values.sort((left, right) => {
    const leftIndex = order.indexOf(left.key);
    const rightIndex = order.indexOf(right.key);
    return (leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex) -
      (rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex) ||
      right.count - left.count ||
      left.label.localeCompare(right.label);
  });
}

function inferLogType(attachment: WorkbenchAttachment): { key: string; label: string } {
  const name = attachmentEvidenceName(attachment);
  const normalized = name.toLowerCase();
  if (normalized.includes('vb_access') || (normalized.includes('vb') && normalized.includes('access'))) {
    return { key: 'vb-access', label: 'VB access logs' };
  }
  if (normalized.includes('access')) {
    return { key: 'access', label: 'Access logs' };
  }
  if (normalized.includes('catalina')) {
    return { key: 'catalina', label: 'Catalina logs' };
  }
  if (/\.log$/i.test(name)) {
    return { key: 'other-log', label: 'Other logs' };
  }
  return { key: 'unclassified', label: 'Unclassified' };
}

function inferNode(attachment: WorkbenchAttachment): { key: string; label: string } {
  const match = attachmentEvidenceName(attachment).match(
    /(?:^|[^a-z0-9])(vm|node)[_\-. ]?(\d+)(?=[^a-z0-9]|$)/i
  );
  if (!match) {
    return { key: 'unknown', label: 'Unknown node' };
  }
  const label = `${match[1].toLowerCase()}${match[2]}`;
  return { key: label, label };
}

function inferCapture(attachment: WorkbenchAttachment): { key: string; label: string } {
  const name = attachmentEvidenceName(attachment);
  if (/(^|[_\-. ])new([_\-. ]|$)/i.test(name)) {
    return { key: 'new', label: 'New capture' };
  }
  if (/(^|[_\-. ])old([_\-. ]|$)/i.test(name)) {
    return { key: 'old', label: 'Old capture' };
  }
  return { key: 'unknown', label: 'Unknown capture' };
}

function attachmentEvidenceName(attachment: WorkbenchAttachment): string {
  return `${attachment.originalName} ${attachment.sourceArchive?.relativePath ?? ''}`;
}

function sortUnknownLast(left: SupportEvidenceGroup, right: SupportEvidenceGroup): number {
  if (left.key === 'unknown' && right.key !== 'unknown') {
    return 1;
  }
  if (right.key === 'unknown' && left.key !== 'unknown') {
    return -1;
  }
  return left.label.localeCompare(right.label);
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
