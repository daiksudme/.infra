import { config } from './config.mjs';
import { checkPlan } from './backend.mjs';
const targets = Object.entries(config.buckets).map(([key, name]) => ({ address: `cloudflare_r2_bucket.state["${key}"]`, privateAddress: `cloudflare_r2_managed_domain.private["${key}"]`, name, id: `${config.account_id}/${name}/default` }));
export function importsNeeded(state) {
  const root = state.values?.root_module;
  if (root?.child_modules?.length) throw new Error('Unexpected state module');
  const resources = root?.resources ?? [];
  for (const resource of resources) {
    const target = targets.find((item) => [item.address, item.privateAddress].includes(resource.address));
    if (!target) throw new Error('Unexpected state resource');
    const bucket = resource.address === target.address;
    const values = resource.values;
    if (resource.type !== (bucket ? 'cloudflare_r2_bucket' : 'cloudflare_r2_managed_domain') || values?.account_id !== config.account_id ||
        (bucket ? values.name !== target.name || values.id !== target.name : values.bucket_name !== target.name)) throw new Error('State identity mismatch');
  }
  return targets.filter((target) => !resources.some((resource) => resource.address === target.address));
}
export async function verifyOwnership(receipt, api) {
  if (receipt?.account_id !== config.account_id || Object.keys(receipt.buckets ?? {}).length !== targets.length ||
      targets.some(({ name }) => typeof receipt.buckets[name] !== 'string' || !Number.isFinite(Date.parse(receipt.buckets[name])))) throw new Error('Invalid bucket ownership receipt');
  for (const { name } of targets) {
    const bucket = await api.get(name);
    if (bucket?.name !== name || bucket.creation_date !== receipt.buckets[name]) throw new Error('Bucket ownership mismatch');
    if (bucket.storage_class !== 'Standard' || await api.isPublic(name)) throw new Error('Expected private Standard bucket');
  }
}
export function assertCurrentRun(env, latest) {
  if (env.GITHUB_REPOSITORY !== 'daiksudme/.infra' || env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || env.GITHUB_REF !== 'refs/heads/main' ||
      !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '') || env.GITHUB_SHA !== latest) throw new Error('Expected latest main dispatch');
}
export async function manageFoundation(operation, ops) {
  if (!['import', 'plan', 'apply'].includes(operation)) throw new Error('Unknown foundation operation');
  const missing = importsNeeded(await ops.inspect());
  if (operation !== 'import' && missing.length) throw new Error('Run import before plan/apply');
  if (operation === 'import') {
    for (const target of missing) { await ops.guard(); await ops.importBucket(target); }
    if (importsNeeded(await ops.inspect()).length) throw new Error('Incomplete import');
  }
  const plan = await ops.plan();
  checkPlan(plan);
  if (operation === 'apply') { await ops.guard(); await ops.apply(); }
  return plan.resource_changes.map(({ address, change }) => ({ address, actions: change.actions }));
}
