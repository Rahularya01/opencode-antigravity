import { createAntigravity } from './index.js';
import { PROVIDER_ID } from './models.js';

type HookEvent = {
  model: { providerID: string; api: { id: string } };
  options: Record<string, unknown>;
  sdk?: { languageModel(modelID: string): unknown };
  language?: unknown;
};
type HookContext = {
  aisdk: {
    sdk(callback: (event: HookEvent) => void): Promise<void>;
    language(callback: (event: HookEvent) => void): Promise<void>;
  };
};

export default {
  id: 'antigravity.provider',
  async setup(ctx: HookContext) {
    await ctx.aisdk.sdk((event) => {
      if (!event.sdk && event.model.providerID === PROVIDER_ID)
        event.sdk = createAntigravity(event.options);
    });
    await ctx.aisdk.language((event) => {
      if (!event.language && event.model.providerID === PROVIDER_ID && event.sdk)
        event.language = event.sdk.languageModel(event.model.api.id);
    });
  },
};
