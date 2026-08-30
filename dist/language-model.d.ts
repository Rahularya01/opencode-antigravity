import type { LanguageModelV3, LanguageModelV3CallOptions, LanguageModelV3GenerateResult, LanguageModelV3StreamResult } from '@ai-sdk/provider';
export type AntigravityOptions = {
    apiKey?: string;
    baseURL?: string;
};
/** AI SDK adapter for the Cloud Code Assist streamGenerateContent endpoint. */
export declare class AntigravityLanguageModel implements LanguageModelV3 {
    readonly modelId: string;
    private readonly options;
    readonly specificationVersion: "v3";
    readonly provider = "antigravity";
    readonly supportedUrls: {};
    constructor(modelId: string, options: AntigravityOptions);
    doGenerate(options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult>;
    doStream(options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult>;
}
