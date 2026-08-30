import { AntigravityLanguageModel } from './language-model.js';
export function createAntigravity(options = {}) {
    return {
        languageModel(modelId) {
            return new AntigravityLanguageModel(modelId, options);
        },
    };
}
