import { setTimeout as delay } from 'node:timers/promises';

export type JobStatus = { status: 'queued' | 'running' | 'succeeded' | 'failed' };

export async function waitForJob<T extends JobStatus>(
  read: () => Promise<T>,
  { attempts = 100, intervalMs = 150 } = {},
): Promise<T> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const job = await read();
    if (job.status === 'succeeded' || job.status === 'failed') return job;
    if (attempt + 1 < attempts) await delay(intervalMs);
  }
  throw new Error('Timed out waiting for the local job.');
}
