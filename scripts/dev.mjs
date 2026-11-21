import { spawn } from 'node:child_process';

const commands = [
  [process.execPath, 'src/api/main.ts'],
  [process.execPath, 'node_modules/next/dist/bin/next', 'dev', 'dashboard', '--hostname', '127.0.0.1'],
];
const children = commands.map(([command, ...args]) => spawn(command, args, { stdio: 'inherit' }));
let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill();
}
for (const child of children) {
  child.on('exit', (code) => stop(code ?? 1));
  child.on('error', () => stop(1));
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop(0));
