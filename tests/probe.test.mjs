import assert from 'node:assert/strict';
import test from 'node:test';
import { lockProbe } from '../lib/probe.mjs';

test('lock probe uses a disposable remote key and Terraform builtin resource only', () => {
  const config = lockProbe('apex', 'validation/11111111-1111-4111-8111-111111111111/terraform.tfstate');
  assert.equal(config.terraform?.backend?.s3?.use_lockfile, true);
  assert.equal(config.terraform?.backend?.s3?.bucket, 'daiksudme-tfstate-apex');
  assert.deepEqual(Object.keys(config.resource ?? {}), ['terraform_data']);
  assert.throws(() => lockProbe('apex', 'terraform.tfstate'), /disposable/);
});

test('Terraform accepts the generated probe without using any real backend', async (t) => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const directory = mkdtempSync(join(tmpdir(), 'infra-probe-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(join(directory, 'main.tf.json'), JSON.stringify(lockProbe('apex', 'validation/11111111-1111-4111-8111-111111111111/terraform.tfstate')));
  for (const args of [['init', '-backend=false'], ['validate']]) {
    const result = spawnSync('terraform', [`-chdir=${directory}`, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
});
