import { afterEach, expect, test } from 'bun:test';
import { extractProjectId } from '../src/client.js';
import { AntigravityLanguageModel } from '../src/language-model.js';
import { beginAntigravityHeadlessLogin } from '../src/oauth.js';
import { convertPrompt } from '../src/request.js';
import { redactSecrets } from '../src/security.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('converts Antigravity SSE text into AI SDK stream parts', async () => {
  globalThis.fetch = (async () =>
    new Response(
      'data: {"candidates":[{"content":{"parts":[{"text":"hello"}]}}]}\n\ndata: {"candidates":[{"content":{"parts":[{"text":" world"}]}}]}\n\n',
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    )) as typeof fetch;
  const model = new AntigravityLanguageModel('gemini-3.7-flash', {
    apiKey: 'test',
    projectId: 'proj',
  });
  const result = await model.doStream({
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
  });
  const reader = result.stream.getReader();
  const parts = [] as string[];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value.type === 'text-delta') parts.push(value.delta);
  }
  expect(parts.join('')).toBe('hello world');
});

test('maps tool calls from SSE into AI SDK tool-call parts', async () => {
  globalThis.fetch = (async () =>
    new Response(
      'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"read","args":{"path":"a.ts"}}}]},"finishReason":"STOP"}]}\n\n',
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    )) as typeof fetch;
  const model = new AntigravityLanguageModel('gemini-3.7-flash', {
    apiKey: 'test',
    projectId: 'proj',
  });
  const result = await model.doStream({
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
  });
  const reader = result.stream.getReader();
  const names: string[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value.type === 'tool-call') names.push(value.toolName);
  }
  expect(names).toEqual(['read']);
});

test('builds a multi-turn Gemini envelope from OpenCode prompt history', () => {
  const { contents } = convertPrompt(
    {
      prompt: [
        { role: 'system', content: 'Be brief' },
        { role: 'user', content: [{ type: 'text', text: 'Hi' }] },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'hello' },
            { type: 'tool-call', toolCallId: '1', toolName: 'read', input: { path: 'a.ts' } },
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: '1',
              toolName: 'read',
              output: { type: 'text', value: 'ok' },
            },
          ],
        },
      ],
    },
    'gemini-3.7-flash',
    'gemini-3.7-flash-low',
  );
  expect(contents[0]?.role).toBe('user');
  expect(contents.some((turn) => turn.role === 'model')).toBe(true);
  expect(JSON.stringify(contents)).toContain('functionResponse');
});

test('extracts project ids from loadCodeAssist-shaped payloads', () => {
  expect(extractProjectId({ projectId: 'abc-123' })).toBe('abc-123');
  expect(extractProjectId({ cloudaicompanionProject: { id: 'nested' } })).toBe('nested');
});

test('redacts Google access tokens', () => {
  expect(redactSecrets('Bearer ya29.aaaaaaaaaaaaaaaaaaaaaaaa')).toContain('[redacted');
});

test('Google login URL uses PKCE', () => {
  const login = beginAntigravityHeadlessLogin();
  const url = new URL(login.url);
  expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  expect(url.searchParams.get('access_type')).toBe('offline');
});
