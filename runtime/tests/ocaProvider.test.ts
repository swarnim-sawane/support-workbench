import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OcaModelProvider } from '../src/ocaProvider';

describe('OcaModelProvider', () => {
  const originalOcaRequestTimeoutMs = process.env.OCA_REQUEST_TIMEOUT_MS;
  const originalOcaChatRequestTimeoutMs = process.env.OCA_CHAT_REQUEST_TIMEOUT_MS;
  const tempDirs: string[] = [];

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
    for (const directory of tempDirs.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
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

  it('serializes image attachments as multimodal image input', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'oca-provider-image-'));
    tempDirs.push(directory);
    const imagePath = join(directory, 'screen.png');
    writeFileSync(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const fetchImpl = vi.fn((_url: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"seen"}}]}\n\ndata: [DONE]\n\n'));
            controller.close();
          }
        }),
        { status: 200 }
      ))
    ) as unknown as typeof fetch;

    const provider = new OcaModelProvider({
      baseUrl: 'https://oca.example.test/v1',
      token: 'token',
      fetchImpl
    });

    const events = [];
    for await (const event of provider.sendTurn([
      {
        role: 'user',
        content: 'what is in this image?',
        imageAttachments: [
          {
            originalName: 'screen.png',
            mediaType: 'image/png',
            localPath: imagePath,
            size: 4
          }
        ]
      }
    ], {
      sessionId: 'session-image',
      cwd: 'C:/repo',
      systemPrompt: 'System prompt',
      tools: []
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: 'assistant_delta', text: 'seen' },
      { type: 'assistant_done' }
    ]);

    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    const userMessage = body.messages.at(-1);
    expect(userMessage.content).toEqual([
      { type: 'text', text: 'what is in this image?' },
      {
        type: 'image_url',
        image_url: {
          url: 'data:image/png;base64,iVBORw=='
        }
      }
    ]);
  });
});
