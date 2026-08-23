const BASE = process.env.BASE_URL || 'https://rapidapi-roan.vercel.app';
const row = {
  ts: new Date().toISOString(),
  checks: [],
  ok: true,
};

async function timed(fn) {
  const t0 = Date.now();
  const r = await fn();
  return { ...r, latency_ms: Date.now() - t0 };
}

// Check 1: GET /v1/health answers 200 with status ok
try {
  const c1 = await timed(async () => {
    const res = await fetch(`${BASE}/v1/health`);
    const body = await res.json();
    return { name: 'health', http_status: res.status, pass: res.status === 200 && body.status === 'ok' };
  });
  row.checks.push(c1);
} catch (e) {
  row.checks.push({ name: 'health', http_status: 0, pass: false, error: String(e) });
}

// Check 2: POST /v1/slug returns the documented example output exactly
try {
  const c2 = await timed(async () => {
    const res = await fetch(`${BASE}/v1/slug`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Héllo, World! This is TextKit', separator: '_' }),
    });
    const body = await res.json();
    return { name: 'slug', http_status: res.status, pass: res.status === 200 && body.slug === 'hello_world_this_is_textkit' };
  });
  row.checks.push(c2);
} catch (e) {
  row.checks.push({ name: 'slug', http_status: 0, pass: false, error: String(e) });
}

row.ok = row.checks.every((c) => c.pass);

import { appendFileSync, mkdirSync } from 'node:fs';
mkdirSync('uptime', { recursive: true });
appendFileSync('uptime/log.jsonl', JSON.stringify(row) + '\n');

console.log(JSON.stringify(row));
if (!row.ok) process.exit(1);
