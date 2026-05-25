import type { OpenAIError } from '../types/openai.js';

export function openAIError(
  message: string,
  status = 500,
  type = 'api_error',
  code: string | null = null,
  param: string | null = null,
  headers?: HeadersInit
): Response {
  const body: OpenAIError = {
    error: {
      message,
      type,
      param,
      code
    }
  };

  const init: ResponseInit = { status };
  if (headers) init.headers = headers;
  return Response.json(body, init);
}

export function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown error';
}
