import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import type { Evidence } from '../core/contracts.ts';
import { processEvidence } from '../core/normalize.ts';
import { loadPolicy } from '../core/policy.ts';
import { sanitizeEvidence } from '../core/redact.ts';
import { collectGitHub } from './github.ts';
import { waitForJob } from './poll.ts';

const usage = 'Usage: npm run collect -- fixture FILE | github OWNER/REPO RUN_ID [--out DIR] [--submit]';
const submitSchema = z.object({ jobId: z.uuid() });
const statusSchema = z.looseObject({ status: z.enum(['queued', 'running', 'succeeded', 'failed']) });

async function submit(evidence: Evidence) {
  const rawPort = process.env.RELEASEGUARD_API_PORT ?? '4100';
  if (!/^\d{1,5}$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65_535) {
    throw new Error('Invalid local API port.');
  }
  const base = `http://127.0.0.1:${rawPort}/v1`;
  const response = await fetch(`${base}/evidence`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(evidence),
    signal: AbortSignal.timeout(5_000),
  });
  if (response.status !== 202) throw new Error(`Local API rejected evidence (HTTP ${response.status}).`);
  const { jobId } = submitSchema.parse(await response.json());
  const job = await waitForJob(async () => {
    const detail = await fetch(`${base}/jobs/${jobId}`, { signal: AbortSignal.timeout(3_000) });
    if (!detail.ok) throw new Error('Could not read the local job status.');
    return statusSchema.parse(await detail.json());
  });
  if (job.status !== 'succeeded') throw new Error('Local worker failed to process the evidence.');
  return z.object({ incident: z.unknown(), task: z.unknown() }).parse(job.result);
}

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { out: { type: 'string' }, submit: { type: 'boolean' }, help: { type: 'boolean' } },
  });
  if (values.help) {
    console.log(usage);
    return;
  }
  let records: Evidence[];
  if (positionals[0] === 'fixture' && positionals.length === 2) {
    records = [sanitizeEvidence(JSON.parse(await readFile(positionals[1], 'utf8')))];
  } else if (positionals[0] === 'github' && positionals.length === 3) {
    records = await collectGitHub(positionals[1], Number(positionals[2]), process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN);
  } else {
    throw new Error(usage);
  }
  const policy = await loadPolicy();
  const directory = values.out ? resolve(values.out) : undefined;
  if (directory) await mkdir(directory, { recursive: true, mode: 0o700 });
  const output = [];
  for (const evidence of records) {
    const normalized = processEvidence(evidence, policy);
    const submission = values.submit ? await submit(evidence) : undefined;
    const record = { evidence, ...(submission ?? normalized) };
    if (directory) {
      const path = resolve(directory, `${normalized.incident.id}.json`);
      await writeFile(path, JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });
      console.error(`Wrote ${path}`);
    }
    output.push(record);
  }
  if (!directory) console.log(JSON.stringify(output, null, 2));
}

main().catch((error: unknown) => {
  const message = error instanceof z.ZodError || error instanceof SyntaxError
    ? 'Input did not match the expected JSON contract.' : error instanceof Error ? error.message : 'Collection failed.';
  console.error(message);
  process.exitCode = 1;
});
