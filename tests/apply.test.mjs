import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, symlinkSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { config, endpoint } from '../lib/config.mjs';

test('validated apply runs without backup I/O and preserves Terraform failure status', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'infra-apply-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const name of ['scripts', 'lib', 'config.json', 'package.json']) cpSync(name, join(root, name), { recursive: true });
  symlinkSync(resolve('node_modules'), join(root, 'node_modules'), 'dir');
  for (const name of ['bin', '.private', 'terraform/foundation/.terraform']) mkdirSync(join(root, name), { recursive: true });
  writeFileSync(join(root, 'terraform/foundation/.terraform/terraform.tfstate'), JSON.stringify({ backend: { type: 's3', config: { bucket: config.buckets.foundation, key: 'terraform.tfstate', endpoints: { s3: endpoint }, use_lockfile: true } } }));
  writeFileSync(join(root, '.private/lock-foundation.json'), JSON.stringify({ account: config.account_id, bucket: config.buckets.foundation, endpoint, terraform: '1.16.3', result: 'passed' }));
  writeFileSync(join(root, 'deny-s3.mjs'), `import { writeFileSync } from 'node:fs'; import { S3Client } from '@aws-sdk/client-s3'; S3Client.prototype.send = async () => { writeFileSync(${JSON.stringify(join(root, 'unexpected-s3'))}, 'called'); throw new Error('Unexpected backup I/O'); };\n`);
  writeFileSync(join(root, 'bin/terraform'), `#!/usr/bin/env node
import fs from 'node:fs';
const args = process.argv.slice(2);
if (args.includes('workspace')) console.log('default');
else if (args.includes('show')) console.log(JSON.stringify({resource_changes:[]}));
else if (args.includes('apply')) { fs.writeFileSync(${JSON.stringify(join(root, 'applied'))}, 'applied'); process.exit(17); }
else process.exit(2);
`, { mode: 0o700 });
  const result = spawnSync(process.execPath, ['--import', join(root, 'deny-s3.mjs'), join(root, 'scripts/state.mjs'), 'apply', 'foundation', join(root, '.private/plan.tfplan')], {
    cwd: root, encoding: 'utf8', env: { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}`, AWS_ACCESS_KEY_ID: 'fixture', AWS_SECRET_ACCESS_KEY: 'fixture' },
  });
  assert.equal(existsSync(join(root, 'unexpected-s3')), false, 'Apply must not access S3 directly for backups');
  assert.equal(result.status, 17, result.stdout + result.stderr);
  assert.equal(existsSync(join(root, 'applied')), true);
});
