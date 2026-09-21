import assert from 'node:assert/strict';
import test from 'node:test';
import { importsNeeded, verifyOwnership, assertCurrentRun } from '../lib/foundation.mjs';
import { config } from '../lib/config.mjs';
const bucket = (key) => ({ address: `cloudflare_r2_bucket.state["${key}"]`, type: 'cloudflare_r2_bucket', values: { account_id: config.account_id, name: config.buckets[key], id: config.buckets[key] } });

test('imports only missing buckets after a partially completed import', () => {
  assert.deepEqual(importsNeeded({ values: { root_module: { resources: [bucket('foundation')] } } }).map((item) => item.address), ['cloudflare_r2_bucket.state["domains"]', 'cloudflare_r2_bucket.state["family"]', 'cloudflare_r2_bucket.state["apex"]']);
  assert.equal(importsNeeded({}).length, 4);
  assert.deepEqual(importsNeeded({ values: { root_module: { resources: Object.keys(config.buckets).map(bucket) } } }), []);
});

test('rejects an imported address bound to a different bucket or account', () => {
  for (const patch of [{ name: 'other' }, { account_id: 'other' }, { id: 'other' }]) {
    const item = bucket('foundation'); item.values = { ...item.values, ...patch };
    assert.throws(() => importsNeeded({ values: { root_module: { resources: [item] } } }), /identity/);
  }
  assert.throws(() => importsNeeded({ values: { root_module: { resources: [{ address: 'other.resource' }] } } }), /Unexpected/);
});

test('ownership must match the account, every creation date, Standard and private access', async () => {
  const receipt = { account_id: config.account_id, buckets: Object.fromEntries(Object.values(config.buckets).map((name) => [name, '2026-09-21T00:00:00Z'])) };
  const api = { get: async (name) => ({ name, creation_date: '2026-09-21T00:00:00Z', storage_class: 'Standard' }), isPublic: async () => false };
  await assert.rejects(verifyOwnership({ ...receipt, account_id: 'other' }, api), /ownership/);
  await assert.rejects(verifyOwnership({ ...receipt, buckets: {} }, api), /ownership/);
  await assert.rejects(verifyOwnership(receipt, { ...api, get: async () => null }), /ownership/);
  await assert.rejects(verifyOwnership(receipt, { ...api, get: async (name) => ({ name, creation_date: 'different', storage_class: 'Standard' }) }), /ownership/);
  await assert.rejects(verifyOwnership(receipt, { ...api, isPublic: async () => true }), /private/);
  await assert.doesNotReject(verifyOwnership(receipt, api));
});

test('only the latest main dispatch can change foundation state', () => {
  const env = { GITHUB_REPOSITORY: 'daiksudme/.infra', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main', GITHUB_SHA: 'a'.repeat(40) };
  assert.throws(() => assertCurrentRun(env, 'b'.repeat(40)), /main/);
  assert.throws(() => assertCurrentRun({ ...env, GITHUB_REF: 'refs/heads/other' }, env.GITHUB_SHA), /main/);
  assert.doesNotThrow(() => assertCurrentRun(env, env.GITHUB_SHA));
});

test('import is resumable and plan/apply require all four imported identities', async () => {
  const { manageFoundation } = await import('../lib/foundation.mjs');
  const resources = []; const events = []; let fail = true;
  const ops = {
    inspect: async () => ({ values: { root_module: { resources } } }),
    guard: async () => events.push('guard'),
    importBucket: async (target) => { events.push(target.address); if (target.name.endsWith('-domains') && fail) throw new Error('import failed'); resources.push(bucket(Object.keys(config.buckets).find((key) => config.buckets[key] === target.name))); },
    plan: async () => { events.push('plan'); return { resource_changes: [] }; },
    apply: async () => events.push('apply'),
  };
  await assert.rejects(manageFoundation('plan', ops), /import/);
  await assert.rejects(manageFoundation('import', ops), /import failed/);
  assert.equal(resources.length, 1);
  assert.ok(!events.includes('plan'));
  fail = false; events.length = 0;
  await manageFoundation('import', ops);
  assert.deepEqual(events, ['guard', 'cloudflare_r2_bucket.state["domains"]', 'guard', 'cloudflare_r2_bucket.state["family"]', 'guard', 'cloudflare_r2_bucket.state["apex"]', 'plan']);
  events.length = 0;
  await manageFoundation('apply', ops);
  assert.deepEqual(events, ['plan', 'guard', 'apply']);
  await assert.rejects(manageFoundation('apply', { ...ops, apply: async () => { throw new Error('apply failed'); } }), /apply failed/);
});

test('a stale guard or unsafe plan prevents apply', async () => {
  const { manageFoundation } = await import('../lib/foundation.mjs');
  const ops = { inspect: async () => ({ values: { root_module: { resources: Object.keys(config.buckets).map(bucket) } } }), plan: async () => ({ resource_changes: [] }), guard: async () => { throw new Error('stale'); }, apply: () => assert.fail('apply must not run') };
  await assert.rejects(manageFoundation('apply', ops), /stale/);
  await assert.rejects(manageFoundation('apply', { ...ops, plan: async () => ({ resource_changes: [{ type: 'cloudflare_r2_bucket', change: { actions: ['delete'] } }] }) }), /plan/);
});
