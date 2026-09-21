import { readFileSync, mkdirSync, openSync, closeSync, appendFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { required } from '../lib/config.mjs';
import { bucketApi } from '../lib/cloudflare.mjs';
import { checkBackend, checkTerraformEnvironment } from '../lib/backend.mjs';
import { verifyOwnership, assertCurrentRun, manageFoundation } from '../lib/foundation.mjs';

const root = 'terraform/foundation';
const planFile = '.private/foundation.tfplan';
let stage = 'credentials'; let log;
try {
  const operation = process.argv[2];
  if (!['import', 'plan', 'apply'].includes(operation)) throw new Error();
  for (const key of ['CLOUDFLARE_API_TOKEN', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'GH_TOKEN']) required(key);
  checkTerraformEnvironment();
  mkdirSync('.private', { recursive: true, mode: 0o700 });
  log = openSync('.private/foundation.log', 'w', 0o600);
  const capture = (args) => execFileSync('terraform', [`-chdir=${root}`, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 });
  const terraform = (args, accepted = [0]) => {
    if (!accepted.includes(spawnSync('terraform', [`-chdir=${root}`, ...args], { stdio: ['ignore', log, log] }).status)) throw new Error();
  };
  const node = (script, args) => {
    if (spawnSync(process.execPath, [script, ...args], { stdio: ['ignore', log, log] }).status !== 0) throw new Error();
  };
  const guard = async () => {
    stage = 'latest main verification';
    const response = await fetch('https://api.github.com/repos/daiksudme/.infra/git/ref/heads/main', { headers: { Authorization: `Bearer ${required('GH_TOKEN')}`, Accept: 'application/vnd.github+json' }, redirect: 'error', signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error();
    assertCurrentRun(process.env, (await response.json()).object?.sha);
  };
  await guard();
  stage = 'bucket ownership';
  await verifyOwnership(JSON.parse(readFileSync('foundation-buckets.json', 'utf8')), bucketApi(required('CLOUDFLARE_API_TOKEN')));
  stage = 'S3 access verification'; node('scripts/verify-state.mjs', ['foundation']);
  stage = 'Terraform lock verification'; node('scripts/verify-lock.mjs', ['foundation']);
  stage = 'backend initialization'; terraform(['init', '-input=false', '-reconfigure', '-lockfile=readonly']);
  checkBackend(JSON.parse(readFileSync(`${root}/.terraform/terraform.tfstate`, 'utf8')).backend, 'foundation', capture(['workspace', 'show']).trim());
  const summary = await manageFoundation(operation, {
    guard,
    inspect: async () => { stage = 'state identity'; return JSON.parse(capture(['show', '-json'])); },
    importBucket: async ({ address, id }) => { stage = 'bucket import'; terraform(['import', '-input=false', address, id]); },
    plan: async () => {
      stage = 'plan'; terraform(['plan', '-input=false', '-detailed-exitcode', '-out=../../' + planFile], [0, 2]);
      return JSON.parse(capture(['show', '-json', '../../' + planFile]));
    },
    apply: async () => { stage = 'apply'; node('scripts/state.mjs', ['apply', 'foundation', planFile]); },
  });
  console.log(JSON.stringify({ operation, sha: process.env.GITHUB_SHA, resources: summary }));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Foundation ${operation} completed at ${process.env.GITHUB_SHA}. Validated resource count: ${summary.length}.\n`);
} catch {
  console.error(`Foundation operation failed during ${stage}. State, plan and Terraform diagnostics remain private.`);
  process.exitCode = 1;
} finally { if (log !== undefined) closeSync(log); }
