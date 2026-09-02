import { afterEach, describe, expect, it, mock } from "bun:test";
import {
  generatePKCE,
  refreshAntigravityAccessToken,
  sanitizeOAuthProviderError,
  CLIENT_ID,
  CLIENT_SECRET,
  SCOPES,
  REDIRECT_URI,
  TOKEN_URL,
} from "../src/auth/oauth.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  mock.restore();
});

describe("Antigravity OAuth", () => {
  it("generates valid PKCE code_verifier and code_challenge", () => {
    const { verifier, challenge } = generatePKCE();
    expect(verifier).toBeDefined();
    expect(challenge).toBeDefined();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(challenge.length).toBeGreaterThanOrEqual(43);
    // Base64URL characters only
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("exports required Google Antigravity OAuth constants", () => {
    expect(CLIENT_ID).toBeDefined();
    expect(CLIENT_SECRET).toBeDefined();
    expect(REDIRECT_URI).toBe("http://localhost:51121/oauth-callback");
    expect(SCOPES.length).toBeGreaterThan(0);
    expect(SCOPES).toContain("https://www.googleapis.com/auth/aicode");
    expect(SCOPES).toContain("https://www.googleapis.com/auth/cloud-platform");
  });

  it("sanitizes OAuth provider error json and tokens", () => {
    const jsonErr = JSON.stringify({
      error: "invalid_grant",
      error_description: "Bad verification code with token ya29.a0AfH6SM...",
    });
    const sanitized = sanitizeOAuthProviderError(jsonErr);
    expect(sanitized).toContain("invalid_grant");
    expect(sanitized).not.toContain("ya29.");
    expect(sanitized).toContain("[redacted-access-token]");
  });

  it("refreshes an access token without performing project discovery", async () => {
    const fetchMock = mock(async (_input: string | URL | Request, _init?: RequestInit) =>
      new Response(
        JSON.stringify({ access_token: "new-access", expires_in: 3600 }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const refreshed = await refreshAntigravityAccessToken("refresh-token");

    expect(refreshed.access).toBe("new-access");
    expect(refreshed.refresh).toBe("refresh-token");
    expect(refreshed.projectId).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(TOKEN_URL);
  });
});
