import { fetchAvailableModelsCatalog } from "../client/available.js";
import { resolveProjectId } from "../client/client.js";
import { applyDiscoveredRouting } from "./models.js";
import { fallbackModelConfig } from "./catalog.js";
import { buildOpenCodeCatalog } from "./grouping.js";
import type { OpenCodeModelConfig } from "./types.js";

export async function loadLiveOpenCodeModels(
  token: string,
  explicitProjectId?: string,
  signal?: AbortSignal,
): Promise<Record<string, OpenCodeModelConfig>> {
  const projectId = await resolveProjectId(token, explicitProjectId);
  const available = await fetchAvailableModelsCatalog(token, projectId, signal);
  const catalog = buildOpenCodeCatalog(available.models ?? {});
  applyDiscoveredRouting(catalog.routing);
  return catalog.models;
}

export function staticOpenCodeModels(): Record<string, OpenCodeModelConfig> {
  return fallbackModelConfig();
}
