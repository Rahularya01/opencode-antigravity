import type { PluginContext } from '@opencode-ai/plugin/v2/promise';
import { createAntigravity } from './index.js';
import { models, PROVIDER_ID } from './models.js';

export default {
  id: 'antigravity.provider',
  async setup(ctx: PluginContext) {
    await ctx.catalog.transform((draft) => {
      draft.provider.update(PROVIDER_ID, (provider) => {
        provider.name = 'Antigravity';
      });
      for (const [id, info] of Object.entries(models)) {
        draft.model.update(PROVIDER_ID, id, (model) => {
          model.name = info.name;
          model.enabled = true;
          model.status = 'active';
          model.limit = { context: info.context, output: info.output };
        });
      }
    });
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
