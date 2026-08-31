export const PROVIDER_ID = 'antigravity';

export const models = {
  'gemini-3.7-flash': { name: 'Gemini 3.7 Flash', context: 1_000_000, output: 65_536 },
  'gemini-3.6-flash': { name: 'Gemini 3.6 Flash', context: 1_000_000, output: 65_536 },
  'gemini-3.5-flash': { name: 'Gemini 3.5 Flash', context: 1_000_000, output: 65_536 },
  'gemini-3.1-pro': { name: 'Gemini 3.1 Pro', context: 1_000_000, output: 65_535 },
  'claude-sonnet-4-6': { name: 'Claude Sonnet 4.6', context: 200_000, output: 64_000 },
  'claude-opus-4-6': { name: 'Claude Opus 4.6', context: 200_000, output: 64_000 },
  'gpt-oss-120b': { name: 'GPT-OSS 120B', context: 128_000, output: 32_768 },
} as const;

export type PublicModelId = keyof typeof models;

const effortRouting: Record<string, Record<string, string>> = {
  'gemini-3.7-flash': {
    off: 'gemini-3.7-flash-low',
    low: 'gemini-3.7-flash-low',
    medium: 'gemini-3.7-flash-medium',
    high: 'gemini-3.7-flash-high',
    xhigh: 'gemini-3.7-flash-high',
  },
  'gemini-3.6-flash': {
    off: 'gemini-3.6-flash-low',
    low: 'gemini-3.6-flash-low',
    medium: 'gemini-3.6-flash-medium',
    high: 'gemini-3.6-flash-high',
    xhigh: 'gemini-3.6-flash-high',
  },
  'gemini-3.5-flash': {
    off: 'gemini-3.5-flash-extra-low',
    low: 'gemini-3.5-flash-extra-low',
    medium: 'gemini-3.5-flash-low',
    high: 'gemini-3-flash-agent',
    xhigh: 'gemini-3-flash-agent',
  },
  'gemini-3.1-pro': {
    off: 'gemini-3.1-pro-low',
    low: 'gemini-3.1-pro-low',
    high: 'gemini-pro-agent',
    xhigh: 'gemini-pro-agent',
  },
  'claude-sonnet-4-6': { high: 'claude-sonnet-4-6' },
  'claude-opus-4-6': { high: 'claude-opus-4-6-thinking' },
  'gpt-oss-120b': { medium: 'gpt-oss-120b-medium' },
};

export function resolveRuntimeModel(modelID: string, effort?: string): string {
  const route = effortRouting[modelID];
  if (!route) return modelID;
  const key = effort && effort !== 'off' ? effort : 'off';
  return route[key] ?? route.medium ?? route.high ?? route.low ?? route.off ?? modelID;
}

export function getFallbackRuntimeModel(runtimeModel: string): string | undefined {
  if (runtimeModel.startsWith('gemini-3.7-flash-')) {
    return runtimeModel.replace('gemini-3.7-flash-', 'gemini-3.6-flash-');
  }
  if (runtimeModel === 'gemini-3.7-flash') return 'gemini-3.6-flash-low';
  return undefined;
}

export function getMaxOutputTokens(modelId: string, runtimeModel?: string): number {
  const id = runtimeModel || modelId;
  if (id.startsWith('claude-')) return 64000;
  if (id.startsWith('gpt-oss-')) return 32768;
  if (id.startsWith('gemini-3.1-pro') || id === 'gemini-pro-agent') return 65535;
  if (id.startsWith('gemini-')) return 65536;
  return models[modelId as PublicModelId]?.output ?? 8192;
}

export type ThinkingWire = {
  includeThoughts: boolean;
  thinkingLevel?: 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH';
  thinkingBudget?: number;
};

function googleLevel(effort: string | undefined): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (effort === 'high' || effort === 'xhigh') return 'HIGH';
  if (effort === 'medium') return 'MEDIUM';
  return 'LOW';
}

export function getThinkingConfig(
  modelId: string,
  effort: string | undefined,
): ThinkingWire | undefined {
  if (modelId === 'gemini-3.7-flash' || modelId === 'gemini-3.6-flash') {
    return { includeThoughts: true, thinkingLevel: googleLevel(effort) };
  }
  if (modelId === 'gemini-3.5-flash') {
    if (!effort || effort === 'off') return { includeThoughts: false, thinkingBudget: 0 };
    const thinkingBudget =
      effort === 'high' || effort === 'xhigh' ? 10_000 : effort === 'medium' ? 4_000 : 1_000;
    return { includeThoughts: true, thinkingBudget };
  }
  if (modelId === 'gemini-3.1-pro') {
    if (!effort || effort === 'off') return { includeThoughts: false, thinkingBudget: 0 };
    return {
      includeThoughts: true,
      thinkingBudget: effort === 'high' || effort === 'xhigh' ? 10_001 : 1_001,
    };
  }
  return undefined;
}
