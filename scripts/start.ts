// Supervise one web process and one fixture worker for a self-hosted installation.
import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { configuration } from '../src/runtime.ts';

const demo = process.argv.includes('--demo');
const dev = process.argv.includes('--dev');
process.env.LEAGUE_DEMO = demo ? '1' : '0';
const config = configuration();
const host = demo ? '127.0.0.1' : process.env.HOST || '127.0.0.1';
const cli = createRequire(import.meta.url).resolve('next/dist/bin/next');
const children: ChildProcess[] = [];
let stopping = false;
function stop(code: number) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill('SIGTERM');
}
for (const args of [
  [cli, dev ? 'dev' : 'start', '--hostname', host, '--port', String(config.port)],
  ['scripts/worker.ts'],
]) {
  const child = spawn(process.execPath, args, { stdio: 'inherit' });
  children.push(child);
  child.on('error', (error) => {
    console.error(error.message);
    stop(1);
  });
  child.on('exit', (code) => stop(code ?? 1));
}
process.on('SIGTERM', () => stop(0));
process.on('SIGINT', () => stop(0));
