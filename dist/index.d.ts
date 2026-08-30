import type { LanguageModelV3 } from '@ai-sdk/provider';
import { type AntigravityOptions } from './language-model.js';
export type CreateAntigravityOptions = AntigravityOptions;
export declare function createAntigravity(options?: CreateAntigravityOptions): {
    languageModel(modelId: string): LanguageModelV3;
};
