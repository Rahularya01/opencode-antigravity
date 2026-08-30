import { createAntigravity } from './index.js';
import { PROVIDER_ID } from './models.js';
export default {
    id: 'antigravity.provider',
    async setup(ctx) {
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
