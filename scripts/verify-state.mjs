import { randomUUID } from 'node:crypto';
import { GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { config, endpoint, bucketFor, stateClient, required } from '../lib/config.mjs';
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
  const saved = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!Buffer.from(await saved.Body.transformToByteArray()).equals(bytes)) throw new Error('State readback mismatch');
  const proof = { account: config.account_id, bucket, endpoint, checked_at: new Date().toISOString(), result: 'passed' };
  console.log(JSON.stringify(proof));
} catch {
  console.error('State verification failed. Do not start normal apply; inspect bucket access and permissions.');
  process.exitCode = 1;
} finally {
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })).catch(() => { process.exitCode = 1; });
  client.destroy();
}
