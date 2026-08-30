type HookEvent = {
    model: {
        providerID: string;
        api: {
            id: string;
        };
    };
    options: Record<string, unknown>;
    sdk?: {
        languageModel(modelID: string): unknown;
    };
    language?: unknown;
};
type HookContext = {
    aisdk: {
        sdk(callback: (event: HookEvent) => void): Promise<void>;
        language(callback: (event: HookEvent) => void): Promise<void>;
    };
};
declare const _default: {
    id: string;
    setup(ctx: HookContext): Promise<void>;
};
export default _default;
