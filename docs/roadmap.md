# 30-day engineering roadmap

The repository implements a local evidence collector, bounded queue, dashboard, engineering task export, and failure lab. This roadmap covers a shared, controlled Devin pilot.

| Days | Work | Exit condition |
| --- | --- | --- |
| 1–5 | Establish GitHub CI evidence baselines. Exercise the collector against controlled failed jobs, run attempts, expired logs, and private repositories. Review redaction, pagination, and evidence retention. | One opt-in failed run can be collected end to end, and a maintainer can reproduce the linked case from exported evidence. |
| 6–10 | Define repository enrollment and operator identity. Add authenticated approval records bound to task hashes, scoped GitHub credentials, durable audit events, and an explicit retention policy. | Unauthorized approvals and cross-repository lookups fail in integration tests. |
| 11–17 | Implement the Devin transport behind the current interface. Add idempotent dispatch, verified status or callbacks, deadlines, cancellation, and schema-checked results. Assess provider controls against the isolation contract. | An owner can manually authorize and terminate a read-only investigation in a disposable repository. |
| 18–24 | Add separate repair authority and independent diff validation. Enforce canonical path scope, reject unexpected file types and renames, and require mandatory tests in a fresh runner. | A candidate outside scope is blocked and an in-scope candidate produces reviewed evidence. |
| 25–30 | Pilot on a small batch of one-repository cases. Record reproduction rate, handoff revisions, budget consumption, and false scope suggestions. Verify operator runbooks and review the evidence before widening access. | Owners document pilot results and make an explicit rollout decision. |

Plan for roughly **15–22 engineer-days** of implementation and validation within the 30-day window, plus 2–4 reviewer days. Estimates assume a small pilot and prompt access to a Devin organization and an authorized GitHub repository. Provider limitations around sandboxing, cancellation, or scoped Git access can extend the schedule. Add persistence for approval and session audit state before the pilot. Evaluate a durable job queue when multi-instance processing or restart recovery is required.
