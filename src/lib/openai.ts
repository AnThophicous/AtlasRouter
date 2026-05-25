import type { ModelInfo } from '../types/openai.js';
import type { ModelCapabilities, RouteProfile, RoutedModel } from '../types/router.js';

export interface PublicModel extends ModelInfo {
  provider?: string;
  capabilities?: ModelCapabilities;
}

export function toPublicModel(model: RoutedModel | RouteProfile): PublicModel {
  const base: PublicModel = {
    id: model.id,
    object: 'model',
    created: model.created,
    owned_by: model.owned_by,
    root: model.root ?? model.id,
    parent: model.parent ?? null,
    permission: model.permission ?? [],
    capabilities: model.capabilities
  };

  if ('providerId' in model) {
    base.provider = (model as RoutedModel).providerId;
  }

  if (model.description) base.description = model.description;
  if (model.context_length) base.context_length = model.context_length;
  if (model.max_context_tokens) base.max_context_tokens = model.max_context_tokens;
  if (model.max_input_tokens) base.max_input_tokens = model.max_input_tokens;
  if (model.max_output_tokens) base.max_output_tokens = model.max_output_tokens;

  return base;
}

export function isCapabilityMatch(
  capabilities: ModelCapabilities,
  required: Partial<ModelCapabilities>
): boolean {
  for (const [key, value] of Object.entries(required)) {
    if (value === undefined) continue;
    if (((capabilities as unknown) as Record<string, unknown>)[key] !== value) return false;
  }
  return true;
}
