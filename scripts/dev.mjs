// Sobe backend e frontend juntos em modo de desenvolvimento.
import { spawn } from 'node:child_process';

const children = [
  spawn('npm', ['--prefix', 'backend', 'run', 'dev'], { stdio: 'inherit', shell: false }),
  spawn('npm', ['--prefix', 'frontend', 'run', 'dev'], { stdio: 'inherit', shell: false }),
];

const stop = () => children.forEach((child) => child.kill('SIGINT'));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
children.forEach((child) => child.on('exit', (code) => { if (code) { stop(); process.exit(code); } }));
