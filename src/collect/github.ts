import { z } from 'zod';
import { commitSchema, repositorySchema } from '../core/contracts.ts';
import type { Evidence } from '../core/contracts.ts';
import { redact, sanitizeEvidence } from '../core/redact.ts';

const runSchema = z.object({
  name: z.string().min(1),
  head_sha: commitSchema,
  run_attempt: z.number().int().positive(),
  updated_at: z.iso.datetime(),
  status: z.literal('completed'),
  conclusion: z.enum(['failure', 'timed_out', 'startup_failure', 'action_required']),
});
const jobSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  conclusion: z.string().nullable(),
  completed_at: z.iso.datetime().nullable(),
  steps: z.array(z.object({ name: z.string(), conclusion: z.string().nullable() })).optional(),
});
const jobsSchema = z.object({ total_count: z.number().int().nonnegative(), jobs: z.array(jobSchema) });
const negativeConclusions = new Set(['failure', 'timed_out', 'startup_failure', 'action_required']);
const logsLimit = 8 * 1024 * 1024;

async function fetchLog(path: string, request: (path: string) => Promise<Response>, fetcher: typeof fetch) {
  let response = await request(path);
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get('location');
    await response.body?.cancel();
    if (!location) throw new Error('Missing log redirect.');
    const url = new URL(location);
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
        !/(^|\.)(actions\.githubusercontent\.com|blob\.core\.windows\.net)$/.test(url.hostname)) {
      throw new Error('Unexpected log redirect destination.');
    }
    response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(20_000) });
  }
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error('Job log download unavailable.');
  }
  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let size = 0;
  let text = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > logsLimit) throw new Error('Job log exceeds download budget.');
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    await reader.cancel();
  }
}

// Retain nearby error lines and the tail in chronological order.
function excerpts(raw: string) {
  const lines = redact(raw).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const selected = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    if (!/##\[error\]|(?:AssertionError|TypeError|SyntaxError|Error:|RG_[A-Z_]+|FAIL\b)/i.test(lines[i])) continue;
    for (let index = Math.max(0, i - 1); index <= Math.min(lines.length - 1, i + 2); index++) selected.add(index);
  }
  return [
    ...[...selected].filter((index) => index < lines.length - 18).slice(-54).map((index) => lines[index]),
    ...lines.slice(-18),
  ].map((line) => line.slice(0, 1_000));
}

export async function collectGitHub(
  repositoryInput: string, runId: number, token?: string, fetcher: typeof fetch = fetch,
): Promise<Evidence[]> {
  const repository = repositorySchema.parse(repositoryInput).toLowerCase();
  if (!Number.isSafeInteger(runId) || runId < 1) throw new Error('Run ID must be a positive integer.');
  const request = (path: string) => fetcher(new URL(path, 'https://api.github.com'), {
    redirect: 'manual',
    signal: AbortSignal.timeout(20_000),
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const get = async (path: string) => {
    const response = await request(path);
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`GitHub Actions request failed (HTTP ${response.status}).`);
    }
    return response.json();
  };
  const runPath = `/repos/${repository}/actions/runs/${runId}`;
  const parsed = runSchema.safeParse(await get(runPath));
  if (!parsed.success) throw new Error('Expected a completed, unsuccessful GitHub Actions run.');
  const run = parsed.data;

  const failedJobs: z.infer<typeof jobSchema>[] = [];
  for (let page = 1; ; page++) {
    const results = jobsSchema.parse(await get(`${runPath}/attempts/${run.run_attempt}/jobs?per_page=100&page=${page}`));
    failedJobs.push(...results.jobs.filter((job) => negativeConclusions.has(job.conclusion ?? '')));
    if (results.total_count > 1_000 || failedJobs.length > 50) {
      throw new Error('Run exceeds the collector limit of 1,000 jobs or 50 failed jobs.');
    }
    if (page * 100 >= results.total_count || results.jobs.length === 0) break;
  }
  if (!failedJobs.length) throw new Error('No failed job was exposed for this workflow run.');

  const records: Evidence[] = [];
  for (const job of failedJobs) {
    const failedSteps = (job.steps ?? []).filter((step) => negativeConclusions.has(step.conclusion ?? ''));
    const metadata = [
      `GitHub Actions job: ${job.name} (${job.conclusion})`,
      ...failedSteps.slice(0, 6).map((step) => `Failed step: ${step.name}`),
    ];
    let logs: string[];
    try {
      const raw = await fetchLog(`/repos/${repository}/actions/jobs/${job.id}/logs`, request, fetcher);
      logs = excerpts(raw);
      if (!logs.length) logs = ['GitHub returned an empty job log.'];
    } catch {
      logs = ['Job log unavailable, exceeded the collector limit, or returned an unsupported redirect.'];
    }
    records.push(sanitizeEvidence({
      version: 1,
      repository,
      commit: run.head_sha,
      observedAt: job.completed_at ?? run.updated_at,
      failingTarget: redact([run.name, job.name, failedSteps[0]?.name].filter(Boolean).join(' / ')).slice(0, 300),
      source: { kind: 'github-actions', runId, runAttempt: run.run_attempt, jobId: job.id },
      logs: [...metadata.map((line) => redact(line).slice(0, 1_000)), ...logs],
    }));
  }
  return records;
}
