import assert from 'node:assert/strict';
import test from 'node:test';
import { bucketApi } from '../lib/cloudflare.mjs';
const response = (result) => ({ status: 200, ok: true, json: async () => ({ success: true, result }) });

test('a custom domain also prevents treating a state bucket as private', async () => {
  const api = bucketApi('fixture-token', async (url) => response(url.endsWith('/managed') ? { enabled: false } : { domains: [{ domain: 'state.example.test', enabled: true }] }));
  assert.equal(await api.isPublic('test-state'), true);
});

test('only explicit disabled managed access and no custom domains count as private', async () => {
  const api = bucketApi('fixture-token', async (url) => response(url.endsWith('/managed') ? { enabled: false } : { domains: [] }));
  assert.equal(await api.isPublic('test-state'), false);
  const unknown = bucketApi('fixture-token', async () => response({}));
  await assert.rejects(unknown.isPublic('test-state'), /exposure/);
});
