import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { ensureBuckets, backupState, applyWithBackups } from '../lib/state.mjs';

const bytes = Buffer.from(JSON.stringify({ version: 4, serial: 2, lineage: '11111111-1111-4111-8111-111111111111', resources: [] }));
const body = (value = bytes) => ({ Body: { transformToByteArray: async () => value } });
const missing = () => { throw Object.assign(new Error('missing'), { name: 'NoSuchKey' }); };

test('creates missing private state buckets and records each receipt before proceeding', async () => {
  const events = [];
  const api = {
    get: async () => null,
    create: async (name) => { events.push(`create:${name}`); return { name, creation_date: '2026-09-20T00:00:00Z' }; },
    isPublic: async () => false,
  };
  await ensureBuckets(['foundation', 'apex'], api, {}, async (name) => events.push(`save:${name}`));
  assert.deepEqual(events, ['create:foundation', 'save:foundation', 'create:apex', 'save:apex']);
});

test('backs up exact state bytes under an immutable, content-addressed key', async () => {
  const writes = [];
  const client = { send: async (command) => {
    if (command.constructor.name === 'GetObjectCommand') return command.input.Key === 'terraform.tfstate' ? body() : missing();
    writes.push(command); return {};
  } };
  const result = await backupState(client, 'state-test');
  assert.equal(result.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(writes[0].input.IfNoneMatch, '*');
  assert.deepEqual(writes[0].input.Body, bytes);
});

test('refuses existing buckets without matching creation receipts or with public access', async () => {
  const existing = { name: 'apex', creation_date: '2026-09-20T00:00:00Z' };
  const api = { get: async () => existing, isPublic: async () => false };
  await assert.rejects(ensureBuckets(['apex'], api, {}, async () => {}), /ownership/);
  api.isPublic = async () => true;
  await assert.rejects(ensureBuckets(['apex'], api, { apex: existing.creation_date }, async () => {}), /public/);
});

test('reuses matching owned buckets without creating them again', async () => {
  const existing = { name: 'apex', creation_date: '2026-09-20T00:00:00Z' };
  await ensureBuckets(['apex'], { get: async () => existing, isPublic: async () => false, create: () => assert.fail('duplicate create') }, { apex: existing.creation_date }, () => assert.fail('duplicate receipt'));
});

test('missing state is allowed only for an explicitly initial apply', async () => {
  const client = { send: async () => { throw Object.assign(new Error('missing'), { name: 'NoSuchKey' }); } };
  await assert.rejects(backupState(client, 'state-test'), /missing/);
  assert.equal(await backupState(client, 'state-test', { allowMissing: true }), null);
});

test('does not mistake access errors for missing state and rejects malformed state', async () => {
  const denied = { send: async () => { throw Object.assign(new Error('denied'), { name: 'AccessDenied' }); } };
  await assert.rejects(backupState(denied, 'state-test', { allowMissing: true }), /denied/);
  await assert.rejects(backupState({ send: async () => body(Buffer.from('{}')) }, 'state-test'), /state/);
});

test('an existing immutable backup must contain the same bytes', async () => {
  let reads = 0;
  const client = { send: async (command) => {
    if (command.constructor.name === 'PutObjectCommand') throw Object.assign(new Error('exists'), { name: 'PreconditionFailed' });
    return body(++reads === 1 ? bytes : Buffer.from('different'));
  } };
  await assert.rejects(backupState(client, 'state-test'), /mismatch/);
});

test('failed apply still backs up partial state and preserves failure', async () => {
  const events = [];
  const code = await applyWithBackups(async (phase) => events.push(phase), async () => { events.push('apply'); return 1; });
  assert.equal(code, 1);
  assert.deepEqual(events, ['before', 'apply', 'after']);
});

test('failed pre-backup prevents apply; failed post-backup fails the operation', async () => {
  await assert.rejects(applyWithBackups(async () => { throw new Error('backup failed'); }, () => assert.fail('apply must not run')), /backup failed/);
  await assert.rejects(applyWithBackups(async (phase) => { if (phase === 'after') throw new Error('post-backup failed'); }, async () => 0), /post-backup failed/);
});

test('malformed state errors never include the original state bytes', async () => {
  await assert.rejects(backupState({ send: async () => body(Buffer.from('private-fixture-value')) }, 'state-test'), { message: 'Invalid Terraform state' });
});

test('daily snapshots remain available even when the state has not changed for months', async () => {
  const client = { send: async (command) => command.constructor.name === 'GetObjectCommand' ? (command.input.Key === 'terraform.tfstate' ? body() : missing()) : {} };
  const first = await backupState(client, 'state-test', { day: '2026-09-20' });
  const second = await backupState(client, 'state-test', { day: '2026-09-21' });
  assert.notEqual(first.key, second.key);
  assert.equal(first.sha256, second.sha256);
});
