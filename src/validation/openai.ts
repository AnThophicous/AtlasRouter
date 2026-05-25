import { z } from 'zod';
import type { OpenAIRequest } from '../types/openai.js';

const messageSchema = z.object({
  role: z.string().min(1),
  content: z.unknown().optional().nullable()
}).passthrough();

const chatCompletionSchema = z.object({
  model: z.string().min(1),
  messages: z.array(messageSchema).min(1),
  stream: z.boolean().optional()
}).passthrough();

export function parseChatCompletionRequest(value: unknown): OpenAIRequest {
  return chatCompletionSchema.parse(value) as OpenAIRequest;
}

export function formatZodError(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`).join('; ');
}
