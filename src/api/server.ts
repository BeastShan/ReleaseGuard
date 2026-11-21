import Fastify from 'fastify';
import { z } from 'zod';
import type { Policy } from '../core/contracts.ts';
import { emptyPolicy } from '../core/normalize.ts';
import { sanitizeEvidence } from '../core/redact.ts';
import { LocalQueue } from '../worker/queue.ts';

export function buildApi(policy: Policy = emptyPolicy, capacity = 200) {
  const api = Fastify({ logger: false, bodyLimit: 192 * 1024, requestTimeout: 10_000 });
  const queue = new LocalQueue(policy, capacity);
  api.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!/^(127\.0\.0\.1|localhost)(:\d{1,5})?$/.test(request.headers.host ?? '') || request.headers.origin) {
      return reply.code(403).send({ error: 'Local API requests only.' });
    }
  });
  api.addHook('onClose', () => queue.close());
  api.setErrorHandler((error, _request, reply) => {
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    reply.code(status).send({ error: status < 500 ? 'Invalid request.' : 'Internal API error.' });
  });
  api.get('/health', async () => ({ status: 'ok' }));
  api.get('/v1/jobs', async () => ({ jobs: queue.list() }));
  api.get<{ Params: { id: string } }>('/v1/jobs/:id', async (request, reply) => {
    const id = z.uuid().safeParse(request.params.id);
    const job = id.success ? queue.get(id.data) : undefined;
    return job ?? reply.code(404).send({ error: 'Job not found.' });
  });
  api.post('/v1/evidence', async (request, reply) => {
    if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      return reply.code(415).send({ error: 'Expected application/json.' });
    }
    let evidence;
    try {
      evidence = sanitizeEvidence(request.body);
    } catch {
      return reply.code(400).send({ error: 'Evidence did not match the version 1 contract.' });
    }
    const job = queue.submit(evidence);
    if (!job) return reply.code(503).send({ error: 'The local queue is full. Export your evidence before restarting it.' });
    return reply.code(202).send({ jobId: job.id, status: job.status });
  });
  return api;
}
