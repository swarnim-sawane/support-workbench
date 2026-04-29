import type {
  PendingApproval,
  WorkbenchAttachment,
  WorkbenchHealth,
  WorkbenchSessionSummary,
  WorkbenchSessionSnapshot
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
  files: File[]
): Promise<AttachmentResponse> {
  const formData = new FormData();
  for (const file of files) {
    formData.append('files', file);
  }

  const response = await fetch(`/api/session/${sessionId}/attachments`, {
    method: 'POST',
    body: formData
  });

  return readJson<AttachmentResponse>(response);
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
