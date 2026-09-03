import { antigravityEnv } from "./util.js";

const PREWARM_TIMEOUT_MS = 5_000;

/**
 * Thin wrapper around the runtime's fetch(). Bun/Node's fetch already
 * keeps connections alive and pools them per origin by default, so no
 * custom agent/dispatcher is configured here; this indirection exists so
 * callers have a single seam to instrument or swap later.
 */
export async function antigravityFetch(
  input: string | URL,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(input, init);
}

/**
 * Open the TLS connection when the extension loads so the first message of a session
 * does not pay the handshake either. Best-effort: failures are ignored.
 */
export function prewarmConnection(url: string): void {
  if (antigravityEnv("NO_PREWARM") === "1") return;
  void (async () => {
    try {
      const res = await antigravityFetch(url, {
        method: "HEAD",
        signal: AbortSignal.timeout(PREWARM_TIMEOUT_MS),
      });
      await res.arrayBuffer();
    } catch {
      // Warm-up only
    }
  })();
}
