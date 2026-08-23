const BASE = 'https://rapidapi-roan.vercel.app';
let pass = 0, fail = 0;
function check(name, cond, detail='') {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name} :: ${detail}`); }
}
async function call(method, path, body) {
  const t0 = Date.now();
  const r = await fetch(BASE + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, ms: Date.now() - t0, json: await r.json().catch(() => null) };
}

// 1. health
let r = await call('GET', '/v1/health');
check('health 200', r.status === 200 && r.json.status === 'ok' && !!r.json.version, JSON.stringify(r));

// 2. slug — schema example
r = await call('POST', '/v1/slug', { text: 'Héllo, World! This is TextKit', separator: '_' });
check('slug schema example exact', r.status === 200 && r.json.slug === 'hello_world_this_is_textkit', JSON.stringify(r));

// 3. slug default
r = await call('POST', '/v1/slug', { text: 'Hello World' });
check('slug default sep', r.status === 200 && r.json.slug === 'hello-world', JSON.stringify(r));

// 4. html-to-text — schema example
r = await call('POST', '/v1/html-to-text', { html: '<h1>Title</h1><p>Hello &amp; welcome.</p>' });
check('html2t schema example exact', r.status === 200 && r.json.text === 'Title\nHello & welcome.', JSON.stringify(r));

// 5. text-stats — schema example
r = await call('POST', '/v1/text-stats', { text: 'One two three.' });
const want = { characters: 14, words: 3, sentences: 1, paragraphs: 1, reading_time_seconds: 1 };
check('stats schema example exact', r.status === 200 && JSON.stringify(r.json) === JSON.stringify(want), JSON.stringify(r));

// 6. case snake — schema example
r = await call('POST', '/v1/case', { text: 'Hello World Example', to: 'snake' });
check('case schema example exact', r.status === 200 && r.json.result === 'hello_world_example', JSON.stringify(r));

// 7. case camel
r = await call('POST', '/v1/case', { text: 'hello_world_example', to: 'camel' });
check('case camel', r.status === 200 && r.json.result === 'helloWorldExample', JSON.stringify(r));

// 8. missing field -> 400 named field
r = await call('POST', '/v1/case', { text: 'x' });
check('missing to -> 400 field named', r.status === 400 && /field:to/.test(r.json.error || ''), JSON.stringify(r));

// 9. invalid json -> 400
const raw = await fetch(BASE + '/v1/slug', { method: 'POST', headers: {'Content-Type':'application/json'}, body: '{nope' });
check('invalid json -> 400', raw.status === 400);

// 10. GET on POST-only -> 405
r = await call('GET', '/v1/slug');
check('GET slug -> 405', r.status === 405);

// 11. unknown -> 404 pointing at schema
r = await call('GET', '/nope');
check('404 hints schema', r.status === 404 && r.json.hint === 'GET /v1/schema lists every endpoint');

// 12. schema lists all 5 endpoints
r = await call('GET', '/v1/schema');
const paths = (r.json.endpoints || []).map(e => e.path);
check('schema lists 5 endpoints', ['/v1/health','/v1/slug','/v1/html-to-text','/v1/text-stats','/v1/case'].every(p => paths.includes(p)), JSON.stringify(paths));

// 13. latency p50 over 10 calls
const times = [];
for (let i = 0; i < 10; i++) times.push((await call('POST', '/v1/slug', { text: 'latency probe ' + i })).ms);
times.sort((a,b)=>a-b);
console.log(`LATENCY ms: min=${times[0]} p50=${times[5]} max=${times[9]}`);
check('p50 < 1000ms cold-ish', times[5] < 1000, `p50=${times[5]}`);

// 14. schema carries limits
r = await call('GET', '/v1/schema');
check('schema has limits block', r.json.limits && r.json.limits.request_body_max_bytes === 65536 && r.json.limits.auth === 'none', JSON.stringify(r.json.limits || null));

// 15. every response carries X-Response-Time
const rt = await fetch(BASE + '/v1/health');
check('X-Response-Time header present', /^\d+(\.\d+)?ms$/.test(rt.headers.get('x-response-time') || ''), String(rt.headers.get('x-response-time')));

// 16. body over 64KB -> clean 400 payload_too_large
const big = await fetch(BASE + '/v1/slug', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'a'.repeat(70 * 1024) }) });
check('oversized -> 400 payload_too_large', big.status === 400 && (await big.json()).error === 'payload_too_large', `status=${big.status}`);

// 17. health reports server-side processing_ms
r = await call('GET', '/v1/health');
check('health processing_ms numeric', typeof r.json.processing_ms === 'number' && r.json.processing_ms >= 0, JSON.stringify(r.json));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
