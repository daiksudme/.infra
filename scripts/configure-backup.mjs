import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { config, endpoint, bucketFor } from '../lib/config.mjs';
import { checkLockProof } from '../lib/backend.mjs';

const repository = 'repos/daiksudme/.infra';
const environment = `${repository}/environments/state-foundation`;
function api(path, method = 'GET', data) {
  const args = ['api', path, '--method', method];
  if (data) args.push('--input', '-');
  const result = spawnSync('gh', args, { input: data ? JSON.stringify(data) : undefined, encoding: 'utf8' });
  const response = result.stdout ? JSON.parse(result.stdout) : {};
  if (result.status !== 0) {
    if (method === 'GET' && Number(response.status) === 404) return null;
    throw new Error('GitHub configuration request failed');
  }
  return response;
}
if (process.argv[2] === 'prepare') {
  const existing = api(environment);
  if (!existing) api(environment, 'PUT', { deployment_branch_policy: { protected_branches: false, custom_branch_policies: true } });
  else if (!existing.deployment_branch_policy?.custom_branch_policies) throw new Error('Existing environment needs manual review; no protection was overwritten');
  const policies = api(`${environment}/deployment-branch-policies`).branch_policies;
  if (policies.some((policy) => policy.name !== 'main' || policy.type !== 'branch')) throw new Error('Existing branch policy needs review');
  if (!policies.length) api(`${environment}/deployment-branch-policies`, 'POST', { name: 'main', type: 'branch' });
  console.log('state-foundation permits only main. Set its R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY secrets, then verify before enabling.');
} else if (process.argv[2] === 'enable') {
  const lock = JSON.parse(readFileSync(new URL('../.private/lock-foundation.json', import.meta.url), 'utf8'));
  const state = JSON.parse(readFileSync(new URL('../.private/state-foundation.json', import.meta.url), 'utf8'));
  checkLockProof(lock, 'foundation');
  if (state.account !== config.account_id || state.bucket !== bucketFor('foundation') || state.endpoint !== endpoint || state.result !== 'passed') throw new Error('State verification is required');
  const policies = api(`${environment}/deployment-branch-policies`).branch_policies;
  if (policies.length !== 1 || policies[0].name !== 'main' || policies[0].type !== 'branch') throw new Error('Expected main-only environment');
  const variable = `${repository}/actions/variables/R2_FOUNDATION_READY`;
  const existing = api(variable);
  api(existing ? variable : `${repository}/actions/variables`, existing ? 'PATCH' : 'POST', { name: 'R2_FOUNDATION_READY', value: 'true' });
  console.log('Foundation daily backup enabled after real verification.');
} else {
  throw new Error('Usage: configure-backup.mjs prepare | enable');
}
