import { readFile } from 'node:fs/promises';
import { policySchema } from './contracts.ts';
import { emptyPolicy } from './normalize.ts';

export async function loadPolicy(path = process.env.RELEASEGUARD_POLICY) {
  if (!path) return emptyPolicy;
  try {
    return policySchema.parse(JSON.parse(await readFile(path, 'utf8')));
  } catch {
    throw new Error('RG_CONFIG_INVALID: RELEASEGUARD_POLICY must point to a valid policy file.');
  }
}
