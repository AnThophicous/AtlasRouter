import type { CapabilitySet, ModelCapabilities, ProviderId, RouteProfile, RouteStrategy, RoutedModel } from '../types/router.js';

function created(): number {
  return Math.floor(Date.now() / 1000);
}

function capabilitySet(providerId: ProviderId, value: Partial<CapabilitySet>): ModelCapabilities {
  return {
    nativeProvider: providerId,
    chat: true,
    streaming: true,
    tools: value.tools ?? false,
    reasoning: value.reasoning ?? false,
    vision: value.vision ?? false,
    files: value.files ?? false
  };
}

function model(
  id: string,
  providerId: ProviderId,
  upstreamModel: string,
  value: {
    aliases?: string[];
    ownedBy?: string;
    priority?: number;
    capabilities?: Partial<CapabilitySet>;
    description?: string;
    contextLength?: number;
    maxOutputTokens?: number;
  } = {}
): RoutedModel {
  const next: RoutedModel = {
    id,
    object: 'model',
    created: created(),
    owned_by: value.ownedBy ?? providerId,
    providerId,
    upstreamModel,
    aliases: value.aliases ?? [],
    permission: [],
    root: id,
    parent: null,
    source: 'static',
    priority: value.priority ?? 100,
    capabilities: capabilitySet(providerId, value.capabilities ?? {})
  };

  if (value.description) next.description = value.description;
  if (value.contextLength !== undefined) {
    next.context_length = value.contextLength;
    next.max_context_tokens = value.contextLength;
    next.max_input_tokens = value.contextLength;
  }
  if (value.maxOutputTokens !== undefined) next.max_output_tokens = value.maxOutputTokens;

  return next;
}

export const fallbackModels: RoutedModel[] = [
  model('deepseek-v4-flash', 'deeps', 'deepseek-v4-flash', {
    aliases: ['deeps/deepseek-v4-flash', 'deepseek-flash'],
    ownedBy: 'deepseek',
    priority: 10,
    capabilities: { tools: true },
    maxOutputTokens: 8000
  }),
  model('deepseek-v4-flash-thinking', 'deeps', 'deepseek-v4-flash-thinking', {
    aliases: ['deeps/deepseek-v4-flash-thinking', 'deepseek-flash-thinking', 'deepseek-thinking'],
    ownedBy: 'deepseek',
    priority: 11,
    capabilities: { tools: true, reasoning: true },
    maxOutputTokens: 8000
  }),
  model('deepseek-v4-pro', 'deeps', 'deepseek-v4-pro', {
    aliases: ['deeps/deepseek-v4-pro', 'deepseek-pro'],
    ownedBy: 'deepseek',
    priority: 12,
    capabilities: { tools: true },
    maxOutputTokens: 8000
  }),
  model('deepseek-v4-pro-thinking', 'deeps', 'deepseek-v4-pro-thinking', {
    aliases: ['deeps/deepseek-v4-pro-thinking', 'deepseek-pro-thinking'],
    ownedBy: 'deepseek',
    priority: 13,
    capabilities: { tools: true, reasoning: true },
    maxOutputTokens: 8000
  }),
  model('qwen-plus', 'qwen', 'qwen-plus', {
    aliases: ['qwen/qwen-plus'],
    ownedBy: 'qwen',
    priority: 20,
    capabilities: { tools: true, reasoning: true }
  }),
  model('qwen-plus-no-thinking', 'qwen', 'qwen-plus-no-thinking', {
    aliases: ['qwen/qwen-plus-no-thinking'],
    ownedBy: 'qwen',
    priority: 21,
    capabilities: { tools: true }
  }),
  model('qwen3.6-plus', 'qwen', 'qwen3.6-plus', {
    aliases: ['qwen/qwen3.6-plus'],
    ownedBy: 'qwen',
    priority: 22,
    capabilities: { tools: true, reasoning: true }
  }),
  model('qwen3.6-plus-no-thinking', 'qwen', 'qwen3.6-plus-no-thinking', {
    aliases: ['qwen/qwen3.6-plus-no-thinking'],
    ownedBy: 'qwen',
    priority: 23,
    capabilities: { tools: true }
  }),
  model('k2d6', 'kimi', 'k2d6', {
    aliases: ['kimi/k2d6', 'kimi'],
    ownedBy: 'kimi',
    priority: 30,
    capabilities: { tools: true }
  }),
  model('k2d6-thinking', 'kimi', 'k2d6-thinking', {
    aliases: ['kimi/k2d6-thinking', 'kimi-thinking'],
    ownedBy: 'kimi',
    priority: 31,
    capabilities: { tools: true, reasoning: true }
  }),
  model('mimo-v2.5-pro', 'mimo', 'mimo-v2.5-pro', {
    aliases: ['mimo/mimo-v2.5-pro', 'mimo'],
    ownedBy: 'xiaomi',
    priority: 40,
    capabilities: { tools: true, reasoning: true, vision: true, files: true }
  }),
  model('glm-4.7', 'z2api', 'glm-4.7', {
    aliases: ['zai/glm-4.7', 'z2api/glm-4.7'],
    ownedBy: 'z.ai',
    priority: 50,
    capabilities: { reasoning: true, vision: true }
  })
];

function profile(
  id: string,
  aliases: string[],
  preferredModels: string[],
  requiredCapabilities: Partial<CapabilitySet>,
  allowedProviders: ProviderId[],
  strictPreferredModels = false,
  strategy: RouteStrategy = 'route',
  minCompetitors = 1,
  maxCompetitors = 1
): RouteProfile {
  return {
    id,
    object: 'model',
    created: created(),
    owned_by: 'atlasrouter',
    root: id,
    parent: null,
    permission: [],
    source: 'virtual',
    aliases,
    preferredModels,
    requiredCapabilities,
    allowedProviders,
    strictPreferredModels,
    strategy,
    minCompetitors,
    maxCompetitors,
    capabilities: {
      nativeProvider: 'atlas',
      chat: true,
      streaming: true,
      tools: requiredCapabilities.tools ?? true,
      reasoning: requiredCapabilities.reasoning ?? false,
      vision: requiredCapabilities.vision ?? false,
      files: requiredCapabilities.files ?? false
    }
  };
}

export const routeProfiles: RouteProfile[] = [
  profile('atlas/auto', ['auto'], ['deepseek-v4-flash', 'qwen3.6-plus-no-thinking', 'k2d6'], {}, ['deeps', 'qwen', 'kimi', 'mimo', 'z2api'], true),
  profile('atlas/compeat', ['compeat', 'compete', 'smart'], ['deepseek-v4-flash', 'qwen3.6-plus-no-thinking', 'k2d6'], {}, ['deeps', 'qwen', 'kimi'], true, 'compeat', 2, 3),
  profile('atlas/fast', ['fast'], ['deepseek-v4-flash', 'qwen-plus-no-thinking', 'k2d6'], {}, ['deeps', 'qwen', 'kimi']),
  profile('atlas/reasoning', ['reasoning'], ['deepseek-v4-pro-thinking', 'qwen-plus', 'k2d6-thinking', 'glm-4.7'], { reasoning: true }, ['deeps', 'qwen', 'kimi', 'z2api']),
  profile('atlas/tools', ['tools'], ['deepseek-v4-pro-thinking', 'qwen-plus', 'k2d6-thinking', 'mimo-v2.5-pro'], { tools: true }, ['deeps', 'qwen', 'kimi', 'mimo']),
  profile('atlas/vision', ['vision'], ['mimo-v2.5-pro', 'glm-4.7'], { vision: true }, ['mimo', 'z2api'])
];
