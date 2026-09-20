import { readFileSync } from 'node:fs';
import { S3Client } from '@aws-sdk/client-s3';

export const config = JSON.parse(readFileSync(new URL('../config.json', import.meta.url), 'utf8'));
export const endpoint = `https://${config.account_id}.r2.cloudflarestorage.com`;
export function bucketFor(state) {
  if (!Object.hasOwn(config.buckets, state)) throw new Error('Unknown state');
  return config.buckets[state];
}
export function required(name) {
  if (!process.env[name]?.trim()) throw new Error(`Missing ${name}`);
  return process.env[name];
}
export function stateClient() {
  const client = new S3Client({
    endpoint, region: 'auto', forcePathStyle: true,
    credentials: { accessKeyId: required('AWS_ACCESS_KEY_ID'), secretAccessKey: required('AWS_SECRET_ACCESS_KEY') },
    requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
  });
  return {
    send: (command) => client.send(command, { abortSignal: AbortSignal.timeout(30_000) }),
    destroy: () => client.destroy(),
  };
}
