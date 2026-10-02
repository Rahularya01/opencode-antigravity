import { describe, expect, it } from "bun:test";
import {
  formatDiagnostics,
  getLastDiagnostics,
  resetDiagnosticsForTests,
  runWithDiagnostics,
  setLastEndpoint,
  setLastError,
  setLastLatencyMs,
  setLastProjectId,
  setLastResolvedRuntimeModel,
  setLastStatus,
} from "../src/diagnostics/diagnostics.js";

describe("Diagnostics", () => {
  it("captures request snapshot across async operations", async () => {
    resetDiagnosticsForTests();

    await runWithDiagnostics(async () => {
      setLastEndpoint("https://daily-cloudcode-pa.googleapis.com");
      setLastStatus(200);
      setLastProjectId("proj-xyz");
      setLastResolvedRuntimeModel("gemini-3.8-flash-high");
      setLastLatencyMs(150);
      setLastError("Bearer secret-token");
    });

    const d = getLastDiagnostics();
    expect(d.endpoint).toBe("https://daily-cloudcode-pa.googleapis.com");
    expect(d.status).toBe(200);
    expect(d.projectId).toBe("proj-xyz");
    expect(d.resolvedRuntimeModel).toBe("gemini-3.8-flash-high");
    expect(d.latencyMs).toBe(150);
    expect(d.error).not.toContain("secret-token");
    expect(d.error).toContain("[redacted]");

    const formatted = formatDiagnostics(d);
    expect(formatted).toContain("provider=@rahularya01/opencode-antigravity");
    expect(formatted).toContain("lastResolvedRuntimeModel=gemini-3.8-flash-high");
    expect(formatted).toContain("lastEndpoint=https://daily-cloudcode-pa.googleapis.com");
    expect(formatted).toContain("lastStatus=200");
  });
});
