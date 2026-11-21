import { expect, it } from 'vitest';
import { buildApi } from '../../src/api/server.ts';
import { waitForJob } from '../../src/collect/poll.ts';
import { labPolicy } from '../../lab/scenarios.ts';
import { sampleEvidence } from '../fixtures.ts';

it('accepts a versioned application error and completes a worker job', async () => {
  const evidence = sampleEvidence({ source: { kind: 'application', service: 'worker' }, failingTarget: 'Job processing', logs: ['worker exception'] });
  const api = buildApi(labPolicy(evidence.repository));
  try {
    const accepted = await api.inject({ method: 'POST', url: '/v1/evidence', payload: evidence });
    expect(accepted.statusCode).toBe(202);
    const { jobId } = accepted.json();
    const result = await waitForJob(async () => (await api.inject(`/v1/jobs/${jobId}`)).json(), { attempts: 120, intervalMs: 50 });
    expect(result).toMatchObject({
      status: 'succeeded',
      result: { incident: { category: 'worker' }, task: { state: 'approval-required', baseCommit: evidence.commit } },
    });
    const { jobs } = (await api.inject('/v1/jobs')).json();
    expect(jobs).toMatchObject([{ id: jobId, status: 'succeeded', category: 'worker' }]);
    expect(jobs[0]).not.toHaveProperty('result');
  } finally {
    await api.close();
  }
});

it('rejects wrong origin, malformed evidence, media type, and unknown IDs', async () => {
  const api = buildApi();
  try {
    const post = { method: 'POST' as const, url: '/v1/evidence' };
    expect((await api.inject({ ...post, headers: { origin: 'https://other.example' }, payload: sampleEvidence() })).statusCode).toBe(403);
    expect((await api.inject({ url: '/v1/jobs', headers: { host: 'other.example' } })).statusCode).toBe(403);
    expect((await api.inject({ ...post, payload: {} })).statusCode).toBe(400);
    expect((await api.inject({ ...post, headers: { 'content-type': 'text/plain' }, payload: '{}' })).statusCode).toBe(415);
    expect((await api.inject('/v1/jobs/invalid')).statusCode).toBe(404);
  } finally {
    await api.close();
  }
});

it('applies bounded queue backpressure without replacing accepted jobs', async () => {
  const api = buildApi(undefined, 1);
  try {
    const payload = { method: 'POST' as const, url: '/v1/evidence', payload: sampleEvidence() };
    const first = await api.inject(payload);
    const second = await api.inject(payload);
    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(503);
    const { jobs } = (await api.inject('/v1/jobs')).json();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe(first.json().jobId);
  } finally {
    await api.close();
  }
});
