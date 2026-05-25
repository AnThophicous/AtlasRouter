import { fallbackModels, routeProfiles } from '../config/models.js';
import { getProviderConfigs } from '../config/providers.js';
import { getProviderScore } from '../lib/provider-metrics.js';
import { isCapabilityMatch, toPublicModel, type PublicModel } from '../lib/openai.js';
import { fetchProviderModels as fetchUpstreamModels } from './provider-client.js';
import type { ProviderConfig, ProviderId, RouteCandidate, RouteProfile, RouteResolution, RoutedModel } from '../types/router.js';

type CacheEntry = {
  fetchedAt: number;
  models: RoutedModel[];
};

const cache = new Map<string, CacheEntry>();

function cacheKey(providerId: ProviderId): string {
  return providerId;
}

function inferCapabilities(provider: ProviderConfig, modelId: string) {
  const lower = modelId.toLowerCase();
  return {
    nativeProvider: provider.id,
    chat: provider.capabilities.chat,
    streaming: provider.capabilities.streaming,
    tools: provider.capabilities.tools,
    reasoning: provider.capabilities.reasoning && !lower.includes('no-thinking'),
    vision: provider.capabilities.vision || lower.includes('vision') || lower.includes('vl'),
    files: provider.capabilities.files
  };
}

function normalizeModel(provider: ProviderConfig, raw: any): RoutedModel {
  const now = Math.floor(Date.now() / 1000);
  const id = String(raw.id ?? raw.model ?? raw.name ?? '');
  const contextLength = Number(raw.context_length ?? raw.max_context_tokens ?? raw.max_input_tokens);
  const maxOutputTokens = Number(raw.max_output_tokens);
  const model: RoutedModel = {
    id,
    object: 'model',
    created: Number(raw.created ?? raw.created_at ?? now),
    owned_by: String(raw.owned_by ?? provider.id),
    root: raw.root ?? id,
    parent: raw.parent ?? null,
    permission: raw.permission ?? [],
    providerId: provider.id,
    upstreamModel: id,
    aliases: [`${provider.id}/${id}`],
    source: 'remote',
    priority: provider.priority,
    capabilities: inferCapabilities(provider, id)
  };

  if (typeof raw.description === 'string') model.description = raw.description;
  if (Number.isFinite(contextLength)) {
    model.context_length = contextLength;
    model.max_context_tokens = contextLength;
    model.max_input_tokens = contextLength;
  }
  if (Number.isFinite(maxOutputTokens)) model.max_output_tokens = maxOutputTokens;

  return model;
}

async function loadProviderModels(provider: ProviderConfig): Promise<RoutedModel[]> {
  const cached = cache.get(cacheKey(provider.id));
  if (cached && Date.now() - cached.fetchedAt < provider.modelCacheTtlMs) {
    return cached.models;
  }

  try {
    const payload = await fetchUpstreamModels(provider);
    const models = payload.data.map((item) => normalizeModel(provider, item)).filter((model) => model.id.length > 0);
    cache.set(cacheKey(provider.id), { fetchedAt: Date.now(), models });
    return models;
  } catch {
    const models = fallbackModels.filter((model) => model.providerId === provider.id);
    cache.set(cacheKey(provider.id), { fetchedAt: Date.now(), models });
    return models;
  }
}

export async function listModels(): Promise<RoutedModel[]> {
  const providers = getProviderConfigs();
  const enabledProviderIds = new Set(providers.map((provider) => provider.id));
  const modelGroups = await Promise.all(providers.map((provider) => loadProviderModels(provider)));
  const flattened = modelGroups.flat();
  const merged = new Map<string, RoutedModel>();

  for (const model of [...fallbackModels.filter((item) => enabledProviderIds.has(item.providerId)), ...flattened]) {
    merged.set(model.id, model);
    for (const alias of model.aliases) {
      merged.set(alias, { ...model, id: alias });
    }
  }

  return [...merged.values()].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
}

export async function listPublicModels(): Promise<PublicModel[]> {
  const models = await listModels();
  const enabledProviderIds = new Set(getProviderConfigs().map((provider) => provider.id));
  const seen = new Set<string>();
  const publicModels: PublicModel[] = [];
  const profiles = routeProfiles.filter((profile) => profile.allowedProviders.some((providerId) => enabledProviderIds.has(providerId)));

  for (const model of [...models.filter((item) => item.id === item.root), ...profiles]) {
    if (seen.has(model.id)) continue;
    seen.add(model.id);
    publicModels.push(toPublicModel(model));
  }

  return publicModels;
}

export async function listDetailedModels(): Promise<Array<RoutedModel | RouteProfile>> {
  const models = await listModels();
  const enabledProviderIds = new Set(getProviderConfigs().map((provider) => provider.id));
  const profiles = routeProfiles.filter((profile) => profile.allowedProviders.some((providerId) => enabledProviderIds.has(providerId)));
  return [...models.filter((item) => item.id === item.root), ...profiles];
}

function findProfile(modelId: string): RouteProfile | undefined {
  return routeProfiles.find((profile) => profile.id === modelId || profile.aliases.includes(modelId));
}

function uniqueCandidates(candidates: RouteCandidate[]): RouteCandidate[] {
  const seen = new Set<string>();
  const unique: RouteCandidate[] = [];

  for (const candidate of candidates) {
    const key = `${candidate.provider.id}:${candidate.model.upstreamModel}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(candidate);
  }

  return unique;
}

function candidateForModel(providers: ProviderConfig[], model: RoutedModel): RouteCandidate | null {
  const provider = providers.find((item) => item.id === model.providerId);
  if (!provider) return null;
  return { provider, model };
}

function candidateRank(candidate: RouteCandidate): number {
  return getProviderScore(candidate.provider.id);
}

function sortCandidates(candidates: RouteCandidate[]): RouteCandidate[] {
  return uniqueCandidates(candidates).sort((a, b) => {
    const scoreDelta = candidateRank(b) - candidateRank(a);
    if (scoreDelta !== 0) return scoreDelta;
    const priorityDelta = a.provider.priority - b.provider.priority;
    if (priorityDelta !== 0) return priorityDelta;
    return a.model.priority - b.model.priority;
  });
}

function profileCandidates(profile: RouteProfile, providers: ProviderConfig[], models: RoutedModel[]): RouteCandidate[] {
  const allowedProviders = new Set(profile.allowedProviders);
  const preferred = profile.preferredModels
    .flatMap((id) => models.filter((model) => model.id === id || model.aliases.includes(id)))
    .map((model) => candidateForModel(providers, model))
    .filter((candidate): candidate is RouteCandidate => candidate !== null);

  if (profile.strictPreferredModels && preferred.length > 0) {
    return sortCandidates(preferred);
  }

  const matching = models
    .filter((model) => allowedProviders.has(model.providerId))
    .filter((model) => isCapabilityMatch(model.capabilities, profile.requiredCapabilities))
    .map((model) => candidateForModel(providers, model))
    .filter((candidate): candidate is RouteCandidate => candidate !== null);

  return sortCandidates([...preferred, ...matching]);
}

export async function resolveRoute(modelId: string): Promise<RouteResolution | null> {
  const providers = getProviderConfigs();
  const models = await listModels();
  const profile = findProfile(modelId);

  if (profile) {
    const candidates = profileCandidates(profile, providers, models);
    return candidates.length > 0 ? { requestedModel: modelId, candidates, profile } : null;
  }

  const model = models.find((item) => item.id === modelId || item.aliases.includes(modelId));
  if (!model) return null;

  const candidate = candidateForModel(providers, model);
  if (!candidate) return null;

  return {
    requestedModel: modelId,
    candidates: [candidate]
  };
}
