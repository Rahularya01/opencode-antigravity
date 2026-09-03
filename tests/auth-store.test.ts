import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  opencodeAuthPath,
  parseAuthFile,
  resolveCatalogAccessToken,
  resetCatalogAccessTokenCache,
  tokenFromStoredAuth,
} from "../src/opencode/auth-store.js";
import { TOKEN_URL } from "../src/auth/oauth.js";

const originalFetch = globalThis.fetch;
const originalXdg = process.env.XDG_DATA_HOME;
const antigravityEnvKeys = [
  "OPENCODE_ANTIGRAVITY_ACCESS_TOKEN",
  "ANTIGRAVITY_ACCESS_TOKEN",
  "NOAGY_ACCESS_TOKEN",
  "GOOGLE_ACCESS_TOKEN",
  "CLOUDSDK_AUTH_ACCESS_TOKEN",
];
let saved: Record<string, string | undefined> = {};
let dataHome: string;

function writeAuth(entry: unknown): void {
  const dir = join(dataHome, "opencode");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "auth.json"), JSON.stringify({ antigravity: entry }));
}

beforeEach(() => {
  dataHome = mkdtempSync(join(tmpdir(), "antigravity-auth-"));
  process.env.XDG_DATA_HOME = dataHome;
  // An env token short-circuits the store, which is not what these cover.
  saved = Object.fromEntries(antigravityEnvKeys.map((k) => [k, process.env[k]]));
  for (const key of antigravityEnvKeys) delete process.env[key];
  resetCatalogAccessTokenCache();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  mock.restore();
  rmSync(dataHome, { recursive: true, force: true });
  if (originalXdg === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = originalXdg;
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetCatalogAccessTokenCache();
});

describe("OpenCode auth store", () => {
  it("resolves the auth.json path under XDG_DATA_HOME", () => {
    expect(opencodeAuthPath()).toBe(join(dataHome, "opencode", "auth.json"));
  });

  it("refreshes an expired token once and serves the rest from cache", async () => {
    // Without caching this runs per model request: a synchronous file read plus
    // a refresh against Google, because auth.json still holds the expired token
    // this process already replaced.
    writeAuth({
      type: "oauth",
      access: "stale-access",
      refresh: "refresh-token",
      expires: Date.now() - 1000,
    });

    const fetchMock = mock(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(JSON.stringify({ access_token: "fresh-access", expires_in: 3600 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const first = await resolveCatalogAccessToken();
    const second = await resolveCatalogAccessToken();
    const third = await resolveCatalogAccessToken();

    expect([first, second, third]).toEqual(["fresh-access", "fresh-access", "fresh-access"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // The cheap refresh only: project discovery is a separate round trip.
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(TOKEN_URL);

    const persisted = JSON.parse(readFileSync(join(dataHome, "opencode", "auth.json"), "utf8"));
    expect(persisted.antigravity.access).toBe("fresh-access");
    expect(persisted.antigravity.refresh).toBe("refresh-token");
    expect(persisted.antigravity.expires).toBeGreaterThan(Date.now());
  });

  it("writes a rotated refresh token back to auth.json", async () => {
    writeAuth({
      type: "oauth",
      access: "stale-access",
      refresh: "old-refresh",
      expires: Date.now() - 1000,
      email: "user@example.com",
    });

    globalThis.fetch = mock(
      async () =>
        new Response(
          JSON.stringify({
            access_token: "fresh-access",
            refresh_token: "new-refresh",
            expires_in: 3600,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    ) as unknown as typeof fetch;

    expect(await resolveCatalogAccessToken()).toBe("fresh-access");
    const persisted = JSON.parse(readFileSync(join(dataHome, "opencode", "auth.json"), "utf8"));
    expect(persisted.antigravity.refresh).toBe("new-refresh");
    expect(persisted.antigravity.email).toBe("user@example.com");
  });

  it("shares a single refresh between concurrent callers", async () => {
    writeAuth({
      type: "oauth",
      access: "stale-access",
      refresh: "refresh-token",
      expires: Date.now() - 1000,
    });

    const fetchMock = mock(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return new Response(JSON.stringify({ access_token: "fresh-access", expires_in: 3600 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const results = await Promise.all([
      resolveCatalogAccessToken(),
      resolveCatalogAccessToken(),
      resolveCatalogAccessToken(),
    ]);

    expect(results).toEqual(["fresh-access", "fresh-access", "fresh-access"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not refresh a token that is still valid", async () => {
    writeAuth({
      type: "oauth",
      access: "good-access",
      refresh: "refresh-token",
      expires: Date.now() + 60 * 60 * 1000,
    });
    const fetchMock = mock(async () => new Response("{}", { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    expect(await resolveCatalogAccessToken()).toBe("good-access");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the existing token when the refresh fails", async () => {
    const auth = parseAuthFile(
      JSON.stringify({
        antigravity: {
          type: "oauth",
          access: "stale-access",
          refresh: "refresh-token",
          expires: Date.now() - 1000,
        },
      }),
    );
    globalThis.fetch = mock(async () => new Response("nope", { status: 400 })) as never;

    expect(auth).toBeDefined();
    expect((await tokenFromStoredAuth(auth!))?.token).toBe("stale-access");
  });

  it("returns undefined when no auth file exists", async () => {
    expect(await resolveCatalogAccessToken()).toBeUndefined();
  });
});
