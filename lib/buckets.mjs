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
