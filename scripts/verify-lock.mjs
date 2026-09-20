import { mkdirSync, mkdtempSync, writeFileSync, openSync, closeSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { config, bucketFor, stateClient, endpoint } from '../lib/config.mjs';
import { lockProbe } from '../lib/probe.mjs';

// All remote writes use a fresh disposable key, never the production state key.
const state = process.argv[2];
const bucket = bucketFor(state);
const key = `validation/${randomUUID()}/terraform.tfstate`;
const privateRoot = fileURLToPath(new URL('../.private/', import.meta.url));
mkdirSync(privateRoot, { recursive: true, mode: 0o700 });
const directory = mkdtempSync(resolve(privateRoot, 'lock-'));
const logPath = resolve(directory, 'terraform.log');
const log = openSync(logPath, 'wx', 0o600);
const client = stateClient();
let first;
try {
  writeFileSync(resolve(directory, 'main.tf.json'), JSON.stringify(lockProbe(state, key)), { mode: 0o600 });
  const run = (args) => spawnSync('terraform', [`-chdir=${directory}`, ...args], { stdio: ['ignore', log, log] });
  if (run(['init', '-input=false']).status !== 0) throw new Error('init failed');
  first = spawn('terraform', [`-chdir=${directory}`, 'apply', '-auto-approve', '-input=false'], { stdio: ['ignore', log, log] });
  const completed = once(first, 'exit');
  let locked = false;
  for (let attempt = 0; attempt < 40 && first.exitCode === null; attempt++) {
    try {
      const lock = await client.send(new GetObjectCommand({ Bucket: bucket, Key: `${key}.tflock` }));
      await lock.Body.transformToByteArray();
      locked = true; break;
    }
    catch (error) { if (error.name !== 'NoSuchKey') throw error; }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!locked) throw new Error('lock was not observed');
  const contender = spawnSync('terraform', [`-chdir=${directory}`, 'plan', '-input=false', '-lock-timeout=1s'], { encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 15_000 });
  if (contender.status === 0 || !`${contender.stdout}${contender.stderr}`.includes('Error acquiring the state lock')) throw new Error('concurrent lock was not rejected');
  const [status] = await completed;
  if (status !== 0) throw new Error('first apply failed');
  try { await client.send(new GetObjectCommand({ Bucket: bucket, Key: `${key}.tflock` })); throw new Error('lock remained'); }
  catch (error) { if (error.name !== 'NoSuchKey') throw error; }
  const proof = { account: config.account_id, bucket, endpoint, terraform: '1.16.3', checked_at: new Date().toISOString(), result: 'passed' };
  writeFileSync(resolve(privateRoot, `lock-${state}.json`), JSON.stringify(proof, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(proof));
} catch {
  console.error(`Lock verification failed. Private diagnostics: ${logPath}`);
  process.exitCode = 1;
} finally {
  if (first?.pid && first.exitCode === null && first.signalCode === null) {
    const ended = once(first, 'exit');
    first.kill('SIGINT');
    await ended;
  }
  closeSync(log);
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })).catch(() => { process.exitCode = 1; });
  client.destroy();
  if (!process.exitCode) rmSync(directory, { recursive: true, force: true });
}
