import type { Evidence } from '../src/core/contracts.ts';

export function sampleEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    version: 1,
    repository: 'example/releaseguard',
    commit: 'a'.repeat(40),
    observedAt: '2026-01-01T00:00:00.000Z',
    failingTarget: 'API response schema check',
    source: { kind: 'fixture' },
    logs: ['RG_API_CONTRACT: expected status to be ok'],
    ...overrides,
  };
}
