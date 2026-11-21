import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { redact } from '../src/core/redact.ts';

const reportDir = resolve(process.env.RG_TEST_REPORT_DIR ?? 'artifacts/verification');
await mkdir(reportDir, { recursive: true });
const commands = [
  ['schemas:check'], ['typecheck'], ['test'], ['build'], ['test:e2e'], ['demo'],
];
const outcomes = [];
for (const [command] of commands) {
  const args = ['run', command, ...(command === 'demo' ? ['--', '--out', resolve(reportDir, 'demo')] : [])];
  const child = spawn('npm', args, {
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', NO_COLOR: '1', RG_TEST_REPORT_DIR: reportDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (data) => { output += data; process.stdout.write(data); });
  child.stderr.on('data', (data) => { output += data; process.stderr.write(data); });
  const code = await new Promise((done) => {
    child.once('error', () => done(127));
    child.once('close', (code) => done(code));
  });
  await writeFile(resolve(reportDir, `${command.replace(':', '-')}.log`),
    redact(output.replaceAll(process.cwd(), '<repository>')));
  outcomes.push({ command: 'npm ' + args.join(' ').replaceAll(reportDir, '<reports>'), exitCode: code });
}
await writeFile(resolve(reportDir, 'summary.json'), JSON.stringify({
  nodeVersion: process.version, verifiedAt: new Date().toISOString(), outcomes,
}, null, 2) + '\n');
if (outcomes.some(({ exitCode }) => exitCode !== 0)) process.exitCode = 1;
