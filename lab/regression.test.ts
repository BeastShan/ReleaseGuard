import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, test } from 'vitest';
import { buildApi } from '../src/api/server.ts';
import { waitForJob } from '../src/collect/poll.ts';
import { processEvidence } from '../src/core/normalize.ts';
import { sampleEvidence } from '../tests/fixtures.ts';

test('API response contract regression', async () => {
  const api = buildApi();
  try {
    const response = await api.inject('/health');
    expect(response.json(), 'RG_API_CONTRACT').toEqual({ status: 'ok' });
  } finally {
    await api.close();
  }
});

test('worker failure regression', async () => {
  const api = buildApi();
  try {
    const accepted = await api.inject({ method: 'POST', url: '/v1/evidence', payload: sampleEvidence() });
    expect(accepted.statusCode).toBe(202);
    const { jobId } = accepted.json();
    const result = await waitForJob(async () => (await api.inject(`/v1/jobs/${jobId}`)).json(), { attempts: 150, intervalMs: 60 });
    expect(result, 'RG_WORKER_FAILURE').toMatchObject({
      status: 'succeeded', result: { task: { baseCommit: 'a'.repeat(40) } },
    });
  } finally {
    await api.close();
  }
});

test('deterministic test failure', () => {
  expect(processEvidence(sampleEvidence()).incident.id, 'RG_TEST_FAILURE').toMatch(/^rg-[a-f0-9]{24}$/);
});

test('configuration startup failure', async () => {
  const child = spawn(process.execPath, ['src/api/main.ts'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'exit');
  let errorOutput = '';
  child.stderr.on('data', (data: Buffer) => { errorOutput += data.toString(); });
  child.stdout.resume();
  try {
    let healthy = false;
    const deadline = Date.now() + 7_000;
    while (Date.now() < deadline && child.exitCode === null) {
      try {
        const response = await fetch(`http://127.0.0.1:${process.env.RG_LAB_STARTUP_PORT}/health`, {
          signal: AbortSignal.timeout(500),
        });
        healthy = response.ok && (await response.json()).status === 'ok';
        if (healthy) break;
      } catch { /* Wait for the loopback server to become available. */ }
      await delay(60);
    }
    expect(healthy, errorOutput.trim() || 'API did not become healthy.').toBe(true);
  } finally {
    child.kill();
    await exited;
  }
});

test('flaky polling race', async () => {
  const seed = Number(process.env.RG_LAB_SEED);
  if (seed !== 17 && seed !== 29) throw new Error('Replay seed must be 17 or 29.');
  const readyAtPoll = seed === 17 ? 2 : 1;
  let reads = 0;
  const job = await waitForJob(async () => ({
    status: ++reads >= readyAtPoll ? 'succeeded' as const : 'running' as const,
  }), { attempts: 4, intervalMs: 0 });
  console.log(`Replay seed ${seed}: job ready on poll ${readyAtPoll}, observed ${job.status} after ${reads} reads.`);
  expect(job.status, 'RG_FLAKE_REPLAY').toBe('succeeded');
});
