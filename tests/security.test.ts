import { describe, expect, it } from "bun:test";
import {
  assertSafeApiBaseUrl,
  maskEmail,
  redactSecrets,
  resolveCallbackHost,
  safeError,
} from "../src/utils/security.js";

describe("Security utils", () => {
  it("redacts bearer tokens and secrets", () => {
    const raw = 'Bearer ya29.a0AfH6SMB... and refresh 1//0gK6... {"client_secret": "my-secret"}';
    const redacted = redactSecrets(raw);
    expect(redacted).not.toContain("ya29.");
    expect(redacted).not.toContain("1//0gK6");
    expect(redacted).not.toContain("my-secret");
    expect(redacted).toContain("[redacted-access-token]");
    expect(redacted).toContain("[redacted-refresh-token]");
  });

  it("validates loopback hosts strictly", () => {
    expect(resolveCallbackHost("127.0.0.1")).toBe("127.0.0.1");
    expect(resolveCallbackHost("localhost")).toBe("127.0.0.1");
    expect(resolveCallbackHost("::1")).toBe("::1");
    expect(() => resolveCallbackHost("0.0.0.0")).toThrow();
    expect(() => resolveCallbackHost("example.com")).toThrow();
  });

  it("validates safe API base URLs", () => {
    expect(assertSafeApiBaseUrl("https://cloudcode-pa.googleapis.com")).toBe(
      "https://cloudcode-pa.googleapis.com",
    );
    expect(assertSafeApiBaseUrl("https://daily-cloudcode-pa.googleapis.com/")).toBe(
      "https://daily-cloudcode-pa.googleapis.com",
    );
    expect(() => assertSafeApiBaseUrl("http://cloudcode-pa.googleapis.com")).toThrow();
    expect(() => assertSafeApiBaseUrl("https://evil.com")).toThrow();
  });

  it("masks email addresses safely", () => {
    expect(maskEmail("rahul@example.com")).toBe("r***l@example.com");
    expect(maskEmail("a@b.com")).toBe("a***@b.com");
    expect(maskEmail(undefined)).toBeUndefined();
  });
});
