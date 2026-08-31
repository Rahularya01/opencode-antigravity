export function antigravityEnv(name: string): string | undefined {
  return process.env[`ANTIGRAVITY_${name}`] || process.env[`NOAGY_${name}`];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

export function sanitizeText(text: unknown): string {
  return String(text ?? '').replace(/[\uD800-\uDFFF]/g, '\uFFFD');
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function antigravityRequestEnvelope(isClaude: boolean): {
  requestId: string;
  sessionId: string;
  labels: Record<string, string>;
} {
  const agentId = crypto.randomUUID();
  const trajectoryId = crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const sessionId = String(new DataView(bytes.buffer, bytes.byteOffset, 8).getBigInt64(0, true));
  const usageLabel = isClaude ? 'true' : 'false';
  return {
    requestId: `agent/${agentId}/${Date.now()}/${trajectoryId}/2`,
    sessionId,
    labels: {
      last_step_index: '1',
      trajectory_id: trajectoryId,
      used_claude: usageLabel,
      used_claude_conservative: usageLabel,
    },
  };
}
