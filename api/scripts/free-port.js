#!/usr/bin/env node
const { execSync } = require('child_process');

const port = process.env.PORT || '3000';

function freePort(p) {
  try {
    const out = execSync(`lsof -ti :${p}`, { encoding: 'utf8' }).trim();
    if (!out) {
      console.log(`Port ${p} is free`);
      return;
    }
    const pids = out.split(/\s+/).filter(Boolean);
    console.log(`Freeing port ${p} (PIDs: ${pids.join(', ')})`);
    pids.forEach((pid) => {
      try {
        process.kill(Number(pid), 'SIGKILL');
      } catch {
        // already gone
      }
    });
  } catch {
    console.log(`Port ${p} is free`);
  }
}

freePort(port);
