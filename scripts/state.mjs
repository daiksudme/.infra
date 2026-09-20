import { readFileSync, mkdirSync, openSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { checkBackend, checkPlan, checkLockProof, checkTerraformEnvironment } from '../lib/backend.mjs';

function main() {
  const [command, state, planFile] = process.argv.slice(2);
  if (command !== 'apply' || state !== 'foundation' || !planFile) throw new Error('Usage: state.mjs apply foundation PLAN');
  checkTerraformEnvironment();
  const root = fileURLToPath(new URL('../terraform/foundation/', import.meta.url));
  checkLockProof(JSON.parse(readFileSync(new URL('../.private/lock-foundation.json', import.meta.url), 'utf8')), state);
  const plan = resolve(planFile);
  const workspace = execFileSync('terraform', [`-chdir=${root}`, 'workspace', 'show'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  checkBackend(JSON.parse(readFileSync(resolve(root, '.terraform/terraform.tfstate'), 'utf8')).backend, state, workspace);
  const json = execFileSync('terraform', [`-chdir=${root}`, 'show', '-json', plan], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 });
  checkPlan(JSON.parse(json));
  const logDirectory = fileURLToPath(new URL('../.private/', import.meta.url));
  mkdirSync(logDirectory, { recursive: true, mode: 0o700 });
  const log = resolve(logDirectory, `apply-${randomUUID()}.log`);
  const descriptor = openSync(log, 'wx', 0o600);
  try {
    const result = spawnSync('terraform', [`-chdir=${root}`, 'apply', '-input=false', plan], { stdio: ['ignore', descriptor, descriptor] });
    if (result.error) throw new Error('Could not execute Terraform');
    const status = result.status ?? 1;
    console.log(`Apply exit: ${status}. Private diagnostics: ${log}`);
    return status;
  } finally { closeSync(descriptor); }
}
try { process.exitCode = main(); }
catch (error) {
  console.error(`State operation failed (${/^[A-Za-z0-9]+$/.test(error.name) ? error.name : 'Error'}). Check the command, backend, permissions and private Terraform diagnostics.`);
  process.exitCode = 1;
}
