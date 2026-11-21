import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import type { Evidence, Policy } from '../core/contracts.ts';
import type { processEvidence } from '../core/normalize.ts';

type Output = ReturnType<typeof processEvidence>;
type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';
type JobSummary = {
  id: string;
  status: JobStatus;
  repository: string;
  target: string;
  source: Evidence['source']['kind'];
  observedAt: string;
  incidentId?: string;
  category?: Output['incident']['category'];
  taskState?: Output['task']['state'];
};
type Job = JobSummary & { result?: Output; failure?: string };

export class LocalQueue {
  private readonly jobs = new Map<string, Job>();
  private readonly pending: { job: Job; evidence: Evidence }[] = [];
  private running = false;
  private stopping = false;
  private worker?: Worker;

  private readonly policy: Policy;
  private readonly capacity: number;

  constructor(policy: Policy, capacity = 200) {
    this.policy = policy;
    this.capacity = capacity;
  }

  submit(evidence: Evidence): JobSummary | undefined {
    if (this.stopping || this.jobs.size >= this.capacity) return undefined;
    const job: Job = {
      id: randomUUID(),
      status: 'queued',
      repository: evidence.repository,
      target: evidence.failingTarget,
      source: evidence.source.kind,
      observedAt: evidence.observedAt,
    };
    this.jobs.set(job.id, job);
    this.pending.push({ job, evidence });
    queueMicrotask(() => void this.drain());
    return { ...job };
  }

  get(id: string) {
    return this.jobs.get(id);
  }

  list(): JobSummary[] {
    return Array.from(this.jobs.values(), ({ result, failure, ...summary }) => summary).reverse();
  }

  async close() {
    this.stopping = true;
    this.pending.length = 0;
    await this.worker?.terminate();
  }

  private async drain() {
    if (this.running || this.stopping) return;
    this.running = true;
    while (!this.stopping) {
      const next = this.pending.shift();
      if (!next) break;
      const { job, evidence } = next;
      job.status = 'running';
      try {
        const result = await this.run(evidence);
        job.result = result;
        job.incidentId = result.incident.id;
        job.category = result.incident.category;
        job.taskState = result.task.state;
        job.status = 'succeeded';
      } catch {
        job.failure = 'RG_WORKER_FAILURE: Evidence processing did not complete.';
        job.status = 'failed';
      }
    }
    this.running = false;
  }

  private async run(evidence: Evidence): Promise<Output> {
    const worker = new Worker(new URL('./entry.ts', import.meta.url), {
      workerData: { evidence, policy: this.policy },
      env: {},
      execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: 128 },
    });
    this.worker = worker;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await new Promise<Output>((resolve, reject) => {
        worker.once('message', resolve);
        worker.once('error', reject);
        worker.once('exit', (code) => reject(new Error(`Worker exited before responding (${code}).`)));
        timeout = setTimeout(() => reject(new Error('Worker timed out.')), 10_000);
      });
    } finally {
      clearTimeout(timeout);
      await worker.terminate();
      this.worker = undefined;
    }
  }
}
