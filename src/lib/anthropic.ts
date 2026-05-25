import { randomUUID } from 'node:crypto';
import type { AnthropicMessagesRequest, FunctionToolDefinition, Message, MessageContentPart, OpenAIRequest } from '../types/openai.js';

function anthropicContentToOpenAI(content: AnthropicMessagesRequest['messages'][number]['content']): string | MessageContentPart[] | null {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;

  const parts: MessageContentPart[] = [];
  for (const item of content) {
    if (item.type === 'text' && typeof item.text === 'string') {
      parts.push({ type: 'text', text: item.text });
      continue;
    }
    if (item.type === 'image' && item.source && typeof item.source === 'object') {
      const source = item.source as Record<string, unknown>;
      const url = typeof source.url === 'string'
        ? source.url
        : typeof source.data === 'string' && typeof source.media_type === 'string'
          ? `data:${source.media_type};base64,${source.data}`
          : null;
      if (url) parts.push({ type: 'image_url', image_url: { url } });
    }
  }

  return parts.length > 0 ? parts : null;
}

function systemMessages(system: AnthropicMessagesRequest['system']): Message[] {
  if (typeof system === 'string' && system.trim().length > 0) {
    return [{ role: 'system', content: system.trim() }];
  }
  if (!Array.isArray(system)) return [];
  const text = system
    .map((item) => item.type === 'text' && typeof item.text === 'string' ? item.text : '')
    .filter(Boolean)
    .join('\n');
  return text.length > 0 ? [{ role: 'system', content: text }] : [];
}

function anthropicTools(tools: AnthropicMessagesRequest['tools']): FunctionToolDefinition[] | undefined {
  if (!Array.isArray(tools)) return undefined;
  const converted: FunctionToolDefinition[] = [];

  for (const tool of tools) {
    if (typeof tool.name !== 'string') continue;
    const next: FunctionToolDefinition = {
      type: 'function',
      function: {
        name: tool.name
      }
    };
    if (typeof tool.description === 'string') next.function.description = tool.description;
    if (tool.input_schema && typeof tool.input_schema === 'object') next.function.parameters = tool.input_schema as any;
    converted.push(next);
  }

  return converted.length > 0 ? converted : undefined;
}

export function anthropicRequestToChatRequest(body: AnthropicMessagesRequest): OpenAIRequest {
  const messages: Message[] = [
    ...systemMessages(body.system),
    ...body.messages.map((message) => ({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: anthropicContentToOpenAI(message.content)
    }))
  ];

  const request: OpenAIRequest = {
    model: body.model,
    messages
  };

  if (typeof body.max_tokens === 'number') request.max_tokens = body.max_tokens;
  if (typeof body.temperature === 'number') request.temperature = body.temperature;
  if (typeof body.top_p === 'number') request.top_p = body.top_p;
  if (Array.isArray(body.stop_sequences)) request.stop = body.stop_sequences;
  const tools = anthropicTools(body.tools);
  if (tools) request.tools = tools;

  return request;
}

function textFromChatPayload(payload: any): string {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((item) => typeof item?.text === 'string' ? item.text : '').join('');
  return '';
}

function stopReason(payload: any): string {
  const reason = payload?.choices?.[0]?.finish_reason;
  if (reason === 'length') return 'max_tokens';
  if (reason === 'tool_calls') return 'tool_use';
  return 'end_turn';
}

export function chatPayloadToAnthropicMessage(payload: any, model: string): Record<string, unknown> {
  const usage = payload?.usage ?? {};
  const text = textFromChatPayload(payload);

  return {
    id: `msg_${randomUUID()}`,
    type: 'message',
    role: 'assistant',
    model: String(payload?.model ?? model),
    content: [
      {
        type: 'text',
        text
      }
    ],
    stop_reason: stopReason(payload),
    stop_sequence: null,
    usage: {
      input_tokens: Number(usage.prompt_tokens ?? 0),
      output_tokens: Number(usage.completion_tokens ?? 0)
    }
  };
}

function chunks(text: string): string[] {
  const value = text.match(/.{1,180}(\s|$)/gs);
  return value && value.length > 0 ? value.map((chunk) => chunk.trimStart()) : [text];
}

export function anthropicStream(message: Record<string, unknown>): Response {
  const encoder = new TextEncoder();
  const content = Array.isArray(message.content) ? message.content[0] as Record<string, unknown> : {};
  const text = typeof content.text === 'string' ? content.text : '';

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { ...message, content: [] } })}\n\n`));
      controller.enqueue(encoder.encode(`event: content_block_start\ndata: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })}\n\n`));
      for (const chunk of chunks(text)) {
        controller.enqueue(encoder.encode(`event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: chunk } })}\n\n`));
      }
      controller.enqueue(encoder.encode(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`));
      controller.enqueue(encoder.encode(`event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: message.stop_reason, stop_sequence: null }, usage: message.usage })}\n\n`));
      controller.enqueue(encoder.encode(`event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`));
      controller.close();
    }
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive'
    }
  });
}
