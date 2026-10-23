#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { loadConfig } from '../dist/config.js';
import { join } from 'node:path';

// Read-only snapshot. PSS avoids counting shared pages once for every Chromium process.
try {
  const { dataDir } = loadConfig();
  const lock = JSON.parse(readFileSync(join(dataDir, 'service.lock'), 'utf8'));
  const records = JSON.parse(readFileSync(join(dataDir, 'children.json'), 'utf8'));
  const pids = new Set();
  function visit(pid) {
    if (pids.has(pid) || !existsSync(`/proc/${pid}`)) return;
    pids.add(pid);
    try {
      const children = readFileSync(`/proc/${pid}/task/${pid}/children`, 'utf8').trim();
      for (const child of children.split(/\s+/).filter(Boolean)) visit(Number(child));
    } catch { /* Process exited. */ }
  }
  visit(lock.pid);
  for (const record of records) visit(record.pid);
  let rss = 0, pss = 0, cpuTicks = 0, measured = 0;
  for (const pid of pids) {
    try {
      const memory = readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8');
      rss += Number(/^Rss:\s+(\d+)/m.exec(memory)?.[1] ?? 0);
      pss += Number(/^Pss:\s+(\d+)/m.exec(memory)?.[1] ?? 0);
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ').slice(1).join(') ').split(' ');
      cpuTicks += Number(stat[11]) + Number(stat[12]); measured++;
    } catch { /* Process exited or access unavailable. */ }
  }
  console.log(JSON.stringify({ observed_at: new Date().toISOString(), processes: measured, rss_mib: +(rss / 1024).toFixed(1), pss_mib: +(pss / 1024).toFixed(1), cpu_ticks_cumulative: cpuTicks,
    note: 'Instantané ; mesurer aussi pendant une génération et la maintenance. Le budget 1 CPU / 1–2 Go nécessite un essai sous contrainte.' }, null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
