import { parentPort, workerData } from 'node:worker_threads';
import type { Evidence, Policy } from '../core/contracts.ts';
import { processEvidence } from '../core/normalize.ts';

const { evidence, policy } = workerData as { evidence: Evidence; policy: Policy };
parentPort?.postMessage(processEvidence(evidence, policy));
