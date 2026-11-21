# Verification evidence

The checks below ran on a clean checkout of ReleaseGuard commit `4dd3689fb2fed4e19fead3c6bc9971178c72cea4` on Node.js 24.22.3 with Playwright's bundled Chromium. The subsequent evidence commit adds these reports. A fresh install from the lockfile also completed successfully.

- [Verification summary](local/summary.json), [Vitest output](local/test.log), [Playwright report](local/playwright.json), and [Next.js build output](local/build.log).
- [Production smoke test](local/production-smoke.json) from the built Next.js application, API, and worker. It imports a lab fixture through the CLI and reads back the resulting job through the dashboard API.
- [Workflow lint](local/actionlint.log) and [npm audit](local/npm-audit.json).

The local verification run passed 12 Vitest tests and three Playwright tests. The lab verified all 14 isolated executions across six scenarios.

| Scenario | Broken or baseline variant | Repaired variant | Evidence |
| --- | --- | --- | --- |
| Frontend | [Exit 1](local/demo/frontend/broken.log) | [Exit 0](local/demo/frontend/repaired.log) | [Verification](local/demo/frontend/verification.json) |
| API contract | [Exit 1](local/demo/api-contract/broken.log) | [Exit 0](local/demo/api-contract/repaired.log) | [Incident](local/demo/api-contract/incident.json) and [task](local/demo/api-contract/task.json) |
| Worker | [Exit 1](local/demo/worker/broken.log) | [Exit 0](local/demo/worker/repaired.log) | [Verification](local/demo/worker/verification.json) |
| Deterministic test | [Exit 1](local/demo/test/broken.log) | [Exit 0](local/demo/test/repaired.log) | [Verification](local/demo/test/verification.json) |
| Startup configuration | [Exit 1](local/demo/configuration/broken.log) | [Exit 0](local/demo/configuration/repaired.log) | [Verification](local/demo/configuration/verification.json) |
| Flaky polling test | [Seed 17 exit 1](local/demo/flaky/broken-seed-17.log), [seed 29 exit 0](local/demo/flaky/broken-seed-29.log) | [Seed 17 exit 0](local/demo/flaky/repaired-seed-17.log), [seed 29 exit 0](local/demo/flaky/repaired-seed-29.log) | [Verification](local/demo/flaky/verification.json) |

## Live GitHub ingestion

The CLI collected real metadata for a completed, failed [GitHub Actions run](https://github.com/actions/setup-node/actions/runs/44623996634/job/135912853485). The signed job-log download was unavailable from the verification environment, so the CLI retained a [metadata-only record](github/metadata-only.json). The GitHub connector separately fetched the same job's log. Its [exit-code line](github/job-log-excerpt.txt) was added to the evidence and passed through the CLI fixture importer, producing a [normalized record](github/connector-log-record.json). This third-party run verifies ingestion and is independent of ReleaseGuard's own CI status.

## Re-run

Run `npm ci`, `npx playwright install chromium`, and `npm run verify`. New reports are written under `artifacts/verification/`. The regular GitHub Actions workflow is configured to run the same verification and upload that directory. A passing hosted ReleaseGuard Actions run still needs to be verified after publication.
