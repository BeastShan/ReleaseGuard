# Verification evidence

Running `npm run verify` writes the command outcomes, build and test logs, Playwright JSON results, and per-scenario logs and contracts under `artifacts/verification/`. The same command runs in the regular GitHub Actions workflow, which uploads that directory as a workflow artifact.
