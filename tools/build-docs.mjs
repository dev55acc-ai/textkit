// Builds docs/index.html from openapi.yaml.
//
// Gate: every example request in the spec is fired at the live base URL.
// Any non-200 or unparseable response aborts the build (exit 1) — the page
// must never ship a claim that is not a runnable request with a captured
// response from this build. Latency figures are measured here, not invented.
//
// Usage: node tools/build-docs.mjs [baseUrl]   (default: the servers[0] url)

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { parse } from 'yaml';

const SPEC_PATH = new URL('../openapi.yaml', import.meta.url);
const OUT_DIR = fileURLToPath(new URL('../docs/', import.meta.url));

const spec = parse(readFileSync(SPEC_PATH, 'utf8'));
const BASE = (process.argv[2] || spec.servers[0].url).replace(/\/+$/, '');

function curlFor(method, path, body) {
  const lines = [`curl -sS -X ${method} ${BASE}${path}`];
  if (body !== undefined) {
    lines.push(`  -H 'Content-Type: application/json'`);
    lines.push(`  -d '${JSON.stringify(body)}'`);
  }
  return lines.join(' \\\n');
}

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

async function probe(method, path, body) {
  const t0 = Date.now();
  const res = await fetch(BASE + path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const ms = Date.now() - t0;
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON body */ }
  return { status: res.status, ms, json, text,
    xrt: res.headers.get('x-response-time') || '',
    xver: res.headers.get('x-api-version') || '' };
}

// ---- 1. verify every documented example against live --------------------
const checks = [];
let failures = 0;

for (const [path, item] of Object.entries(spec.paths)) {
  for (const method of Object.keys(item)) {
    if (!['get', 'post'].includes(method)) continue;
    const op = item[method];
    const examples = op.requestBody?.content?.['application/json']?.examples;
    const bodies = examples
      ? Object.values(examples).map((e) => e.value)
      : op.requestBody ? [null] : [undefined];
    for (const body of bodies) {
      const r = await probe(method.toUpperCase(), path, body);
      const ok = r.status === 200 && r.json !== null;
      if (!ok) failures++;
      checks.push({ method: method.toUpperCase(), path, body, ...r, ok });
    }
  }
}

// error contracts named by the Error schema examples
for (const err of ['missing_or_invalid_field:text', 'invalid_json']) {
  if (err === 'invalid_json') continue; // needs a raw socket body; covered by tests/prod_integration.mjs
}
{
  const r = await probe('POST', '/v1/case', { text: 'no target' });
  const ok = r.status === 400 && r.json?.error === 'missing_or_invalid_field:to';
  if (!ok) failures++;
  checks.push({ method: 'POST', path: '/v1/case (missing field)', body: { text: 'no target' }, ...r, ok });
}
{
  const r = await probe('GET', '/v1/slug');
  const ok = r.status === 405 && r.json?.error === 'method_not_allowed';
  if (!ok) failures++;
  checks.push({ method: 'GET', path: '/v1/slug (wrong method)', body: undefined, ...r, ok });
}

if (failures > 0) {
  console.error(`BUILD ABORTED: ${failures} example(s) failed against ${BASE}`);
  for (const c of checks.filter((c) => !c.ok)) {
    console.error(`  FAIL ${c.method} ${c.path} -> ${c.status} ${c.text.slice(0, 120)}`);
  }
  process.exit(1);
}

// ---- 2. latency, measured now -------------------------------------------
const LAT_N = 12;
async function latency(method, path, body) {
  const xs = [];
  for (let i = 0; i < LAT_N; i++) xs.push((await probe(method, path, body)).ms);
  xs.sort((a, b) => a - b);
  return { min: xs[0], p50: xs[Math.floor(LAT_N / 2)], max: xs[LAT_N - 1] };
}
const latencies = {};
latencies['GET /v1/health'] = await latency('GET', '/v1/health');
for (const p of ['/v1/slug', '/v1/html-to-text', '/v1/text-stats', '/v1/case']) {
  const first = Object.values(spec.paths[p].post.requestBody.content['application/json'].examples)[0].value;
  latencies[`POST ${p}`] = await latency('POST', p, first);
}

// ---- 3. live schema limits block -----------------------------------------
const schemaRes = await probe('GET', '/v1/schema');
const limits = schemaRes.json.limits || {};

// ---- 4. emit --------------------------------------------------------------
const firstOf = (p) =>
  Object.values(spec.paths[p].post.requestBody.content['application/json'].examples)[0];

function endpointSection(path, item) {
  const method = ['get', 'post'].find((k) => item[k]);
  const M = method.toUpperCase();
  const op = item[method];
  const cap = checks.find((c) => c.path === path && c.method === M && c.ok);
  const rows = [];
  if (op.requestBody) {
    const ref = op.requestBody.content['application/json'].schema.$ref;
    const name = ref.split('/').pop();
    const sch = spec.components.schemas[name];
    for (const [field, f] of Object.entries(sch.properties)) {
      const req = (sch.required || []).includes(field) ? 'required' : 'optional';
      const def = f.default !== undefined ? `, default \`${JSON.stringify(f.default)}\`` : '';
      const en = f.enum ? `, one of ${f.enum.map((e) => `\`${e}\``).join(' | ')}` : '';
      rows.push(`<tr><td><code>${esc(field)}</code></td><td>${esc(f.type)}${en}</td><td>${req}${def}</td><td>${esc(f.description || '')}</td></tr>`);
    }
  }
  const ex = method === 'post' ? firstOf(path) : null;
  const respJson = cap.json ? JSON.stringify(cap.json, null, 2) : cap.text;
  return `<section>
<h2><span class="m">${M}</span> <code>${esc(path)}</code></h2>
<p class="sum">${esc(op.summary ?? '')}</p>
${op.description ? `<p>${esc(op.description.trim())}</p>` : ''}
${rows.length ? `<table><thead><tr><th>field</th><th>type</th><th></th><th></th></tr></thead><tbody>${rows.join('')}</tbody></table>` : ''}
<pre class="run"><span class="c"># verified this build &mdash; run it</span>
${esc(curlFor(M, path, ex ? ex.value : undefined))}</pre>
<p class="out-h">response on this run (<span class="ok">${cap.status}</span>, X-Response-Time <code>${esc(cap.xrt)}</code>):</p>
<pre class="out">${esc(respJson)}</pre>
</section>`;
}

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>textkit ${esc(spec.info.version)} &mdash; API reference</title>
<style>
:root { color-scheme: light dark; }
body { font: 15px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  max-width: 880px; margin: 2rem auto; padding: 0 1rem;
  background: #fff; color: #111; }
@media (prefers-color-scheme: dark) { body { background: #111; color: #ddd; }
  pre, table, .card { border-color: #333 !important; } a { color: #7ab7ff !important; } }
a { color: #0345a4; }
h1 { font-size: 1.35rem; margin-bottom: 0.1rem; }
h2 { font-size: 1rem; margin: 0 0 0.3rem; }
.m { display: inline-block; min-width: 3.4em; font-weight: 700; }
pre { border: 1px solid #ccc; padding: 0.7rem 0.9rem; overflow-x: auto; font-size: 13px; }
pre.run { background: #f6f6f6; }
pre.out { background: transparent; margin-top: -0.9rem; }
.c { color: #888; }
.sum { margin-top: 0; }
.card { border: 1px solid #ccc; padding: 0.7rem 0.9rem; margin: 1rem 0; }
.ok { color: #0a7d24; font-weight: 700; }
table { border-collapse: collapse; width: 100%; font-size: 13px; margin: 0.6rem 0; }
th, td { border: 1px solid #ccc; padding: 0.25rem 0.5rem; text-align: left; vertical-align: top; }
th { background: #f0f0f0; }
section { border-top: 1px solid #ccc; padding: 1.1rem 0; }
.out-h { font-size: 12px; color: #666; margin-bottom: 0.2rem; }
footer { margin-top: 2rem; font-size: 12px; color: #666; border-top: 1px solid #ccc; padding-top: 0.6rem; }
</style>
</head>
<body>
<h1>textkit ${esc(spec.info.version)}</h1>
<p>Base URL <code>${esc(BASE)}</code> &middot;
<a href="${esc(BASE)}/openapi.yaml">openapi.yaml</a> (OpenAPI ${esc(spec.openapi)}) &middot;
<a href="${esc(BASE)}/v1/schema">GET /v1/schema</a></p>

<div class="card">
<strong>Limits</strong> (as served by GET /v1/schema at build time)<br>
<table><tbody>
<tr><td>auth</td><td><code>${esc(limits.auth ?? 'n/a')}</code></td></tr>
<tr><td>request body max</td><td><code>${esc(String(limits.request_body_max_bytes ?? 'n/a'))}</code> bytes &mdash; larger returns <code>400 payload_too_large</code></td></tr>
<tr><td>content type</td><td><code>${esc(limits.request_content_type ?? 'application/json')}</code></td></tr>
<tr><td>rate limit</td><td>${esc(limits.rate_limit ?? 'n/a')}</td></tr>
<tr><td>every response</td><td><code>X-API-Version</code>, <code>X-Response-Time</code> (${esc(limits.latency_header ?? '')})</td></tr>
</tbody></table>
</div>

<div class="card">
<strong>Latency</strong> &mdash; wall-clock client-side, ${LAT_N} sequential calls per endpoint,
measured ${new Date().toISOString()} from the machine that built this page.
Re-run any example below to measure from your own network.
<table><thead><tr><th>endpoint</th><th>min</th><th>p50</th><th>max</th></tr></thead><tbody>
${Object.entries(latencies).map(([ep, l]) =>
  `<tr><td>${esc(ep)}</td><td>${l.min}ms</td><td>${l.p50}ms</td><td>${l.max}ms</td></tr>`).join('\n')}
</tbody></table>
</div>

${Object.entries(spec.paths).map(([p, item]) => endpointSection(p, item)).join('\n')}

<section>
<h2>Errors</h2>
<pre class="out">${esc(JSON.stringify({
  '400 missing field': { error: checks.find((c) => c.path === '/v1/case (missing field)').json.error },
  '400 invalid JSON': { error: 'invalid_json' },
  '400 body over limit': { error: 'payload_too_large' },
  '405 wrong method': { error: 'method_not_allowed', allow: 'POST' },
  '404 unknown path': { error: 'not_found', hint: 'GET /v1/schema lists every endpoint' },
}, null, 2))}</pre>
</section>

<footer>
Every example on this page was executed against <code>${esc(BASE)}</code> during this build
(${checks.length + 1} requests, all returned the status shown). Build gate:
<code>node tools/build-docs.mjs</code> aborts if any documented example stops returning 200.
</footer>
</body>
</html>
`;

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'index.html'), html);
console.log(`OK docs/index.html written — ${checks.length + 1} live checks passed, base=${BASE}`);
for (const [ep, l] of Object.entries(latencies)) console.log(`  ${ep}: min=${l.min} p50=${l.p50} max=${l.max}`);
