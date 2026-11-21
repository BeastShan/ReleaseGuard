import { spawn, execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { commitSchema, policySchema, repositorySchema } from '../src/core/contracts.ts';
import { processEvidence } from '../src/core/normalize.ts';
import { redact, sanitizeEvidence } from '../src/core/redact.ts';
import { labEvidence, labPolicy, scenarios } from './scenarios.ts';
import type { Scenario } from './scenarios.ts';

type Mode = 'broken' | 'repaired';
type Case = { mode: Mode; seed?: number; expected: number };
type Run = Case & { exitCode: number | null; signal: string | null; log: string; matched: boolean };

const root = fileURLToPath(new URL('..', import.meta.url));
const usage = 'Usage: npm run demo -- [--scenario ID] [--single broken|repaired] [--seed 17|29] [--out DIR]';

function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject).listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address !== 'string') resolve(address.port);
        else reject(new Error('Could not assign an isolated test port.'));
      });
    });
  });
}

function execute(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) {
  return new Promise<{ exitCode: number | null; signal: string | null; output: string }>((resolve, reject) => {
    const group = process.platform !== 'win32';
    const child = spawn(command, args, { cwd, env, detached: group, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const append = (data: Buffer) => { output = (output + data.toString()).slice(-1_000_000); };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    const timeout = setTimeout(() => {
      if (group && child.pid) {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { /* The child may have already exited. */ }
      } else {
        child.kill('SIGKILL');
      }
    }, 135_000);
    child.once('error', (error) => { clearTimeout(timeout); reject(error); });
    child.once('close', (exitCode, signal) => { clearTimeout(timeout); resolve({ exitCode, signal, output }); });
  });
}

async function runCase(id: Scenario, run: Case, directory: string): Promise<Run> {
  const workspace = await mkdtemp(join(tmpdir(), 'releaseguard-lab-'));
  const scenario = scenarios[id];
  try {
    const paths = ['src', 'dashboard', 'tests', 'lab', 'package.json', 'package-lock.json', 'tsconfig.json', 'playwright.config.ts'];
    for (const path of paths) {
      await cp(join(root, path), join(workspace, path), {
        recursive: true,
        filter: (source) => !['.next', 'node_modules'].includes(basename(source)),
      });
    }
    await symlink(join(root, 'node_modules'), join(workspace, 'node_modules'), 'junction');
    if (run.mode === 'broken' && scenario.change) {
      const file = join(workspace, scenario.path);
      const [original, replacement] = scenario.change;
      const source = await readFile(file, 'utf8');
      if (source.split(original).length !== 2) throw new Error(`Lab patch must match exactly once in ${scenario.path}.`);
      await writeFile(file, source.replace(original, replacement));
    }

    const home = join(workspace, '.home');
    await mkdir(home);
    const webPort = await reservePort();
    let apiPort = await reservePort();
    while (apiPort === webPort) apiPort = await reservePort();
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, HOME: home, USERPROFILE: home,
      TMPDIR: workspace, TEMP: workspace, TMP: workspace, CI: 'true',
      NO_COLOR: '1', FORCE_COLOR: '0', NEXT_TELEMETRY_DISABLED: '1',
      PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(homedir(), '.cache', 'ms-playwright'),
      PLAYWRIGHT_CHROMIUM_EXECUTABLE: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
      RG_TEST_DASHBOARD_PORT: String(webPort), RG_TEST_API_PORT: String(apiPort),
      RG_LAB_STARTUP_PORT: String(apiPort),
      RELEASEGUARD_API_PORT: id === 'configuration' && run.mode === 'broken' ? 'not-a-port' : String(apiPort),
      RG_LAB_SEED: run.seed && String(run.seed) || undefined,
    };
    const browser = id === 'frontend';
    const args = browser
      ? ['node_modules/@playwright/test/cli.js', 'test', '--grep', scenario.target, '--reporter=list']
      : ['node_modules/vitest/vitest.mjs', 'run', '--config', 'lab/vitest.config.ts', '-t', scenario.target];
    const { exitCode, signal, output } = await execute(process.execPath, args, workspace, env);
    const safeOutput = redact(output.replaceAll(workspace, '<lab-workspace>').replaceAll(root, '<repository>')).trim();
    const log = `${run.mode}${run.seed === undefined ? '' : `-seed-${run.seed}`}.log`;
    await writeFile(join(directory, log), `Command: node ${args.join(' ')}\nExit code: ${exitCode ?? signal}\n\n${safeOutput}\n`);
    const matched = exitCode === run.expected && (run.expected === 0 || safeOutput.includes(scenario.signature));
    console.log(`${id} ${run.mode}${run.seed === undefined ? '' : ` seed=${run.seed}`}: exit ${exitCode ?? signal}, ${matched ? 'matched' : 'UNEXPECTED'}`);
    if (!matched) console.error(safeOutput);
    return { ...run, exitCode, signal, log, matched };
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

async function runScenario(id: Scenario, directory: string, repository: string, commit: string, cleanCheckout: boolean) {
  const output = join(directory, id);
  await mkdir(output, { recursive: true });
  const cases: Case[] = id === 'flaky'
    ? [{ mode: 'broken', seed: 17, expected: 1 }, { mode: 'broken', seed: 29, expected: 0 },
       { mode: 'repaired', seed: 17, expected: 0 }, { mode: 'repaired', seed: 29, expected: 0 }]
    : [{ mode: 'broken', expected: 1 }, { mode: 'repaired', expected: 0 }];
  const attempts: Run[] = [];
  for (const entry of cases) attempts.push(await runCase(id, entry, output));
  const complete = attempts.every((result) => result.matched);
  await writeFile(join(output, 'verification.json'), JSON.stringify({
    version: 1, scenario: id, repository, commit, cleanCheckout, nodeVersion: process.version, verified: complete, attempts,
  }, null, 2) + '\n');
  if (!complete) return false;

  const failed = attempts.find((attempt) => attempt.exitCode === 1)!;
  const logs = (await readFile(join(output, failed.log), 'utf8')).split('\n')
    .filter((line) => line.trim()).slice(-78).map((line) => line.slice(0, 1_000));
  const evidence = sanitizeEvidence(labEvidence({
    repository, commit, observedAt: new Date().toISOString(), logs,
    // A paired repair is a different code/config variant. Only same-variant repeats establish flakiness.
    ...(id === 'flaky' ? { attempts: attempts.filter((attempt) => attempt.mode === 'broken').map((attempt) => ({
      label: `Broken baseline, seed ${attempt.seed}`,
      result: attempt.exitCode === 0 ? 'passed' : 'failed',
      detail: `Exit ${attempt.exitCode}. See ${attempt.log}.`,
    })) } : {}),
  }, id));
  const { incident, task } = processEvidence(evidence, labPolicy(repository));
  for (const [name, value] of Object.entries({ evidence, incident, task })) {
    await writeFile(join(output, `${name}.json`), JSON.stringify(value, null, 2) + '\n');
  }
  return true;
}

function git(...args: string[]) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

async function main() {
  const { values } = parseArgs({ options: {
    scenario: { type: 'string' }, single: { type: 'string' }, seed: { type: 'string' },
    out: { type: 'string' }, help: { type: 'boolean' },
  } });
  if (values.help) { console.log(usage); return; }
  const scenario = values.scenario;
  if (scenario && !Object.hasOwn(scenarios, scenario)) throw new Error(`Unknown scenario. ${usage}`);
  const single = values.single;
  if (single && (!scenario || (single !== 'broken' && single !== 'repaired'))) throw new Error(usage);
  if (values.seed && (scenario !== 'flaky' || !single || !['17', '29'].includes(values.seed))) throw new Error(usage);
  const output = resolve(root, values.out ?? 'artifacts/demo');
  await mkdir(output, { recursive: true });
  if ((single === 'broken' || single === 'repaired') && scenario) {
    const seed = scenario === 'flaky' ? Number(values.seed ?? '17') : undefined;
    const expected = single === 'broken' && seed !== 29 ? 1 : 0;
    const attempt = await runCase(scenario as Scenario, { mode: single, seed, expected }, output);
    console.log((await readFile(join(output, attempt.log), 'utf8')).trimEnd());
    process.exitCode = attempt.matched ? attempt.exitCode ?? 2 : 2;
    return;
  }

  const commit = commitSchema.parse(git('rev-parse', 'HEAD'));
  const cleanCheckout = git('status', '--porcelain') === '';
  const repository = repositorySchema.parse(process.env.GITHUB_REPOSITORY ?? 'BeastShan/ReleaseGuard').toLowerCase();
  const policy = policySchema.parse(labPolicy(repository));
  await writeFile(join(output, 'policy.json'), JSON.stringify(policy, null, 2) + '\n');
  const selected = scenario ? [scenario as Scenario] : Object.keys(scenarios) as Scenario[];
  let passed = 0;
  for (const id of selected) if (await runScenario(id, output, repository, commit, cleanCheckout)) passed++;
  console.log(`Verified ${passed}/${selected.length} scenarios. Reports: ${output}`);
  if (passed !== selected.length) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? redact(error.message) : 'Lab run failed.');
  process.exitCode = 1;
});
