import { expect, it } from 'vitest';
import { collectGitHub } from '../../src/collect/github.ts';
import { processEvidence } from '../../src/core/normalize.ts';

const now = '2026-01-01T12:00:00Z';
const run = {
  name: 'CI', status: 'completed', conclusion: 'failure', run_attempt: 2, head_sha: 'b'.repeat(40), updated_at: now,
};
const job = { id: 987, name: 'build', completed_at: now, conclusion: 'failure', steps: [{ name: 'Test', conclusion: 'failure' }] };

it('pins the run attempt, retains failed steps, and redacts log credentials before export', async () => {
  const visited: URL[] = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    visited.push(url);
    const auth = new Headers(init?.headers).get('authorization');
    if (url.hostname === 'example.actions.githubusercontent.com') {
      expect(auth).toBeNull();
      return new Response('RG_API_CONTRACT: response schema mismatch\nAPI_TOKEN=local-test-secret');
    }
    expect(auth).toBe('Bearer dummy-test-value');
    if (url.pathname.endsWith('/runs/123')) return Response.json(run);
    if (url.pathname.endsWith('/attempts/2/jobs')) {
      return url.searchParams.get('page') === '1'
        ? Response.json({ total_count: 101, jobs: Array.from({ length: 100 }, (_, index) => ({ ...job, id: index + 1, conclusion: 'success' })) })
        : Response.json({ total_count: 101, jobs: [job] });
    }
    return new Response(null, { status: 302, headers: { Location: 'https://example.actions.githubusercontent.com/log' } });
  };
  const [evidence] = await collectGitHub('Example/ReleaseGuard', 123, 'dummy-test-value', fakeFetch);
  expect(visited).toHaveLength(5);
  expect(evidence.source).toMatchObject({ kind: 'github-actions', runAttempt: 2, jobId: 987 });
  expect(evidence.commit).toBe(run.head_sha);
  expect(evidence.logs).toContain('Failed step: Test');
  expect(evidence.logs.join(' ')).not.toContain('local-test-secret');
  expect(processEvidence(evidence).incident.category).toBe('api-contract');
});

it('never follows an unexpected log redirect and preserves limited metadata', async () => {
  let requests = 0;
  const fakeFetch: typeof fetch = async (input) => {
    requests++;
    const url = new URL(String(input));
    if (url.pathname.endsWith('/runs/123')) return Response.json(run);
    if (url.pathname.endsWith('/jobs')) return Response.json({ total_count: 1, jobs: [job] });
    return new Response(null, { status: 302, headers: { Location: 'https://unrelated.invalid/signed-url' } });
  };
  const [evidence] = await collectGitHub('example/releaseguard', 123, undefined, fakeFetch);
  expect(requests).toBe(3);
  expect(evidence.logs.at(-1)).toContain('Job log unavailable');
  expect(JSON.stringify(evidence)).not.toContain('unrelated.invalid');
});

it('rejects a successful run before retrieving job logs', async () => {
  const fakeFetch: typeof fetch = async () => Response.json({ ...run, conclusion: 'success' });
  await expect(collectGitHub('example/releaseguard', 123, undefined, fakeFetch)).rejects.toThrow('unsuccessful');
});
