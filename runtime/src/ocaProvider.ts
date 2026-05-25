import { randomUUID } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import type {
  EngineHealth,
  EngineModelImageAttachment,
  EngineModelEvent,
  EngineModelMessage,
  EngineModelProvider,
  EngineToolDescriptor
} from './types.js';

const DEFAULT_MAX_INLINE_IMAGE_BYTES = 10 * 1024 * 1024;

type OcaProviderOptions = {
  baseUrl?: string;
  model?: string;
  token?: string;
  fetchImpl?: typeof fetch;
  requestTimeoutMs?: number;
};

type ParsedToolEnvelope = {
  toolUseId: string;
  toolName: string;
  input: Record<string, unknown>;
  reasoning?: string;
};

function buildCompatibilityPrompt(
  systemPrompt: string,
  cwd: string,
  tools: EngineToolDescriptor[]
): string {
  const toolNames = tools.map((tool) => tool.name).join('|');
  return `${systemPrompt}

# OCA compatibility transport
You are running through a local compatibility adapter that reconstructs Claude Code style tool use on top of a plain chat model.

Current working directory: ${cwd}

When you need tools, keep any user-facing explanation brief and then emit one or more tool blocks in this format:
<claude_code_tool name="${toolNames}" tool_use_id="optional-id" reason="short reason">
{"input_key":"value"}
</claude_code_tool>

Rules for the compatibility transport:
- You may emit zero, one, or multiple tool blocks in a single response
- If you need several tools, emit them in the order they should run
- Do not wrap the JSON body in markdown fences
- Use the exact Claude Code tool names shown above
- Prefer dedicated tools over Bash or PowerShell for reading, writing, editing, globbing, and grepping
- When the user asks about capabilities or autonomy, ground your answer in the runtime capability context you were given and mention unavailable features as limitations
- If no tool is needed, respond normally with assistant text only

After a tool runs, you may receive a tool result as a user message in this format:
<claude_code_tool_result name="ToolName" tool_use_id="tool-id">
{...}
</claude_code_tool_result>

Use that tool result to decide the next step.`;
}

function parseXmlAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const regex = /([a-zA-Z_][\w-]*)="([^"]*)"/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(source)) !== null) {
    attributes[match[1]!] = match[2] ?? '';
  }

  return attributes;
}

function parseTaggedToolCalls(text: string): ParsedToolEnvelope[] {
  const matches = [...text.matchAll(/<claude_code_tool\b([^>]*)>([\s\S]*?)<\/claude_code_tool>/gi)];
  const toolCalls: ParsedToolEnvelope[] = [];

  for (const match of matches) {
    const attributes = parseXmlAttributes(match[1] ?? '');
    const rawInput = (match[2] ?? '').trim();
    if (!attributes.name || !rawInput) {
      continue;
    }

    try {
      toolCalls.push({
        toolUseId: attributes.tool_use_id || randomUUID(),
        toolName: attributes.name,
        input: JSON.parse(rawInput) as Record<string, unknown>,
        reasoning: attributes.reason || undefined
      });
    } catch {
      continue;
    }
  }

  return toolCalls;
}

function parseLegacyToolCall(text: string): ParsedToolEnvelope | null {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines.reverse()) {
    if (!line.startsWith('{') || !line.endsWith('}')) {
      continue;
    }

    try {
      const parsed = JSON.parse(line) as {
        tool?: string;
        input?: Record<string, unknown>;
        reasoning?: string;
      };
      if (parsed.tool && parsed.input && typeof parsed.tool === 'string') {
        return {
          toolUseId: randomUUID(),
          toolName: parsed.tool,
          input: parsed.input,
          reasoning: parsed.reasoning
        };
      }
    } catch {
      continue;
    }
  }

  return null;
}

function parseAssistantResponse(text: string): {
  assistantText: string;
  toolCalls: ParsedToolEnvelope[];
} {
  const taggedToolCalls = parseTaggedToolCalls(text);
  const toolCalls =
    taggedToolCalls.length > 0
      ? taggedToolCalls
      : (() => {
          const legacy = parseLegacyToolCall(text);
          return legacy ? [legacy] : [];
        })();

  if (!toolCalls.length) {
    return {
      assistantText: text.trim(),
      toolCalls: []
    };
  }

  const assistantText = text
    .replace(/<claude_code_tool\b[^>]*>[\s\S]*?<\/claude_code_tool>/gi, '')
    .trim();

  return {
    assistantText,
    toolCalls
  };
}

type OpenAiContentPart =
  | {
      type: 'text';
      text: string;
    }
  | {
      type: 'image_url';
      image_url: {
        url: string;
      };
    };

type OpenAiMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string | OpenAiContentPart[];
};

function maxInlineImageBytes(): number {
  const configured = Number(process.env.OCA_MAX_INLINE_IMAGE_BYTES);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_MAX_INLINE_IMAGE_BYTES;
}

function imageAttachmentToContentPart(attachment: EngineModelImageAttachment): OpenAiContentPart | null {
  try {
    if (statSync(attachment.localPath).size > maxInlineImageBytes()) {
      return null;
    }

    const encoded = readFileSync(attachment.localPath).toString('base64');
    return {
      type: 'image_url',
      image_url: {
        url: `data:${attachment.mediaType || 'image/png'};base64,${encoded}`
      }
    };
  } catch {
    return null;
  }
}

function toOpenAiMessage(message: EngineModelMessage): OpenAiMessage {
  if (message.role === 'tool') {
    return {
      role: 'user',
      content: `<claude_code_tool_result name="${message.toolName}" tool_use_id="${message.toolUseId}">
${message.content}
</claude_code_tool_result>`
    };
  }

  if (message.role === 'user' && message.imageAttachments?.length) {
    const imageParts = message.imageAttachments
      .map(imageAttachmentToContentPart)
      .filter((part): part is OpenAiContentPart => part !== null);

    if (imageParts.length) {
      return {
        role: message.role,
        content: [
          { type: 'text', text: message.content },
          ...imageParts
        ]
      };
    }
  }

  return {
    role: message.role,
    content: message.content
  };
}

export class OcaModelProvider implements EngineModelProvider {
  private readonly baseUrl: string | undefined;
  private readonly model: string;
  private readonly token: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly requestTimeoutMs: number;
  private readonly chatRequestTimeoutMs: number;
  private readonly activeControllers = new Map<string, AbortController>();

  constructor(options: OcaProviderOptions = {}) {
    this.baseUrl = options.baseUrl ?? process.env.OCA_BASE_URL;
    this.model = options.model ?? process.env.OCA_MODEL ?? 'oca/gpt-5.4';
    this.token = options.token ?? process.env.OCA_TOKEN;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.requestTimeoutMs = options.requestTimeoutMs ?? Number(process.env.OCA_REQUEST_TIMEOUT_MS ?? 60000);
    this.chatRequestTimeoutMs = options.requestTimeoutMs ?? Number(process.env.OCA_CHAT_REQUEST_TIMEOUT_MS ?? process.env.OCA_REQUEST_TIMEOUT_MS ?? 60000);
  }

  async healthCheck(): Promise<EngineHealth> {
    if (!this.baseUrl || !this.token) {
      return {
        ok: false,
        provider: 'oracle-code-assist',
        model: null,
        error: 'Missing OCA_BASE_URL or OCA_TOKEN'
      };
    }

    try {
      const response = await this.fetchWithTimeout(`${this.baseUrl}/models`, {
        headers: {
          Authorization: `Bearer ${this.token}`
        }
      });

      if (response.ok) {
        return {
          ok: true,
          provider: 'oracle-code-assist',
          model: this.model
        };
      }

      const fallbackResponse = await this.fetchWithTimeout(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`
        },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: 'user', content: 'health-check' }],
          stream: true,
          max_tokens: 1,
          temperature: 0
        })
      });

      if (fallbackResponse.ok) {
        await fallbackResponse.body?.cancel();
        return {
          ok: true,
          provider: 'oracle-code-assist',
          model: this.model
        };
      }

      return {
        ok: false,
        provider: 'oracle-code-assist',
        model: this.model,
        error: `Health check failed with statuses ${response.status}/${fallbackResponse.status}`
      };
    } catch (error) {
      return {
        ok: false,
        provider: 'oracle-code-assist',
        model: this.model,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async *sendTurn(
    messages: EngineModelMessage[],
    options: {
      sessionId: string;
      cwd: string;
      systemPrompt: string;
      tools: EngineToolDescriptor[];
    }
  ): AsyncIterable<EngineModelEvent> {
    if (!this.baseUrl || !this.token) {
      throw new Error('Missing OCA_BASE_URL or OCA_TOKEN');
    }

    const payloadMessages = [
      {
        role: 'system' as const,
        content: buildCompatibilityPrompt(options.systemPrompt, options.cwd, options.tools)
      },
      ...messages.map(toOpenAiMessage)
    ];

    this.activeControllers.get(options.sessionId)?.abort();
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.chatRequestTimeoutMs);
    this.activeControllers.set(options.sessionId, controller);

    try {
      const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          messages: payloadMessages,
          stream: true,
          temperature: 0.15
        })
      });

      if (!response.ok || !response.body) {
        throw new Error(`OCA request failed with status ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';

      let yieldedIndex = 0;
      let inToolBlock = false;
      let toolStartIndex = -1;

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data:')) {
            continue;
          }

          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') {
            continue;
          }

          const chunk = JSON.parse(data) as {
            choices?: Array<{
              delta?: { content?: string };
              message?: { content?: string };
            }>;
          };
          const text =
            chunk.choices?.[0]?.delta?.content ??
            chunk.choices?.[0]?.message?.content ??
            '';

          if (text) {
            fullText += text;

            // Stream state machine parsing
            while (yieldedIndex < fullText.length) {
              if (!inToolBlock) {
                const matchIndex = fullText.indexOf('<claude_code_tool', yieldedIndex);
                if (matchIndex !== -1) {
                  // Yield any preceding assistant text delta
                  const textBefore = fullText.slice(yieldedIndex, matchIndex);
                  if (textBefore) {
                    yield {
                      type: 'assistant_delta',
                      text: textBefore
                    };
                  }
                  inToolBlock = true;
                  toolStartIndex = matchIndex;
                  yieldedIndex = matchIndex;
                } else {
                  // Avoid yielding a partial tag (e.g. "<cl") at the end of fullText
                  const lastAngleBracket = fullText.lastIndexOf('<', fullText.length - 1);
                  let safeEnd = fullText.length;
                  if (lastAngleBracket >= yieldedIndex && lastAngleBracket >= fullText.length - 25) {
                    const possibleTag = fullText.slice(lastAngleBracket);
                    if ('<claude_code_tool'.startsWith(possibleTag)) {
                      safeEnd = lastAngleBracket;
                    }
                  }

                  const textToYield = fullText.slice(yieldedIndex, safeEnd);
                  if (textToYield) {
                    yield {
                      type: 'assistant_delta',
                      text: textToYield
                    };
                    yieldedIndex = safeEnd;
                  }
                  break; // Wait for more tokens
                }
              } else {
                const closeIndex = fullText.indexOf('</claude_code_tool>', yieldedIndex);
                if (closeIndex !== -1) {
                  const blockEndIndex = closeIndex + '</claude_code_tool>'.length;
                  const toolBlock = fullText.slice(toolStartIndex, blockEndIndex);
                  const toolCalls = parseTaggedToolCalls(toolBlock);
                  for (const toolCall of toolCalls) {
                    yield {
                      type: 'tool_call',
                      toolUseId: toolCall.toolUseId,
                      toolName: toolCall.toolName,
                      input: toolCall.input,
                      reasoning: toolCall.reasoning
                    };
                  }
                  inToolBlock = false;
                  yieldedIndex = blockEndIndex;
                } else {
                  break; // Wait for more tokens to close the tool block
                }
              }
            }
          }
        }
      }

      // Yield any remaining assistant text
      if (!inToolBlock && yieldedIndex < fullText.length) {
        const remaining = fullText.slice(yieldedIndex);
        if (remaining) {
          yield {
            type: 'assistant_delta',
            text: remaining
          };
        }
      } else if (inToolBlock) {
        const toolBlock = fullText.slice(toolStartIndex);
        const toolCalls = parseTaggedToolCalls(toolBlock);
        for (const toolCall of toolCalls) {
          yield {
            type: 'tool_call',
            toolUseId: toolCall.toolUseId,
            toolName: toolCall.toolName,
            input: toolCall.input,
            reasoning: toolCall.reasoning
          };
        }
      }

      // Legacy fallback (only if no XML tags were detected)
      if (fullText && !fullText.includes('<claude_code_tool')) {
        const legacy = parseLegacyToolCall(fullText);
        if (legacy) {
          yield {
            type: 'tool_call',
            toolUseId: legacy.toolUseId,
            toolName: legacy.toolName,
            input: legacy.input,
            reasoning: legacy.reasoning
          };
        }
      }

      yield {
        type: 'assistant_done'
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError' && timedOut) {
        throw new Error(`OCA request timed out after ${this.chatRequestTimeoutMs} ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      if (this.activeControllers.get(options.sessionId) === controller) {
        this.activeControllers.delete(options.sessionId);
      }
    }
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    try {
      return await this.fetchImpl(url, {
        ...init,
        signal: controller.signal
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error(`OCA request timed out after ${this.requestTimeoutMs} ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async cancelTurn(sessionId: string): Promise<void> {
    const controller = this.activeControllers.get(sessionId);
    if (!controller) {
      return;
    }

    controller.abort();
    this.activeControllers.delete(sessionId);
  }
}
