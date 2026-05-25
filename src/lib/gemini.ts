import type { FunctionToolDefinition, GeminiGenerateContentRequest, Message, MessageContentPart, OpenAIRequest } from '../types/openai.js';
import type { PublicModel } from './openai.js';

const modelAliases: Record<string, string> = {
  'atlas-auto': 'atlas/auto',
  'atlas-fast': 'atlas/fast',
  'atlas-reasoning': 'atlas/reasoning',
  'atlas-tools': 'atlas/tools',
  'atlas-compeat': 'atlas/compeat'
};

function partToContent(part: Record<string, unknown>): string | MessageContentPart | null {
  if (typeof part.text === 'string') return part.text;
  if (part.inlineData && typeof part.inlineData === 'object') {
    const inlineData = part.inlineData as Record<string, unknown>;
    if (typeof inlineData.mimeType === 'string' && typeof inlineData.data === 'string') {
      return {
        type: 'image_url',
        image_url: {
          url: `data:${inlineData.mimeType};base64,${inlineData.data}`
        }
      };
    }
  }
  if (part.fileData && typeof part.fileData === 'object') {
    const fileData = part.fileData as Record<string, unknown>;
    if (typeof fileData.fileUri === 'string') {
      return {
        type: 'image_url',
        image_url: {
          url: fileData.fileUri
        }
      };
    }
  }
  return null;
}

function contentParts(parts: unknown): string | MessageContentPart[] | null {
  if (!Array.isArray(parts)) return null;
  const text: string[] = [];
  const rich: MessageContentPart[] = [];

  for (const part of parts) {
    if (!part || typeof part !== 'object') continue;
    const converted = partToContent(part as Record<string, unknown>);
    if (typeof converted === 'string') text.push(converted);
    else if (converted) rich.push(converted);
  }

  if (rich.length > 0) {
    return [
      ...text.map((value) => ({ type: 'text' as const, text: value })),
      ...rich
    ];
  }

  return text.length > 0 ? text.join('\n') : null;
}

function systemInstruction(instruction: unknown): Message[] {
  if (!instruction || typeof instruction !== 'object') return [];
  const value = instruction as Record<string, unknown>;
  const content = contentParts(value.parts);
  return content ? [{ role: 'system', content }] : [];
}

function geminiTools(tools: unknown): FunctionToolDefinition[] | undefined {
  if (!Array.isArray(tools)) return undefined;
  const converted: FunctionToolDefinition[] = [];

  for (const tool of tools) {
    if (!tool || typeof tool !== 'object') continue;
    const declarations = (tool as Record<string, unknown>).functionDeclarations;
    if (!Array.isArray(declarations)) continue;
    for (const declaration of declarations) {
      if (!declaration || typeof declaration !== 'object') continue;
      const value = declaration as Record<string, unknown>;
      if (typeof value.name !== 'string') continue;
      const next: FunctionToolDefinition = {
        type: 'function',
        function: {
          name: value.name
        }
      };
      if (typeof value.description === 'string') next.function.description = value.description;
      if (value.parameters && typeof value.parameters === 'object') next.function.parameters = value.parameters as any;
      converted.push(next);
    }
  }

  return converted.length > 0 ? converted : undefined;
}

export function normalizeGeminiModel(model: string): string {
  const decoded = decodeURIComponent(model).replace(/^models\//, '');
  return modelAliases[decoded] ?? decoded;
}

export function geminiRequestToChatRequest(body: GeminiGenerateContentRequest, model: string): OpenAIRequest {
  const generationConfig = body.generationConfig ?? {};
  const messages: Message[] = [
    ...systemInstruction(body.systemInstruction),
    ...(body.contents ?? []).map((content) => ({
      role: content.role === 'model' ? 'assistant' : 'user',
      content: contentParts(content.parts)
    }))
  ];

  const request: OpenAIRequest = {
    model,
    messages
  };

  if (typeof generationConfig.temperature === 'number') request.temperature = generationConfig.temperature;
  if (typeof generationConfig.topP === 'number') request.top_p = generationConfig.topP;
  if (typeof generationConfig.maxOutputTokens === 'number') request.max_tokens = generationConfig.maxOutputTokens;
  if (Array.isArray(generationConfig.stopSequences)) request.stop = generationConfig.stopSequences.filter((item): item is string => typeof item === 'string');
  const tools = geminiTools(body.tools);
  if (tools) request.tools = tools;

  return request;
}

function textFromChatPayload(payload: any): string {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((item) => typeof item?.text === 'string' ? item.text : '').join('');
  return '';
}

function finishReason(payload: any): string {
  const value = payload?.choices?.[0]?.finish_reason;
  if (value === 'length') return 'MAX_TOKENS';
  if (value === 'tool_calls') return 'STOP';
  return 'STOP';
}

export function chatPayloadToGeminiResponse(payload: any, model: string): Record<string, unknown> {
  const text = textFromChatPayload(payload);
  const usage = payload?.usage ?? {};

  return {
    candidates: [
      {
        content: {
          role: 'model',
          parts: [{ text }]
        },
        finishReason: finishReason(payload),
        index: 0,
        safetyRatings: []
      }
    ],
    usageMetadata: {
      promptTokenCount: Number(usage.prompt_tokens ?? 0),
      candidatesTokenCount: Number(usage.completion_tokens ?? 0),
      totalTokenCount: Number(usage.total_tokens ?? 0)
    },
    modelVersion: String(payload?.model ?? model)
  };
}

function chunks(text: string): string[] {
  const value = text.match(/.{1,180}(\s|$)/gs);
  return value && value.length > 0 ? value.map((chunk) => chunk.trimStart()) : [text];
}

export function geminiStream(response: Record<string, unknown>, model: string): Response {
  const encoder = new TextEncoder();
  const candidate = Array.isArray(response.candidates) ? response.candidates[0] as any : null;
  const text = candidate?.content?.parts?.[0]?.text ?? '';

  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks(String(text))) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          candidates: [
            {
              content: {
                role: 'model',
                parts: [{ text: chunk }]
              },
              index: 0
            }
          ],
          modelVersion: model
        })}\n\n`));
      }
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(response)}\n\n`));
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

export function publicModelToGeminiModel(model: PublicModel): Record<string, unknown> {
  const safeName = model.id.replace(/\//g, '-');
  return {
    name: `models/${safeName}`,
    version: 'atlas',
    displayName: model.id,
    description: model.description ?? `AtlasRouter model ${model.id}`,
    inputTokenLimit: model.max_input_tokens ?? model.max_context_tokens ?? model.context_length ?? 0,
    outputTokenLimit: model.max_output_tokens ?? 0,
    supportedGenerationMethods: ['generateContent', 'streamGenerateContent']
  };
}
