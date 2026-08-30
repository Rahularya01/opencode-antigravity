import type { LanguageModelV3 } from '@ai-sdk/provider';
import { AntigravityLanguageModel, type AntigravityOptions } from './language-model.js';

export type CreateAntigravityOptions = AntigravityOptions;

export function createAntigravity(options: CreateAntigravityOptions = {}) {
  return {
    languageModel(modelId: string): LanguageModelV3 {
      return new AntigravityLanguageModel(modelId, options);
    },
  };
}
