import { describe, expect, it, vi } from 'vitest';
import { OcaModelProvider } from '../src/ocaProvider';

describe('OcaModelProvider', () => {
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
});
