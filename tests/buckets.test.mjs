import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureBuckets } from '../lib/buckets.mjs';

test('creates missing private state buckets and records each receipt before proceeding', async () => {
  const events = [];
  const api = {
    get: async () => null,
    create: async (name) => { events.push(`create:${name}`); return { name, creation_date: '2026-09-20T00:00:00Z' }; },
    isPublic: async () => false,
  };
  await ensureBuckets(['foundation', 'apex'], api, {}, async (name) => events.push(`save:${name}`));
  assert.deepEqual(events, ['create:foundation', 'save:foundation', 'create:apex', 'save:apex']);
});

test('refuses existing buckets without matching creation receipts or with public access', async () => {
  const existing = { name: 'apex', creation_date: '2026-09-20T00:00:00Z' };
  const api = { get: async () => existing, isPublic: async () => false };
  await assert.rejects(ensureBuckets(['apex'], api, {}, async () => {}), /ownership/);
  api.isPublic = async () => true;
  await assert.rejects(ensureBuckets(['apex'], api, { apex: existing.creation_date }, async () => {}), /public/);
});

test('reuses matching owned buckets without creating them again', async () => {
  const existing = { name: 'apex', creation_date: '2026-09-20T00:00:00Z' };
  await ensureBuckets(['apex'], { get: async () => existing, isPublic: async () => false, create: () => assert.fail('duplicate create') }, { apex: existing.creation_date }, () => assert.fail('duplicate receipt'));
});
