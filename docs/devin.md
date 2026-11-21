# Devin handoff and prospective integration

ReleaseGuard exports a provider-independent [task JSON contract](../schemas/task.schema.json) and a [result schema](../schemas/agent-result.schema.json). The [TypeScript adapter](../src/integrations/devin.ts) defines a future dispatch and result interface and currently fails closed. There is no enabled API client, provider session, or dispatch endpoint.

## Handoff contract

| Field | What the reviewer checks |
| --- | --- |
| `repository`, `baseCommit`, `incidentId` | Authorized repository, full failing commit, and original evidence provenance |
| `approvedPaths`, `state` | Paths configured by the operator plus an approval decision bound to the exact task |
| `reproduction`, `mandatoryTests` | Trusted baselines and tests suitable for the disposable runner |
| `acceptanceCriteria` | Explicit expected behavior, regression assertion, and required evidence |
| `budget` | Maximum wall-clock minutes and stop-and-report behavior |
| `isolation` | Workspace policy, egress controls, credentials, and disabled merge and deployment |
| `responsibilities`, `humanReview` | Phase duties and the approvals necessary for each transition |
| `evidence`, `finalOutput` | Untrusted inputs and the response schema reference |

Each phase returns JSON with incident ID, base commit, status, summary, changed paths, test commands and phases, exit codes, evidence references, and residual risks. Attach logs to a restricted artifact store. Reviewers validate evidence references and reconcile changed paths with an independently computed diff. The emitted budget is a contract for the future runner. It requires provider-side cancellation plus an independent timeout, and should be paired with an account-level spend limit.

## Responsibilities and gates

1. **Investigation** starts after maintainer approval. Use a read-only checkout at the exact base commit in a disposable, credential-free workspace. Reproduce once and attach command, exit code, and sanitized output. If it cannot be reproduced, return a blocked or not-reproduced result and document the missing condition.
2. **Repair** needs a second approval bound to the investigation result, paths, and budget. Use a fresh disposable workspace at the base SHA. Validate role-specific permissions and paths before the session. Preserve tests and produce a candidate diff. Stop when the needed changes reach beyond approved paths.
3. **Validation** runs independently in a new workspace against the candidate SHA. Check the base and changed paths, guard against symlink and rename escapes using actual Git diff data, and compare baseline and candidate results from the unchanged reproduction. Run all mandatory tests and attach sanitized outputs. A reviewer decides whether a draft PR is warranted and approves any eventual merge or release out of band.

## Pilot sequence

1. Start with an internal test repository and export tasks for manual review. Grade whether maintainers can reproduce the failure and understand the proposed scope without a session.
2. Register a narrowly scoped GitHub App and a Devin service credential in a secret manager. Add an authenticated coordinator that stores task digests, approvals, provider session identifiers, budget state, and audit events. Bind an idempotency key to the task digest and phase. Make offline validation of permissions, path rules, and retention part of provider onboarding.
3. Enable investigation only for individually opted-in tasks. Check mismatch handling, budget cancellation, egress restrictions, structured results, and log redaction against the manually reviewed baselines.
4. Permit repair only after a separate approval in the pilot repository. Pass any candidate to independent validation. Keep token privileges separate from the provider. Give a dedicated GitHub identity draft-PR creation rights only if needed. Keep merge and deployment permissions outside the system.

The prospective pilot needs an authorized Devin account, approved provider capabilities for isolated execution and cancellation, and repository owner participation. The [tracking issue draft](devin-tracking-issue.md) lists implementation milestones.
