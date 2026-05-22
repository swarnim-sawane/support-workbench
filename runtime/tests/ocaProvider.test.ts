import { afterEach, describe, expect, it, vi } from 'vitest';
import { OcaModelProvider } from '../src/ocaProvider';

describe('OcaModelProvider', () => {
  const originalOcaRequestTimeoutMs = process.env.OCA_REQUEST_TIMEOUT_MS;
  const originalOcaChatRequestTimeoutMs = process.env.OCA_CHAT_REQUEST_TIMEOUT_MS;

  afterEach(() => {
    vi.restoreAllMocks();
    if (typeof originalOcaRequestTimeoutMs === 'undefined') {
      delete process.env.OCA_REQUEST_TIMEOUT_MS;
    } else {
      process.env.OCA_REQUEST_TIMEOUT_MS = originalOcaRequestTimeoutMs;
    }
    if (typeof originalOcaChatRequestTimeoutMs === 'undefined') {
      delete process.env.OCA_CHAT_REQUEST_TIMEOUT_MS;
    } else {
      process.env.OCA_CHAT_REQUEST_TIMEOUT_MS = originalOcaChatRequestTimeoutMs;
    }
  });

  it('times out health checks instead of waiting indefinitely on network fetches', async () => {
    const fetchImpl = vi.fn((_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      })
    ) as unknown as typeof fetch;

    const provider = new OcaModelProvider({
      baseUrl: 'https://oca.example.test/v1',
      token: 'token',
      fetchImpl,
      requestTimeoutMs: 5
    });

    await expect(provider.healthCheck()).resolves.toMatchObject({
      ok: false,
      provider: 'oracle-code-assist',
      error: 'OCA request timed out after 5 ms'
    });
  });

  it('times out chat turns instead of waiting indefinitely on model responses', async () => {
    const fetchImpl = vi.fn((_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      })
    ) as unknown as typeof fetch;

    const provider = new OcaModelProvider({
      baseUrl: 'https://oca.example.test/v1',
      token: 'token',
      fetchImpl,
      requestTimeoutMs: 5
    });

    const turn = provider.sendTurn([], {
      sessionId: 'session-timeout',
      cwd: 'C:/repo',
      systemPrompt: 'System prompt',
      tools: []
    });

    await expect(turn.next()).rejects.toThrow('OCA request timed out after 5 ms');
  });

  it('allows chat turns to use a longer timeout than health checks', async () => {
    process.env.OCA_REQUEST_TIMEOUT_MS = '5';
    process.env.OCA_CHAT_REQUEST_TIMEOUT_MS = '25';
    const fetchImpl = vi.fn((_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      })
    ) as unknown as typeof fetch;

    const provider = new OcaModelProvider({
      baseUrl: 'https://oca.example.test/v1',
      token: 'token',
      fetchImpl
    });

    await expect(provider.healthCheck()).resolves.toMatchObject({
      ok: false,
      error: 'OCA request timed out after 5 ms'
    });

    const turn = provider.sendTurn([], {
      sessionId: 'session-chat-timeout',
      cwd: 'C:/repo',
      systemPrompt: 'System prompt',
      tools: []
    });

    await expect(turn.next()).rejects.toThrow('OCA request timed out after 25 ms');
  });
});
