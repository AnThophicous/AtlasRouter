import { randomUUID } from 'node:crypto';
import type { FunctionToolDefinition, Message, MessageContent, MessageContentPart, OpenAIRequest, ResponsesRequest, ResponseMessageInput } from '../types/openai.js';

export interface StoredResponse {
  body: Record<string, unknown>;
  messages: Message[];
  inputItems: Array<Record<string, unknown>>;
}

const responses = new Map<string, StoredResponse>();
const maxResponses = 200;

function responseContentParts(value: ResponseMessageInput['content']): MessageContent {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return null;

  const parts: MessageContentPart[] = [];
  for (const item of value) {
    if (item && typeof item === 'object' && item.type === 'input_text' && typeof item.text === 'string') {
      parts.push({ type: 'text', text: item.text });
      continue;
    }
    if (item && typeof item === 'object' && item.type === 'input_image') {
      const url = typeof item.image_url === 'string' ? item.image_url : typeof item.image === 'string' ? item.image : null;
      if (url) {
        parts.push({
          type: 'image_url',
          image_url: {
            url,
            detail: item.detail === 'low' || item.detail === 'high' ? item.detail : 'auto'
          }
        });
      }
      continue;
    }
  }

  return parts.length > 0 ? parts : null;
}

function itemId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

function normalizedInputContent(value: ResponseMessageInput['content']): Array<Record<string, unknown>> {
  if (typeof value === 'string') return [{ type: 'input_text', text: value }];
  if (!Array.isArray(value)) return [];
  return value.map((item) => ({ ...item }));
}

function messagesFromInput(input: ResponsesRequest['input']): { messages: Message[]; inputItems: Array<Record<string, unknown>> } {
  if (typeof input === 'string') {
    const inputItem = {
      id: itemId('msg'),
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: input }]
    };
    return {
      messages: [{ role: 'user', content: input }],
      inputItems: [inputItem]
    };
  }

  if (!Array.isArray(input)) return { messages: [], inputItems: [] };

  const messages: Message[] = [];
  const inputItems: Array<Record<string, unknown>> = [];

  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const type: string = typeof item.type === 'string' ? item.type : 'message';

    if (type === 'function_call_output') {
      const callId = typeof item.call_id === 'string' ? item.call_id : typeof item.id === 'string' ? item.id : itemId('call');
      const output = typeof item.output === 'string' ? item.output : JSON.stringify(item.output ?? '');
      messages.push({
        role: 'tool',
        tool_call_id: callId,
        content: output
      });
      inputItems.push({
        id: itemId('fc_output'),
        type: 'function_call_output',
        call_id: callId,
        output
      });
      continue;
    }

    if (type === 'function_call') {
      const callId = typeof item.call_id === 'string' ? item.call_id : typeof item.id === 'string' ? item.id : itemId('call');
      const name = typeof item.name === 'string' ? item.name : 'function';
      const args = typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments ?? {});
      messages.push({
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: callId,
            type: 'function',
            function: {
              name,
              arguments: args
            }
          }
        ]
      });
      inputItems.push({ ...item, id: typeof item.id === 'string' ? item.id : callId, call_id: callId });
      continue;
    }

    if (type === 'reasoning' || type === 'item_reference') {
      inputItems.push({ ...item, id: typeof item.id === 'string' ? item.id : itemId(type) });
      continue;
    }

    const role = typeof item.role === 'string' && item.role.length > 0 ? item.role : 'user';
    messages.push({
      role,
      content: responseContentParts(item.content)
    });
    inputItems.push({
      id: typeof item.id === 'string' ? item.id : itemId('msg'),
      type: 'message',
      role,
      content: normalizedInputContent(item.content)
    });
  }

  return { messages, inputItems };
}

function convertResponseTools(tools: unknown): { tools?: FunctionToolDefinition[]; unsupported?: string } {
  if (!Array.isArray(tools)) return {};
  const converted: FunctionToolDefinition[] = [];

  for (const tool of tools) {
    if (!tool || typeof tool !== 'object') continue;
    const value = tool as Record<string, unknown>;
    if (value.type === 'function' && typeof value.name === 'string') {
      const fn: FunctionToolDefinition['function'] = {
        name: value.name
      };
      if (typeof value.description === 'string') fn.description = value.description;
      if (typeof value.parameters === 'object' && value.parameters !== null) fn.parameters = value.parameters as any;
      if (typeof value.strict === 'boolean') fn.strict = value.strict;
      converted.push({
        type: 'function',
        function: fn
      });
      continue;
    }
    if (value.type === 'function' && typeof (value.function as any)?.name === 'string') {
      converted.push(value as unknown as FunctionToolDefinition);
      continue;
    }
    if (typeof value.type === 'string') {
      return { unsupported: `Responses tool type is not supported by AtlasRouter adapters: ${value.type}` };
    }
  }

  return converted.length > 0 ? { tools: converted } : {};
}

export function responseRequestToChatRequest(body: ResponsesRequest): { request: OpenAIRequest; messages: Message[]; inputItems: Array<Record<string, unknown>>; unsupported?: string } {
  const previous = body.previous_response_id ? getStoredResponse(body.previous_response_id) : null;
  const input = messagesFromInput(body.input);
  const toolResult = convertResponseTools(body.tools);
  const messages: Message[] = [];
  const inputItems: Array<Record<string, unknown>> = [];

  if (typeof body.instructions === 'string' && body.instructions.trim().length > 0) {
    messages.push({ role: 'system', content: body.instructions.trim() });
  }

  if (previous) {
    messages.push(...previous.messages);
    inputItems.push(...previous.inputItems);
  }
  messages.push(...input.messages);
  inputItems.push(...input.inputItems);

  const request: OpenAIRequest = {
    ...body,
    model: body.model,
    messages
  };

  if (body.stream !== undefined) request.stream = body.stream;
  if (typeof body.max_output_tokens === 'number') request.max_tokens = body.max_output_tokens;
  if (toolResult.tools) request.tools = toolResult.tools;

  const result: { request: OpenAIRequest; messages: Message[]; inputItems: Array<Record<string, unknown>>; unsupported?: string } = {
    request,
    messages,
    inputItems
  };
  if (toolResult.unsupported) result.unsupported = toolResult.unsupported;
  return result;
}

function responseMessageId(): string {
  return `msg_${randomUUID()}`;
}

function responseContentText(payload: any): string {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((item) => typeof item?.text === 'string' ? item.text : '').join('');
  }
  return '';
}

export function adaptChatPayloadToResponse(payload: any, model: string): Record<string, unknown> {
  const upstreamId = typeof payload?.id === 'string' ? payload.id : null;
  const responseId = upstreamId?.startsWith('resp_') ? upstreamId : `resp_${randomUUID()}`;
  const createdAt = Number(payload?.created ?? Math.floor(Date.now() / 1000));
  const text = responseContentText(payload);
  const usage = payload?.usage ?? {};
  const message = payload?.choices?.[0]?.message ?? {};
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  const output: Array<Record<string, unknown>> = [];

  if (text.length > 0) {
    output.push({
      id: responseMessageId(),
      type: 'message',
      status: 'completed',
      role: 'assistant',
      content: [
        {
          type: 'output_text',
          text,
          annotations: []
        }
      ]
    });
  }

  for (const call of toolCalls) {
    const functionCall = call?.function ?? {};
    output.push({
      id: typeof call?.id === 'string' ? call.id : itemId('fc'),
      type: 'function_call',
      status: 'completed',
      call_id: typeof call?.id === 'string' ? call.id : itemId('call'),
      name: typeof functionCall.name === 'string' ? functionCall.name : 'function',
      arguments: typeof functionCall.arguments === 'string' ? functionCall.arguments : '{}'
    });
  }

  if (output.length === 0) {
    output.push({
      id: responseMessageId(),
      type: 'message',
      status: 'completed',
      role: 'assistant',
      content: [{ type: 'output_text', text: '', annotations: [] }]
    });
  }

  return {
    id: responseId,
    object: 'response',
    created_at: createdAt,
    completed_at: createdAt,
    status: 'completed',
    model: String(payload?.model ?? model),
    output,
    output_text: text,
    usage: {
      input_tokens: Number(usage.prompt_tokens ?? 0),
      output_tokens: Number(usage.completion_tokens ?? 0),
      total_tokens: Number(usage.total_tokens ?? 0)
    }
  };
}

export function storeResponse(body: Record<string, unknown>, messages: Message[], inputItems: Array<Record<string, unknown>> = []): void {
  const outputItems = Array.isArray(body.output) ? body.output as Array<Record<string, unknown>> : [];
  responses.set(String(body.id), { body, messages, inputItems: [...inputItems, ...outputItems] });
  if (responses.size <= maxResponses) return;
  const oldest = responses.keys().next().value;
  if (oldest) responses.delete(oldest);
}

export function deleteStoredResponse(responseId: string): boolean {
  return responses.delete(responseId);
}

export function storedResponseInputItems(responseId: string): Array<Record<string, unknown>> | null {
  const stored = responses.get(responseId);
  return stored ? stored.inputItems.map((item) => ({ ...item })) : null;
}

export function getStoredResponse(responseId: string): StoredResponse | null {
  return responses.get(responseId) ?? null;
}

function chunkText(content: string): string[] {
  const chunks = content.match(/.{1,180}(\s|$)/gs);
  return chunks && chunks.length > 0 ? chunks.map((chunk) => chunk.trimStart()) : [content];
}

export function responsesStream(responseBody: Record<string, unknown>): Response {
  const encoder = new TextEncoder();
  const id = String(responseBody.id);
  const createdAt = Number(responseBody.created_at ?? Math.floor(Date.now() / 1000));
  const model = String(responseBody.model ?? '');
  const output = Array.isArray(responseBody.output) ? responseBody.output[0] as any : null;
  const outputItems = Array.isArray(responseBody.output) ? responseBody.output as Array<Record<string, unknown>> : [];
  const text = typeof responseBody.output_text === 'string' ? responseBody.output_text : '';
  const chunks = chunkText(text);
  let sequenceNumber = 0;

  function event(name: string, data: Record<string, unknown>): Uint8Array {
    sequenceNumber++;
    return encoder.encode(`event: ${name}\ndata: ${JSON.stringify({ type: name, sequence_number: sequenceNumber, ...data })}\n\n`);
  }

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(event('response.created', { response: responseBody }));
      controller.enqueue(event('response.in_progress', { response: { ...responseBody, status: 'in_progress' } }));
      if (output) {
        controller.enqueue(event('response.output_item.added', { output_index: 0, item: { ...output, status: 'in_progress' } }));
        controller.enqueue(event('response.content_part.added', { output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } }));
      }
      for (const chunk of chunks) {
        controller.enqueue(event('response.output_text.delta', { id, created_at: createdAt, model, delta: chunk, output_index: 0, content_index: 0 }));
      }
      controller.enqueue(event('response.output_text.done', { id, created_at: createdAt, model, text, output_index: 0, content_index: 0 }));
      if (output) {
        controller.enqueue(event('response.content_part.done', { output_index: 0, content_index: 0, part: { type: 'output_text', text, annotations: [] } }));
        controller.enqueue(event('response.output_item.done', { output_index: 0, item: output }));
      }
      controller.enqueue(event('response.completed', { response: { ...responseBody, output: outputItems } }));
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
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
