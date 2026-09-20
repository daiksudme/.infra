import { readFileSync, mkdirSync, openSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { bucketFor, stateClient } from '../lib/config.mjs';
import { backupState, applyWithBackups } from '../lib/state.mjs';
import { checkBackend, checkPlan, checkLockProof } from '../lib/backend.mjs';

let client;
async function main() {
  const [command, state, planFile] = process.argv.slice(2);
  const bucket = bucketFor(state);
  client = stateClient();
  if (command === 'backup') {
    console.log(JSON.stringify(await backupState(client, bucket)));
    return 0;
  }
  if (command !== 'apply' || state !== 'foundation' || !planFile) throw new Error('Usage: state.mjs backup STATE | apply foundation PLAN');
  const root = fileURLToPath(new URL('../terraform/foundation/', import.meta.url));
  checkLockProof(JSON.parse(readFileSync(new URL('../.private/lock-foundation.json', import.meta.url), 'utf8')), state);
  const plan = resolve(planFile);
  checkBackend(JSON.parse(readFileSync(resolve(root, '.terraform/terraform.tfstate'), 'utf8')).backend, state);
  const json = execFileSync('terraform', [`-chdir=${root}`, 'show', '-json', plan], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 });
  checkPlan(JSON.parse(json));
  const logDirectory = fileURLToPath(new URL('../.private/', import.meta.url));
  mkdirSync(logDirectory, { recursive: true, mode: 0o700 });
  const log = resolve(logDirectory, `apply-${randomUUID()}.log`);
  const descriptor = openSync(log, 'wx', 0o600);
  try {
    const status = await applyWithBackups(async () => {
      const snapshot = await backupState(client, bucket);
      console.log(JSON.stringify({ backup: snapshot.key, sha256: snapshot.sha256 }));
    }, async () => {
      const result = spawnSync('terraform', [`-chdir=${root}`, 'apply', '-input=false', plan], { stdio: ['ignore', descriptor, descriptor] });
      if (result.error) throw new Error('Could not execute Terraform');
      return result.status ?? 1;
    });
    console.log(`Apply exit: ${status}. Private diagnostics: ${log}`);
    return status;
  } finally { closeSync(descriptor); }
}
try { process.exitCode = await main(); }
catch (error) {
  console.error(`State operation failed (${/^[A-Za-z0-9]+$/.test(error.name) ? error.name : 'Error'}). Check the command, backend, permissions and private Terraform diagnostics.`);
  process.exitCode = 1;
}

finally { client?.destroy(); }
