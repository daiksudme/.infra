import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { config, endpoint, bucketFor, stateClient, required } from '../lib/config.mjs';
import { backupState } from '../lib/state.mjs';
import { bucketApi } from '../lib/cloudflare.mjs';

const state = process.argv[2];
const bucket = bucketFor(state);
const key = `validation/${randomUUID()}/terraform.tfstate`;
const client = stateClient();
const bytes = Buffer.from(JSON.stringify({ version: 4, lineage: randomUUID(), serial: 1, resources: [], outputs: {} }));
try {
  if (await bucketApi(required('CLOUDFLARE_API_TOKEN')).isPublic(bucket)) throw new Error('Public bucket');
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, IfNoneMatch: '*' }));
  const anonymous = await fetch(`${endpoint}/${bucket}/${key}`, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
  if (![401, 403].includes(anonymous.status)) throw new Error('Anonymous denial not confirmed');
  for (const other of Object.values(config.buckets).filter((name) => name !== bucket)) {
    try {
      await client.send(new GetObjectCommand({ Bucket: other, Key: key }));
      throw new Error('Cross-state read succeeded');
    } catch (error) {
      if (error.$metadata?.httpStatusCode !== 403) throw new Error('Cross-state denial not confirmed');
    }
  }
  const snapshot = await backupState(client, bucket, { stateKey: key });
  for (const operation of [new DeleteObjectCommand({ Bucket: bucket, Key: snapshot.key }), new PutObjectCommand({ Bucket: bucket, Key: snapshot.key, Body: Buffer.from('disposable overwrite check') })]) {
    try { await client.send(operation); throw new Error('Retention did not reject mutation'); }
    catch (error) {
      if (![403, 409].includes(error.$metadata?.httpStatusCode)) throw error;
    }
  }
  const saved = await client.send(new GetObjectCommand({ Bucket: bucket, Key: snapshot.key }));
  const restored = Buffer.from(await saved.Body.transformToByteArray());
  if (!restored.equals(bytes)) throw new Error('Backup bytes changed');
  const current = await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: Buffer.from('disposable corruption') }));
  if (!current.ETag) throw new Error('Missing current object identity');
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: restored, IfMatch: current.ETag }));
  const verification = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!Buffer.from(await verification.Body.transformToByteArray()).equals(bytes)) throw new Error('Restore mismatch');
  const proof = { account: config.account_id, bucket, endpoint, checked_at: new Date().toISOString(), result: 'passed', retained_test_backup: snapshot.key };
  const directory = fileURLToPath(new URL('../.private/', import.meta.url));
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeFileSync(resolve(directory, `state-${state}.json`), JSON.stringify(proof, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(proof));
} catch {
  console.error('State verification failed. Keep normal apply and scheduled backup disabled; inspect permissions and retention configuration.');
  process.exitCode = 1;
} finally {
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })).catch(() => { process.exitCode = 1; });
  client.destroy();
}
