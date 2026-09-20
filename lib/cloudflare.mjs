import { config } from './config.mjs';

export function bucketApi(token, fetchImpl = fetch) {
  const request = async (name, method = 'GET', suffix = '', body) => {
    const response = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${config.account_id}/r2/buckets${name ? `/${encodeURIComponent(name)}` : ''}${suffix}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000),
    });
    if (method === 'GET' && response.status === 404 && !suffix) return null;
    let result;
    try { result = await response.json(); } catch { throw new Error('Invalid Cloudflare response'); }
    if (!response.ok || !result.success) throw new Error(`Cloudflare request failed: HTTP ${response.status}`);
    return result.result;
  };
  return {
    get: (name) => request(name),
    create: (name) => request('', 'POST', '', { name, storageClass: 'Standard' }),
    isPublic: async (name) => {
      const managed = await request(name, 'GET', '/domains/managed');
      const custom = await request(name, 'GET', '/domains/custom');
      if (typeof managed?.enabled !== 'boolean' || !Array.isArray(custom?.domains)) throw new Error('Unknown bucket exposure');
      return managed.enabled || custom.domains.length > 0;
    },
  };
}
