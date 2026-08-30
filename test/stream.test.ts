import { afterEach, expect, test } from 'bun:test';
import { AntigravityLanguageModel } from '../src/language-model.js';

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
  const model = new AntigravityLanguageModel('gemini-3.7-flash', { apiKey: 'test' });
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
