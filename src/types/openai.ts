export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchema | boolean>;
  items?: JsonSchema | JsonSchema[];
  required?: string[];
  enum?: unknown[];
  const?: unknown;
  default?: unknown;
  description?: string;
  additionalProperties?: boolean | JsonSchema;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
  not?: JsonSchema;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  minItems?: number;
  maxItems?: number;
}

export interface FunctionToolDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: JsonSchema;
    strict?: boolean;
  };
}

export type ToolChoice =
  | 'auto'
  | 'none'
  | 'required'
  | { type: 'function'; function: { name: string } };

export interface TextContentPart {
  type: 'text';
  text: string;
}

export interface ImageContentPart {
  type: 'image_url';
  image_url: {
    url: string;
    detail?: 'auto' | 'low' | 'high';
  };
}

export type MessageContentPart = TextContentPart | ImageContentPart | Record<string, unknown>;
export type MessageContent = string | MessageContentPart[] | Record<string, unknown> | null;

export interface MessageToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface Message {
  role: string;
  content?: MessageContent;
  tool_calls?: MessageToolCall[];
  tool_call_id?: string;
  name?: string;
  reasoning_content?: string;
  [key: string]: unknown;
}

export interface StreamOptions {
  include_usage?: boolean;
  [key: string]: unknown;
}

export interface OpenAIRequest {
  model: string;
  messages: Message[];
  stream?: boolean;
  stream_options?: StreamOptions;
  tools?: FunctionToolDefinition[];
  tool_choice?: ToolChoice;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stop?: string | string[];
  presence_penalty?: number;
  frequency_penalty?: number;
  user?: string;
  [key: string]: unknown;
}

export interface ModelInfo {
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
  description?: string;
  context_length?: number;
  max_context_tokens?: number;
  max_input_tokens?: number;
  max_output_tokens?: number;
  root?: string;
  parent?: string | null;
  permission?: unknown[];
  [key: string]: unknown;
}

export interface OpenAIError {
  error: {
    message: string;
    type: string;
    param: string | null;
    code: string | null;
  };
}
