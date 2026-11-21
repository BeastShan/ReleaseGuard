# Reproducible failure lab

Start from a clean Git checkout so the report accurately describes the pinned revision. Install npm dependencies and Playwright Chromium before running the frontend case.

```sh
npm ci
npx playwright install chromium
npm run demo
npm run demo -- --scenario flaky --out artifacts/flaky
```

The lab copies the test sources and services into temporary workspaces. It applies one controlled source change to each broken copy or supplies an invalid startup setting. The same test runs against a fresh copy of the repaired source or corrected configuration. Each child process gets a restricted environment, its own local ports, and a time limit. Runs write logs and remove their temporary source copies.

| Scenario | Controlled defect | Unchanged verification |
| --- | --- | --- |
| `frontend` | Hide the incident inbox heading | Playwright requires the heading to be visible |
| `api-contract` | Replace the health response status field | Vitest checks the actual Fastify response shape |
| `worker` | Throw during evidence processing | Submit through Fastify and wait for a real worker task |
| `test` | Shorten the incident ID digest | Vitest checks the exact stable ID shape |
| `configuration` | Supply a nonnumeric API port | Launch the API process and require healthy loopback HTTP |
| `flaky` | Return from polling before terminal status | Replay two schedules of job readiness against the same polling logic |

The flaky case uses reproducible scheduling inputs. Seed 17 requires two polls and fails against the premature return. Seed 29 requires one poll and passes against the same broken code. The repaired poller passes both. The artifact records baseline attempts under the same variant separately from the repaired results.

For each scenario, inspect `verification.json` with exit codes and log names, the actual broken and repaired logs, and the generated `evidence.json`, `incident.json`, and `task.json`. The policy example is in the report root. When a run is launched with local changes, the report records that fact in `cleanCheckout`.

To see a raw red test exit without making the main CI workflow fail, run either variant directly. The single-variant runner forwards the expected exit code and uses exit 2 for an unexpected result.

```sh
npm run demo -- --scenario api-contract --single broken
npm run demo -- --scenario api-contract --single repaired
npm run demo -- --scenario flaky --single broken --seed 29
```

Manually dispatch [Opt-in failure lab](https://github.com/BeastShan/ReleaseGuard/actions/workflows/failure-lab.yml) for a chosen scenario if you need a real failed Actions job. Collect that run ID with the GitHub collector. The regular **CI** workflow verifies both variants as a passing job and uploads reports.
