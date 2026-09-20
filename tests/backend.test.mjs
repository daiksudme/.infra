import assert from 'node:assert/strict';
import test from 'node:test';
import { checkBackend, checkPlan } from '../lib/backend.mjs';
import { config, endpoint } from '../lib/config.mjs';
const backend = { type: 's3', config: { bucket: 'daiksudme-tfstate-foundation', key: 'terraform.tfstate', endpoints: { s3: endpoint }, use_lockfile: true } };

test('rejects a wrong state bucket, endpoint, key, or disabled locking', () => {
  for (const patch of [{ bucket: 'other' }, { key: 'other' }, { endpoints: { s3: 'https://example.test' } }, { use_lockfile: false }]) {
    assert.throws(() => checkBackend({ ...backend, config: { ...backend.config, ...patch } }, 'foundation', 'default'), /backend/);
  }
  assert.doesNotThrow(() => checkBackend(backend, 'foundation', 'default'));
});

test('refuses state destruction, unrelated resources, public access and changed retention', () => {
  const plan = (type, actions, after = {}) => ({ resource_changes: [{ type, change: { actions, after: { account_id: config.account_id, bucket_name: 'daiksudme-tfstate-foundation', ...after } } }] });
  for (const value of [plan('cloudflare_r2_bucket', ['delete']), plan('cloudflare_worker', ['create']), plan('cloudflare_r2_managed_domain', ['update'], { enabled: true }), plan('cloudflare_r2_bucket_lock', ['update'], { rules: [] })]) {
    assert.throws(() => checkPlan(value), /plan/);
  }
  assert.doesNotThrow(() => checkPlan(plan('cloudflare_r2_managed_domain', ['update'], { enabled: false })));
});

test('normal apply requires a lock verification for the same account, bucket and Terraform version', async () => {
  const { checkLockProof } = await import('../lib/backend.mjs');
  assert.throws(() => checkLockProof({}, 'foundation'), /verification/);
  assert.doesNotThrow(() => checkLockProof({ account: config.account_id, bucket: 'daiksudme-tfstate-foundation', endpoint, terraform: '1.16.3', result: 'passed' }, 'foundation'));
});

test('rejects a non-default workspace before backing up or applying a different state', () => {
  assert.throws(() => checkBackend(backend, 'foundation', 'other'), /workspace/);
  assert.doesNotThrow(() => checkBackend(backend, 'foundation', 'default'));
});
