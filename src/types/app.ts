import type { ProviderConfig } from './router.js';

export interface AppVariables {
  providers: ProviderConfig[];
  requestId: string;
}

export interface AppEnv {
  Variables: AppVariables;
}
