export declare const PROVIDER_ID = "antigravity";
export declare const models: {
    readonly 'gemini-3.7-flash': {
        readonly name: "Gemini 3.7 Flash";
        readonly context: 1000000;
        readonly output: 65536;
    };
    readonly 'gemini-3.6-flash': {
        readonly name: "Gemini 3.6 Flash";
        readonly context: 1000000;
        readonly output: 65536;
    };
    readonly 'gemini-3.5-flash': {
        readonly name: "Gemini 3.5 Flash";
        readonly context: 1000000;
        readonly output: 65536;
    };
    readonly 'gemini-3.1-pro': {
        readonly name: "Gemini 3.1 Pro";
        readonly context: 1000000;
        readonly output: 65535;
    };
    readonly 'claude-sonnet-4-6': {
        readonly name: "Claude Sonnet 4.6";
        readonly context: 200000;
        readonly output: 64000;
    };
    readonly 'claude-opus-4-6': {
        readonly name: "Claude Opus 4.6";
        readonly context: 200000;
        readonly output: 64000;
    };
    readonly 'gpt-oss-120b': {
        readonly name: "GPT-OSS 120B";
        readonly context: 128000;
        readonly output: 32768;
    };
};
export declare function resolveRuntimeModel(modelID: string, effort?: string): string;
