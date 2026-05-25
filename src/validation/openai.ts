import { z } from 'zod';
import type { AnthropicMessagesRequest, GeminiGenerateContentRequest, OpenAIRequest, ResponsesRequest } from '../types/openai.js';

const messageSchema = z.object({
  role: z.string().min(1),
  content: z.unknown().optional().nullable()
}).passthrough();

const chatCompletionSchema = z.object({
  model: z.string().min(1),
  messages: z.array(messageSchema).min(1),
  stream: z.boolean().optional()
}).passthrough();

const responsesInputMessageSchema = z.object({
  type: z.string().optional(),
  role: z.string().optional(),
  content: z.unknown().optional()
}).passthrough();

const responsesSchema = z.object({
  model: z.string().min(1),
  input: z.union([z.string(), z.array(responsesInputMessageSchema), z.record(z.string(), z.unknown())]).optional(),
  previous_response_id: z.string().min(1).optional(),
  stream: z.boolean().optional()
}).passthrough().superRefine((value, context) => {
  if (value.input === undefined && value.previous_response_id === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'body: input or previous_response_id is required',
      path: ['input']
    });
  }
});

const anthropicMessagesSchema = z.object({
  model: z.string().min(1),
  messages: z.array(messageSchema).min(1),
  stream: z.boolean().optional()
}).passthrough();

const geminiGenerateContentSchema = z.object({
  contents: z.array(z.record(z.string(), z.unknown())).optional(),
  systemInstruction: z.record(z.string(), z.unknown()).optional(),
  generationConfig: z.record(z.string(), z.unknown()).optional(),
  tools: z.array(z.record(z.string(), z.unknown())).optional()
}).passthrough();

export function parseChatCompletionRequest(value: unknown): OpenAIRequest {
  return chatCompletionSchema.parse(value) as OpenAIRequest;
}

export function parseResponsesRequest(value: unknown): ResponsesRequest {
  return responsesSchema.parse(value) as ResponsesRequest;
}

export function parseAnthropicMessagesRequest(value: unknown): AnthropicMessagesRequest {
  return anthropicMessagesSchema.parse(value) as AnthropicMessagesRequest;
}

export function parseGeminiGenerateContentRequest(value: unknown): GeminiGenerateContentRequest {
  return geminiGenerateContentSchema.parse(value) as GeminiGenerateContentRequest;
}

export function formatZodError(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`).join('; ');
}
