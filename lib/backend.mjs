import { config, bucketFor, endpoint } from './config.mjs';

export function checkBackend(backend, state, workspace) {
  if (workspace !== 'default') throw new Error('Only the default workspace is supported');
  const settings = backend?.config;
  const endpoints = Array.isArray(settings?.endpoints) ? settings.endpoints[0] : settings?.endpoints;
  if (backend?.type !== 's3' || settings.bucket !== bucketFor(state) || settings.key !== 'terraform.tfstate' ||
      settings.use_lockfile !== true || endpoints?.s3 !== endpoint) throw new Error('Unexpected backend; refusing state operation');
}

export function checkPlan(plan) {
  const allowed = ['cloudflare_r2_bucket', 'cloudflare_r2_managed_domain'];
  if (!Array.isArray(plan.resource_changes)) throw new Error('Invalid plan');
  for (const { type, change } of plan.resource_changes) {
    const after = change?.after;
    if (!allowed.includes(type) || !change.actions.every((action) => ['create', 'update', 'no-op'].includes(action)) ||
        after?.account_id !== config.account_id || !Object.values(config.buckets).includes(type === 'cloudflare_r2_bucket' ? after.name : after.bucket_name)) {
      throw new Error('Unexpected resource or destructive plan');
    }
    if (type === 'cloudflare_r2_bucket' && after.storage_class !== 'Standard') throw new Error('Non-Standard storage plan');
    if (type === 'cloudflare_r2_managed_domain' && after.enabled !== false) throw new Error('Public state plan');

  }
}

export function checkLockProof(proof, state) {
  if (proof?.account !== config.account_id || proof.bucket !== bucketFor(state) || proof.endpoint !== endpoint || proof.terraform !== '1.16.3' || proof.result !== 'passed') {
    throw new Error('R2 lock verification is required');
  }
}

export function checkTerraformEnvironment(env = process.env) {
  if (Object.entries(env).some(([key, value]) => value && (key === 'TF_DATA_DIR' || key === 'TF_CLI_ARGS' || key.startsWith('TF_CLI_ARGS_') || (key === 'TF_WORKSPACE' && value !== 'default')))) {
    throw new Error('Terraform environment overrides are not supported');
  }
}
