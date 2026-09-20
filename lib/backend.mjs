import { config, bucketFor, endpoint } from './config.mjs';

export function checkBackend(backend, state, workspace) {
  if (workspace !== 'default') throw new Error('Only the default workspace is supported');
  const settings = backend?.config;
  const endpoints = Array.isArray(settings?.endpoints) ? settings.endpoints[0] : settings?.endpoints;
  if (backend?.type !== 's3' || settings.bucket !== bucketFor(state) || settings.key !== 'terraform.tfstate' ||
      settings.use_lockfile !== true || endpoints?.s3 !== endpoint) throw new Error('Unexpected backend; refusing state operation');
}

export function checkPlan(plan) {
  const allowed = ['cloudflare_r2_bucket', 'cloudflare_r2_managed_domain', 'cloudflare_r2_bucket_lock', 'cloudflare_r2_bucket_lifecycle'];
  if (!Array.isArray(plan.resource_changes)) throw new Error('Invalid plan');
  for (const { type, change } of plan.resource_changes) {
    const after = change?.after;
    if (!allowed.includes(type) || !change.actions.every((action) => ['create', 'update', 'no-op'].includes(action)) ||
        after?.account_id !== config.account_id || !Object.values(config.buckets).includes(type === 'cloudflare_r2_bucket' ? after.name : after.bucket_name)) {
      throw new Error('Unexpected resource or destructive plan');
    }
    if (type === 'cloudflare_r2_bucket' && after.storage_class !== 'Standard') throw new Error('Non-Standard storage plan');
    if (type === 'cloudflare_r2_managed_domain' && after.enabled !== false) throw new Error('Public state plan');
    if (type === 'cloudflare_r2_bucket_lock') {
      const rule = after.rules?.[0];
      if (after.rules?.length !== 1 || rule.prefix !== 'backups/' || rule.enabled !== true || rule.condition?.type !== 'Age' || rule.condition.max_age_seconds !== 2592000) throw new Error('Unsafe backup lock plan');
    }
    if (type === 'cloudflare_r2_bucket_lifecycle') {
      const rule = after.rules?.[0];
      if (after.rules?.length !== 1 || rule.conditions?.prefix !== 'backups/' || rule.enabled !== true || rule.delete_objects_transition?.condition?.type !== 'Age' || rule.delete_objects_transition.condition.max_age !== 7776000 || rule.storage_class_transitions?.length) throw new Error('Unsafe backup expiry plan');
    }
  }
}

export function checkLockProof(proof, state) {
  if (proof?.account !== config.account_id || proof.bucket !== bucketFor(state) || proof.endpoint !== endpoint || proof.terraform !== '1.16.3' || proof.result !== 'passed') {
    throw new Error('R2 lock verification is required');
  }
}
