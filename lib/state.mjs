import { createHash } from 'node:crypto';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

export async function ensureBuckets(names, api, receipt, save) {
  for (const name of names) {
    let bucket = await api.get(name);
    if (bucket && receipt[name] !== bucket.creation_date) throw new Error(`Unverified ownership: ${name}`);
    if (!bucket) {
      if (receipt[name]) throw new Error(`Previously created bucket is missing: ${name}`);
      bucket = await api.create(name);
      if (bucket.name !== name || !bucket.creation_date) throw new Error('Invalid bucket creation response');
      receipt[name] = bucket.creation_date;
      await save(name, receipt);
    }
    if (await api.isPublic(name)) throw new Error(`Refusing public state bucket: ${name}`);
  }
  return receipt;
}

async function read(client, bucket, key) {
  try {
    const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    return Buffer.from(await response.Body.transformToByteArray());
  } catch (error) {
    if (error.name === 'NoSuchKey') return null;
    throw error;
  }
}

export async function backupState(client, bucket, { allowMissing = false, stateKey = 'terraform.tfstate', day = new Date().toISOString().slice(0, 10) } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('Invalid backup date');
  const bytes = await read(client, bucket, stateKey);
  if (!bytes) {
    if (allowMissing) return null;
    throw new Error('Current state is missing');
  }
  let state;
  try { state = JSON.parse(bytes.toString('utf8')); } catch { throw new Error('Invalid Terraform state'); }
  if (!state || state.version !== 4 || !Number.isSafeInteger(state.serial) || state.serial < 0 ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(state.lineage) || !Array.isArray(state.resources)) {
    throw new Error('Invalid Terraform state');
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const key = `backups/${day}/${state.lineage}/${state.serial}-${sha256}.tfstate`;
  const existing = await read(client, bucket, key);
  if (existing && !existing.equals(bytes)) throw new Error('Backup integrity mismatch');
  if (!existing) {
    try {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, IfNoneMatch: '*', ContentType: 'application/json' }));
    } catch (error) {
      // A concurrent/retried writer may have completed the same immutable snapshot.
      const stored = await read(client, bucket, key);
      if (!stored?.equals(bytes)) throw error;
    }
  }
  return { key, sha256, serial: state.serial };
}

export async function applyWithBackups(backup, apply) {
  await backup('before');
  try {
    return await apply();
  } finally {
    await backup('after');
  }
}
