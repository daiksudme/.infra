import { readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

try {
  const [file, command, ...args] = process.argv.slice(2);
  if (!file || !command || (statSync(file).mode & 0o077)) throw new Error();
  const values = JSON.parse(readFileSync(file, 'utf8'));
  const allowed = ['CLOUDFLARE_API_TOKEN', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'GITHUB_TOKEN', 'GH_TOKEN'];
  if (!values || Array.isArray(values) || !Object.keys(values).length || Object.entries(values).some(([key, value]) => !allowed.includes(key) || typeof value !== 'string' || !value.trim())) throw new Error();
  const result = spawnSync(command, args, { env: { ...process.env, ...values }, stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
} catch {
  console.error('Use with-secrets.mjs PRIVATE_JSON COMMAND...; credentials must be nonempty strings in an owner-only file. No credential content was logged.');
  process.exitCode = 1;
}
