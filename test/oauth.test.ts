import { expect, test } from 'bun:test';
import { parseAntigravityCallback } from '../src/oauth.js';

test('parses a matching Google OAuth callback', () => {
  expect(
    parseAntigravityCallback(
      'http://localhost:51121/oauth-callback?state=expected&code=value',
      'expected',
    ),
  ).toBe('value');
});

test('rejects a callback from another login', () => {
  expect(() => parseAntigravityCallback('?state=wrong&code=value', 'expected')).toThrow(
    /state mismatch/,
  );
});
