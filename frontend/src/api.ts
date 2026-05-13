import type {
  PendingApproval,
  WorkbenchAttachment,
  WorkbenchHealth,
  WorkbenchSessionSummary,
  WorkbenchSessionSnapshot,
  WorkbenchUploadProgressUpdate
} from './types';

type SessionResponse = {
  session: {
    id: string;
    cwd: string;
    status: WorkbenchSessionSnapshot['status'];
  };
  snapshot: WorkbenchSessionSnapshot;
};

type CreateSessionInput = {
  cwd?: string;
  sessionId?: string;
};

type SnapshotResponse = {
  snapshot: WorkbenchSessionSnapshot;
};

type AttachmentResponse = SnapshotResponse & {
  attachments: WorkbenchAttachment[];
};

type SessionsResponse = {
  sessions: WorkbenchSessionSummary[];
};

type UploadProgressCallback = (progress: WorkbenchUploadProgressUpdate) => void;

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(typeof payload.error === 'string' ? payload.error : response.statusText);
  }

  return (await response.json()) as T;
}

export async function createSession(input: CreateSessionInput = {}): Promise<SessionResponse> {
  const response = await fetch('/api/session', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(input)
  });

  return readJson<SessionResponse>(response);
}

export async function fetchSessions(cwd?: string): Promise<WorkbenchSessionSummary[]> {
  const params = cwd ? `?cwd=${encodeURIComponent(cwd)}` : '';
  const response = await fetch(`/api/sessions${params}`);
  const payload = await readJson<SessionsResponse>(response);
  return payload.sessions;
}

export async function deleteSession(sessionId: string, cwd?: string): Promise<void> {
  const params = cwd ? `?cwd=${encodeURIComponent(cwd)}` : '';
  const response = await fetch(`/api/session/${sessionId}${params}`, {
    method: 'DELETE'
  });
  await readJson<{ accepted: boolean }>(response);
}

export async function submitPrompt(
  sessionId: string,
  prompt: string,
  attachmentIds: string[] = []
): Promise<SnapshotResponse> {
  const response = await fetch(`/api/session/${sessionId}/prompt`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ prompt, attachmentIds })
  });

  return readJson<SnapshotResponse>(response);
}

export async function uploadAttachments(
  sessionId: string,
  files: File[],
  onProgress?: UploadProgressCallback
): Promise<AttachmentResponse> {
  const formData = new FormData();
  for (const file of files) {
    formData.append('files', file);
  }

  if (typeof XMLHttpRequest === 'undefined') {
    const response = await fetch(`/api/session/${sessionId}/attachments`, {
      method: 'POST',
      body: formData
    });
    onProgress?.({
      phase: 'processing',
      loaded: totalFileBytes(files),
      total: totalFileBytes(files),
      percent: 100
    });

    return readJson<AttachmentResponse>(response);
  }

  return uploadAttachmentsWithProgress(sessionId, formData, files, onProgress);
}

function uploadAttachmentsWithProgress(
  sessionId: string,
  formData: FormData,
  files: File[],
  onProgress?: UploadProgressCallback
): Promise<AttachmentResponse> {
  const totalBytes = totalFileBytes(files);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let uploadCompleteReported = false;

    function reportProgress(phase: WorkbenchUploadProgressUpdate['phase'], loaded: number, total: number) {
      const safeTotal = total > 0 ? total : totalBytes;
      const percent = safeTotal > 0
        ? Math.min(100, Math.max(0, Math.round((loaded / safeTotal) * 100)))
        : phase === 'processing'
          ? 100
          : 0;
      onProgress?.({
        phase,
        loaded,
        total: safeTotal,
        percent
      });
    }

    xhr.open('POST', `/api/session/${sessionId}/attachments`);
    xhr.upload.onprogress = (event) => {
      reportProgress(
        'uploading',
        event.loaded,
        event.lengthComputable ? event.total : totalBytes
      );
    };
    xhr.upload.onload = () => {
      uploadCompleteReported = true;
      reportProgress('processing', totalBytes, totalBytes);
    };
    xhr.onerror = () => reject(new Error('Upload failed. Check your connection and try again.'));
    xhr.onload = () => {
      if (!uploadCompleteReported) {
        reportProgress('processing', totalBytes, totalBytes);
      }

      const payload = parseUploadResponse(xhr.responseText);
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(readUploadError(payload, xhr.statusText)));
        return;
      }

      resolve(payload as AttachmentResponse);
    };
    xhr.send(formData);
  });
}

function totalFileBytes(files: File[]): number {
  return files.reduce((total, file) => total + file.size, 0);
}

function parseUploadResponse(responseText: string): unknown {
  if (!responseText) {
    return {};
  }

  try {
    return JSON.parse(responseText);
  } catch {
    return {};
  }
}

function readUploadError(payload: unknown, fallback: string): string {
  if (
    payload &&
    typeof payload === 'object' &&
    'error' in payload &&
    typeof (payload as { error?: unknown }).error === 'string'
  ) {
    return (payload as { error: string }).error;
  }

  return fallback || 'Upload failed. Check the file type and try again.';
}

export async function removeAttachment(sessionId: string, attachmentId: string): Promise<SnapshotResponse> {
  const response = await fetch(`/api/session/${sessionId}/attachments/${attachmentId}`, {
    method: 'DELETE'
  });

  return readJson<SnapshotResponse>(response);
}

export async function fetchSnapshot(sessionId: string): Promise<WorkbenchSessionSnapshot> {
  const response = await fetch(`/api/session/${sessionId}`);
  const payload = await readJson<SnapshotResponse>(response);
  return payload.snapshot;
}

export async function resolveApproval(
  sessionId: string,
  requestId: string,
  decision: 'allow' | 'deny',
  pendingApproval?: PendingApproval
): Promise<WorkbenchSessionSnapshot> {
  const response = await fetch(`/api/session/${sessionId}/approvals/${requestId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      decision,
      ...(decision === 'deny' ? { reason: 'Denied from workbench' } : {}),
      ...(decision === 'allow' && pendingApproval ? { updatedInput: pendingApproval.input } : {})
    })
  });
  const payload = await readJson<SnapshotResponse>(response);
  return payload.snapshot;
}

export async function fetchHealth(): Promise<WorkbenchHealth> {
  const response = await fetch('/api/health/oca');
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: response.statusText }));
    return {
      ok: false,
      provider: 'oracle-code-assist',
      model: null,
      error: typeof payload.error === 'string' ? payload.error : response.statusText
    };
  }

  return (await response.json()) as WorkbenchHealth;
}
