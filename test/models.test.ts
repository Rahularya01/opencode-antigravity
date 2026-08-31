import { expect, test } from 'bun:test';
import { getThinkingConfig, resolveRuntimeModel } from '../src/models.js';

test('routes Antigravity effort variants', () => {
  expect(resolveRuntimeModel('gemini-3.7-flash', 'high')).toBe('gemini-3.7-flash-high');
  expect(resolveRuntimeModel('claude-opus-4-6', 'high')).toBe('claude-opus-4-6-thinking');
});

test('emits Gemini thinking config for flash models', () => {
  expect(getThinkingConfig('gemini-3.7-flash', 'high')).toEqual({
    includeThoughts: true,
    thinkingLevel: 'HIGH',
  });
});
