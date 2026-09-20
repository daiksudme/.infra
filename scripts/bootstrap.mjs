import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { config, required } from '../lib/config.mjs';
import { ensureBuckets } from '../lib/state.mjs';
import { bucketApi } from '../lib/cloudflare.mjs';

if (process.argv[2] !== '--apply') {
  console.log(JSON.stringify({ account: config.account_id, buckets: config.buckets, operation: 'create missing private buckets; existing buckets require receipt' }, null, 2));
} else {
  const path = resolve(process.argv[3] ?? '.private/bootstrap-receipt.json');
  const receipt = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { account_id: config.account_id, buckets: {} };
  if (receipt.account_id !== config.account_id) throw new Error('Receipt belongs to another account');
  const token = required('CLOUDFLARE_API_TOKEN');
  await ensureBuckets(Object.values(config.buckets), bucketApi(token), receipt.buckets, async () => {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(`${path}.tmp`, JSON.stringify(receipt, null, 2), { mode: 0o600 });
    renameSync(`${path}.tmp`, path);
  });
  console.log('Private buckets verified. Keep the receipt for safe retries; import before applying Terraform.');
}
