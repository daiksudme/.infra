import { bucketFor, endpoint } from './config.mjs';

export function lockProbe(state, key) {
  if (!/^validation\/[0-9a-f-]{36}\/terraform\.tfstate$/.test(key)) throw new Error('A disposable key is required');
  return {
    terraform: {
      required_version: '= 1.16.3',
      backend: { s3: {
        bucket: bucketFor(state), key, region: 'auto', endpoints: { s3: endpoint },
        use_path_style: true, use_lockfile: true, skip_credentials_validation: true,
        skip_region_validation: true, skip_requesting_account_id: true,
        skip_metadata_api_check: true, skip_s3_checksum: true,
      } },
    },
    resource: { terraform_data: { probe: {
      input: 'disposable-lock-check',
      provisioner: [{ 'local-exec': { command: 'node -e "setTimeout(()=>{},10000)"' } }],
    } } },
  };
}
