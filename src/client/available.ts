import type { AvailableModelsRaw, ModelInfoRaw } from "../models/types.js";
import { isRecord } from "../utils/util.js";
import { antigravityFetch } from "../utils/http.js";
import { antigravityHeaders, endpointCandidates, jsonOrTextError } from "./client.js";

const DISCOVERY_TIMEOUT_MS = 8000;

export type InternalJsonResult = {
  endpoint: string;
  status: number;
  data: unknown;
};

function jsonHeaders(token: string): Record<string, string> {
  return {
    ...antigravityHeaders(token),
    Accept: "application/json",
  };
}

export async function postInternalJson(
  path: string,
  token: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<InternalJsonResult> {
  let lastErrorText = "";
  const timeout = AbortSignal.timeout(DISCOVERY_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  for (const endpoint of endpointCandidates()) {
    try {
      const res = await antigravityFetch(`${endpoint}${path}`, {
        method: "POST",
        headers: jsonHeaders(token),
        body: JSON.stringify(body),
        signal: combined,
      });
      const text = await res.text();
      let data: unknown;
      try {
        data = JSON.parse(text) as unknown;
      } catch {
        data = { raw: text };
      }
      if (!res.ok) {
        lastErrorText = jsonOrTextError(text).slice(0, 300);
        if (![403, 404, 429, 500, 502, 503, 504].includes(res.status)) {
          throw new Error(`${path} failed (${String(res.status)}): ${lastErrorText}`);
        }
        continue;
      }
      return { endpoint, status: res.status, data };
    } catch (error) {
      lastErrorText = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(`${path} failed: ${lastErrorText || "no endpoint available"}`);
}

export function extractModelsMap(data: unknown): Record<string, ModelInfoRaw> {
  if (!isRecord(data) || !isRecord(data.models)) return {};
  const out: Record<string, ModelInfoRaw> = {};
  for (const [id, info] of Object.entries(data.models)) {
    if (isRecord(info)) out[id] = info as ModelInfoRaw;
  }
  return out;
}

export function mergeAvailableModelsResults(
  results: Array<InternalJsonResult | undefined>,
): AvailableModelsRaw {
  const merged: Record<string, ModelInfoRaw> = {};
  let defaultAgentModelId: unknown;
  let defaultAgentModel: unknown;
  for (const result of results) {
    if (!result) continue;
    const map = extractModelsMap(result.data);
    Object.assign(merged, map);
    if (isRecord(result.data)) {
      if (result.data.defaultAgentModelId !== undefined) {
        defaultAgentModelId = result.data.defaultAgentModelId;
      }
      if (result.data.defaultAgentModel !== undefined) {
        defaultAgentModel = result.data.defaultAgentModel;
      }
    }
  }
  return { models: merged, defaultAgentModelId, defaultAgentModel };
}

async function fetchAvailableModelsFromEndpoint(
  endpoint: string,
  token: string,
  projectId: string,
  signal?: AbortSignal,
): Promise<InternalJsonResult | undefined> {
  try {
    const timeout = AbortSignal.timeout(DISCOVERY_TIMEOUT_MS);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const res = await antigravityFetch(`${endpoint}/v1internal:fetchAvailableModels`, {
      method: "POST",
      headers: jsonHeaders(token),
      body: JSON.stringify({ project: projectId }),
      signal: combined,
    });
    const text = await res.text();
    let data: unknown;
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      data = { raw: text };
    }
    if (!res.ok) return undefined;
    return { endpoint, status: res.status, data };
  } catch {
    return undefined;
  }
}

export async function fetchAvailableModelsCatalog(
  token: string,
  projectId: string,
  signal?: AbortSignal,
): Promise<AvailableModelsRaw> {
  const results = await Promise.all(
    endpointCandidates().map((endpoint) =>
      fetchAvailableModelsFromEndpoint(endpoint, token, projectId, signal),
    ),
  );
  const merged = mergeAvailableModelsResults(results);
  if (!merged.models || Object.keys(merged.models).length === 0) {
    throw new Error("/v1internal:fetchAvailableModels failed: no endpoint available");
  }
  return merged;
}
