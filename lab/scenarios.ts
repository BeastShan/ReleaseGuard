import type { Evidence, Policy } from '../src/core/contracts.ts';

export const scenarios = {
  frontend: {
    target: 'frontend rendering regression',
    signature: 'RG_FRONTEND_RENDER',
    path: 'dashboard/app/page.tsx',
    change: ['<h1>Incidents</h1>', '<h1 hidden>Incidents</h1>'],
    acceptance: 'The incident inbox heading is visible to the browser and accessibility tree.',
  },
  'api-contract': {
    target: 'API response contract regression',
    signature: 'RG_API_CONTRACT',
    path: 'src/api/server.ts',
    change: ["async () => ({ status: 'ok' })", 'async () => ({ ready: true })'],
    acceptance: 'GET /health returns HTTP 200 with the status field equal to ok.',
  },
  worker: {
    target: 'worker failure regression',
    signature: 'RG_WORKER_FAILURE',
    path: 'src/worker/entry.ts',
    change: [
      'parentPort?.postMessage(processEvidence(evidence, policy));',
      'throw new Error("Controlled worker exception");',
    ],
    acceptance: 'A valid evidence submission finishes successfully and produces a pinned engineering task.',
  },
  test: {
    target: 'deterministic test failure',
    signature: 'RG_TEST_FAILURE',
    path: 'src/core/normalize.ts',
    change: ["hash.digest('hex').slice(0, 24)", "hash.digest('hex').slice(0, 8)"],
    acceptance: 'Incident IDs retain the rg- prefix and exactly 24 hexadecimal characters.',
  },
  configuration: {
    target: 'configuration startup failure',
    signature: 'RG_CONFIG_INVALID',
    path: 'src/api/main.ts',
    change: null,
    acceptance: 'The API starts with a valid numeric port and serves a healthy response.',
  },
  flaky: {
    target: 'flaky polling race',
    signature: 'RG_FLAKE_REPLAY',
    path: 'src/collect/poll.ts',
    change: [
      "if (job.status === 'succeeded' || job.status === 'failed') return job;",
      'return job; // Controlled premature read',
    ],
    acceptance: 'The polling client waits for a terminal job under both recorded readiness schedules.',
  },
} as const;

export type Scenario = keyof typeof scenarios;

export function labPolicy(repository: string): Policy {
  const rules = Object.fromEntries(Object.entries(scenarios).map(([id, scenario]) => [
    id,
    {
      approvedPaths: [scenario.path],
      reproduction: [`npm run demo -- --scenario ${id} --single broken`],
      mandatoryTests: [`npm run demo -- --scenario ${id}`, 'npm run verify'],
      acceptanceCriteria: [scenario.acceptance, 'Preserve the assertion and attach captured baseline and candidate outputs.'],
      maxMinutes: 20,
    },
  ]));
  return { version: 1, repositories: [{ repository, rules }] };
}

export function labEvidence(details: Omit<Evidence, 'version' | 'source' | 'failingTarget'>, id: Scenario): Evidence {
  return {
    version: 1,
    ...details,
    source: { kind: 'fixture', scenario: id },
    failingTarget: scenarios[id].target,
  };
}
