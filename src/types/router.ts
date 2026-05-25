import type { ModelInfo, OpenAIRequest } from './openai.js';

export type ProviderId = 'deeps' | 'qwen' | 'kimi' | 'mimo' | 'z2api';
export type ProviderStatusState = 'online' | 'offline' | 'degraded' | 'disabled';
export type ModelSource = 'static' | 'remote' | 'virtual';
export type RouteStrategy = 'route' | 'compeat';

export interface CapabilitySet {
  chat: boolean;
  streaming: boolean;
  tools: boolean;
  reasoning: boolean;
  vision: boolean;
  files: boolean;
}

export interface ProviderConfig {
  id: ProviderId;
  name: string;
  baseUrl: string;
  apiKey?: string | undefined;
  enabled: boolean;
  priority: number;
  maxConcurrent: number;
  queueTimeoutMs: number;
  timeoutMs: number;
  healthTimeoutMs: number;
  modelCacheTtlMs: number;
  maxRetries: number;
  retryDelayMs: number;
  forwardAuthorization: boolean;
  healthPath: string;
  modelsPath: string;
  chatPath: string;
  capabilities: CapabilitySet;
}

export interface ModelCapabilities extends CapabilitySet {
  nativeProvider: ProviderId | 'atlas';
}

export interface RoutedModel extends ModelInfo {
  providerId: ProviderId;
  upstreamModel: string;
  aliases: string[];
  source: ModelSource;
  priority: number;
  capabilities: ModelCapabilities;
}

export interface RouteProfile extends ModelInfo {
  source: 'virtual';
  aliases: string[];
  preferredModels: string[];
  requiredCapabilities: Partial<CapabilitySet>;
  allowedProviders: ProviderId[];
  strictPreferredModels?: boolean;
  strategy: RouteStrategy;
  minCompetitors: number;
  maxCompetitors: number;
  capabilities: ModelCapabilities;
}

export interface RouteCandidate {
  provider: ProviderConfig;
  model: RoutedModel;
}

export interface RouteResolution {
  requestedModel: string;
  candidates: RouteCandidate[];
  profile?: RouteProfile | undefined;
}

export interface ProviderStatus {
  id: ProviderId;
  name: string;
  baseUrl: string;
  status: ProviderStatusState;
  latencyMs: number | null;
  models: number;
  error: string | null;
  checkedAt: number;
  score: number;
  successCount: number;
  failureCount: number;
  consecutiveFailures: number;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  circuitOpenUntil: number | null;
}

export interface UpstreamAttempt {
  providerId: ProviderId;
  model: string;
  upstreamModel: string;
  status: number | null;
  latencyMs: number | null;
  queueWaitMs: number | null;
  error: string | null;
}

export interface ChatRouteResult {
  response: Response;
  attempts: UpstreamAttempt[];
}

export interface ChatRequestContext {
  body: OpenAIRequest;
  headers: Headers;
  requestId: string;
  deadlineAt: number;
}
