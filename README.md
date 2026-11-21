# ReleaseGuard

ReleaseGuard turns CI failures and application errors into evidence-backed engineering tasks. It collects a failed GitHub Actions run or versioned local JSON, normalizes the evidence, and produces a handoff pinned to the failing commit. A repository policy supplies reproduction commands, permitted paths, acceptance criteria, and mandatory tests. A human reviews every handoff before any future agent session.

The project includes a Next.js dashboard, a Fastify API, a Node.js worker thread, and a local queue. It runs on loopback and stores jobs in memory.

## Start locally

Use Node.js 24 and npm. With nvm, run `nvm install && nvm use` to use the version pinned in the repository.

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:3000`. The API listens on `http://127.0.0.1:4100`. In the same terminal, set `RELEASEGUARD_API_PORT` before startup if you need a different API port. For a production build on your local machine, run `npm run build`, then run `npm run api` and `npm run start:dashboard` in separate shells.

### Collect a failure

To import the recorded lab evidence, choose **Import evidence** in the dashboard and select the generated `artifacts/demo/api-contract/evidence.json`. You can also submit it from a separate terminal.

```sh
npm run demo -- --scenario api-contract
npm run collect -- fixture artifacts/demo/api-contract/evidence.json --submit
```

For a GitHub Actions run, pass the owner, repository, and run ID from its URL. Use a fine-grained token with read access to Actions for authenticated log downloads. Supply it through `GH_TOKEN` or `GITHUB_TOKEN` in the collector's shell. GitHub may expose public run metadata while restricting log downloads. Use your operating system's trusted CA store and proxy configuration where required, via `NODE_USE_SYSTEM_CA=1` and `NODE_USE_ENV_PROXY=1`.

```sh
npm run collect -- github OWNER/REPO RUN_ID --out artifacts/collected
npm run collect -- github OWNER/REPO RUN_ID --submit
```

For an application error, write a document conforming to the [evidence schema](schemas/evidence.schema.json) with source `{"kind":"application","service":"api"}` and submit it the same way as a fixture. Include only the relevant already-sanitized log lines and the deployed commit. Review any export before sharing it.

Without `--submit`, the CLI works offline for fixtures and emits an evidence, incident, and task record without starting the dashboard. Use `--out DIR` for one JSON file per incident or omit it for JSON on standard output. Run `node src/collect/main.ts` directly if piping program output into another tool.

### Configure a trusted policy

Set `RELEASEGUARD_POLICY` to a JSON policy you control before starting the API or offline collector. Match repositories and categories exactly and provide explicit paths, reproduction steps, mandatory checks, acceptance criteria, and a budget. Without a matching rule, the handoff remains **Blocked**. A matching rule produces **Needs approval**. The API reads policy once at startup.

The lab generates an example policy alongside its evidence. This is tailored to the lab's controlled overlays and should stay restricted to demo use.

```sh
npm run demo -- --scenario api-contract
RELEASEGUARD_POLICY=artifacts/demo/policy.json npm run dev
```

Open the imported incident, then select **Engineering task** to inspect or download the JSON handoff. See the [policy schema](schemas/policy.schema.json) and [Devin handoff](docs/devin.md).

## Verify the project

```sh
npx playwright install chromium
npm audit --audit-level=moderate
npm run verify
```

On Linux, use `npx playwright install --with-deps chromium` if browser system dependencies are missing. To use a locally installed Chromium, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to its executable path.

Verification checks schema drift, both TypeScript projects, Vitest, the Next.js build, browser behavior, and all six scenarios. The lab runs each defect in fresh copies of the source and checks the failing exit code, expected diagnostic, and passing result from the same unchanged assertion in the repaired copy. The default GitHub Actions workflow uses this verification command on hosted runners and uploads evidence. A separate manually dispatched workflow can create a deliberately failing Actions run for testing the collector.

See the [demonstration instructions](docs/demonstrations.md), [architecture](docs/architecture.md), [engineering roadmap](docs/roadmap.md), and [verification reports](docs/evidence/README.md).

## Operating limits

The queue retains up to 200 jobs per API process, with one active worker. Export anything you want to keep before restarting. The application is intended for a trusted local operator with no shared authentication or persistence. The collector uses heuristic categorization and redaction. Independent validation, enforced path and budget controls, approvals, draft PR creation, and any Devin API calls belong to a future orchestration service. The supplied Devin adapter is disabled and the application never invokes it.

Licensed under the [MIT License](LICENSE).
