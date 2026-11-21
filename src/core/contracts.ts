import { z } from 'zod';

export const repositorySchema = z.string().max(140).regex(
  /^[a-z0-9][a-z0-9-]{0,38}\/[a-z0-9_][a-z0-9_.-]{0,99}$/i,
);
export const commitSchema = z.string().regex(/^[a-f0-9]{40}$/i);
export const categories = [
  'frontend', 'api-contract', 'worker', 'test', 'configuration', 'flaky', 'unknown',
] as const;

const attemptSchema = z.object({
  label: z.string().min(1).max(80),
  result: z.enum(['failed', 'passed']),
  detail: z.string().min(1).max(200),
});
const positiveId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export const evidenceSchema = z.object({
  version: z.literal(1),
  repository: repositorySchema,
  commit: commitSchema,
  observedAt: z.iso.datetime(),
  failingTarget: z.string().min(1).max(300),
  logs: z.array(z.string().max(1_000)).min(1).max(80),
  attempts: z.array(attemptSchema).max(20).optional(),
  source: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('fixture'), scenario: z.enum(categories).optional() }),
    z.object({ kind: z.literal('application'), service: z.enum(['frontend', 'api', 'worker']) }),
    z.object({
      kind: z.literal('github-actions'),
      runId: positiveId,
      runAttempt: positiveId,
      jobId: positiveId,
    }),
  ]),
}).strict();

const approvedPathSchema = z.string().max(200).regex(/^[\w.-]+(?:\/[\w.-]+)*\/?$/).refine(
  (path) => path.split('/').every((part) => !['.', '..', '.git', '.github'].includes(part.toLowerCase())),
  'Use explicit repository-relative paths outside .git and .github',
);

const trustedRulesSchema = z.object({
  approvedPaths: z.array(approvedPathSchema).min(1).max(30),
  reproduction: z.array(z.string().trim().min(1).max(300)).min(1).max(10),
  mandatoryTests: z.array(z.string().trim().min(1).max(300)).min(1).max(10),
  acceptanceCriteria: z.array(z.string().trim().min(1).max(300)).min(1).max(10),
  maxMinutes: z.number().int().min(5).max(60),
}).strict();

export const policySchema = z.object({
  version: z.literal(1),
  repositories: z.array(z.object({
    repository: repositorySchema,
    rules: z.partialRecord(z.enum(categories), trustedRulesSchema),
  }).strict()).max(100),
}).strict().superRefine(({ repositories }, ctx) => {
  const names = repositories.map(({ repository }) => repository.toLowerCase());
  if (new Set(names).size !== names.length) {
    ctx.addIssue({ code: 'custom', path: ['repositories'], message: 'Repository policy must be unique' });
  }
});

export type Category = (typeof categories)[number];
export type Evidence = z.infer<typeof evidenceSchema>;
export type Policy = z.infer<typeof policySchema>;
export type TrustedRules = z.infer<typeof trustedRulesSchema>;

const incidentIdSchema = z.string().regex(/^rg-[a-f0-9]{24}$/);
const reproductionSchema = z.object({
  status: z.enum(['operator-configured', 'needs-operator']),
  steps: z.array(z.string()).min(1),
}).strict();
const sourceSchema = evidenceSchema.shape.source;
const pathsSchema = z.array(approvedPathSchema);

export const incidentSchema = z.object({
  version: z.literal(1),
  id: incidentIdSchema,
  repository: repositorySchema,
  commit: commitSchema,
  observedAt: z.iso.datetime(),
  failingTarget: z.string(),
  category: z.enum(categories),
  source: sourceSchema,
  logExcerpts: z.array(z.string()),
  attempts: z.array(attemptSchema),
  reproduction: reproductionSchema,
  suspectedScope: z.object({ kind: z.literal('hypothesis'), paths: pathsSchema, explanation: z.string() }).strict(),
  verificationRequirements: z.array(z.string()),
  humanApproval: z.array(z.string()),
}).strict();

export const taskSchema = z.object({
  version: z.literal(1),
  incidentId: incidentIdSchema,
  repository: repositorySchema,
  baseCommit: commitSchema,
  title: z.string(),
  state: z.enum(['approval-required', 'blocked']),
  approvedPaths: pathsSchema,
  acceptanceCriteria: z.array(z.string()).min(1),
  reproduction: reproductionSchema,
  mandatoryTests: z.array(z.string()),
  budget: z.object({
    maxSessionMinutes: z.number().int().min(5).max(60),
    onExceeded: z.literal('stop-and-report'),
  }).strict(),
  isolation: z.object({
    workspace: z.literal('disposable'),
    productionCredentials: z.literal(false),
    network: z.literal('deny-by-default'),
    allowMerge: z.literal(false),
    allowDeploy: z.literal(false),
  }).strict(),
  responsibilities: z.object({
    investigation: z.array(z.string()), repair: z.array(z.string()), validation: z.array(z.string()),
  }).strict(),
  evidence: z.object({
    trust: z.literal('untrusted'),
    source: sourceSchema,
    logExcerpts: z.array(z.string()),
    attempts: z.array(attemptSchema),
  }).strict(),
  finalOutput: z.object({ format: z.literal('json'), schema: z.literal('schemas/agent-result.schema.json') }).strict(),
  humanReview: z.array(z.string()),
}).strict();

export type Incident = z.infer<typeof incidentSchema>;
export type EngineeringTask = z.infer<typeof taskSchema>;

export const agentResultSchema = z.object({
  version: z.literal(1),
  incidentId: incidentIdSchema,
  baseCommit: commitSchema,
  status: z.enum(['repaired', 'not-reproduced', 'blocked', 'budget-exhausted']),
  summary: z.string().min(1),
  changedPaths: z.array(approvedPathSchema),
  tests: z.array(z.object({
    command: z.string().min(1),
    phase: z.enum(['baseline', 'repair', 'validation']),
    exitCode: z.number().int(),
    evidenceRef: z.string().min(1),
  }).strict()),
  residualRisks: z.array(z.string()),
}).strict();

export type AgentResult = z.infer<typeof agentResultSchema>;
