export const PROVIDER_ID = 'antigravity';
export const models = {
    'gemini-3.7-flash': { name: 'Gemini 3.7 Flash', context: 1_000_000, output: 65_536 },
    'gemini-3.6-flash': { name: 'Gemini 3.6 Flash', context: 1_000_000, output: 65_536 },
    'gemini-3.5-flash': { name: 'Gemini 3.5 Flash', context: 1_000_000, output: 65_536 },
    'gemini-3.1-pro': { name: 'Gemini 3.1 Pro', context: 1_000_000, output: 65_535 },
    'claude-sonnet-4-6': { name: 'Claude Sonnet 4.6', context: 200_000, output: 64_000 },
    'claude-opus-4-6': { name: 'Claude Opus 4.6', context: 200_000, output: 64_000 },
    'gpt-oss-120b': { name: 'GPT-OSS 120B', context: 128_000, output: 32_768 },
};
const effortRouting = {
    'gemini-3.7-flash': {
        low: 'gemini-3.7-flash-low',
        medium: 'gemini-3.7-flash-medium',
        high: 'gemini-3.7-flash-high',
    },
    'gemini-3.6-flash': {
        low: 'gemini-3.6-flash-low',
        medium: 'gemini-3.6-flash-medium',
        high: 'gemini-3.6-flash-high',
    },
    'gemini-3.5-flash': {
        low: 'gemini-3.5-flash-low',
        medium: 'gemini-3.5-flash-low',
        high: 'gemini-3-flash-agent',
    },
    'gemini-3.1-pro': { low: 'gemini-3.1-pro-low', high: 'gemini-pro-agent' },
    'claude-sonnet-4-6': { high: 'claude-sonnet-4-6' },
    'claude-opus-4-6': { high: 'claude-opus-4-6-thinking' },
    'gpt-oss-120b': { medium: 'gpt-oss-120b-medium' },
};
export function resolveRuntimeModel(modelID, effort) {
    const route = effortRouting[modelID];
    if (!route)
        return modelID;
    return route[effort ?? ''] ?? route.medium ?? route.high ?? route.low ?? modelID;
}
