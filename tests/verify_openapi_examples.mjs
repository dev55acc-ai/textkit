// Verifies every example embedded in openapi.yaml against LIVE production.
import assert from 'node:assert/strict';

const BASE = 'https://rapidapi-roan.vercel.app';
let pass = 0, fail = 0;

async function check(name, fn) {
  try { await fn(); pass++; console.log(`PASS ${name}`); }
  catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`); }
}

async function req(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

await check('GET /v1/health -> 200 status ok version 1.0.0', async () => {
  const r = await req('GET', '/v1/health');
  assert.equal(r.status, 200);
  assert.equal(r.json.status, 'ok');
  assert.equal(r.json.version, '1.0.0');
});

await check('POST /v1/slug default -> hello-world-example', async () => {
  const r = await req('POST', '/v1/slug', { text: 'Hello World Example' });
  assert.deepEqual(r, { status: 200, json: { slug: 'hello-world-example' } });
});

await check('POST /v1/slug separator=_ diacritics -> hello_world_this_is_textkit', async () => {
  const r = await req('POST', '/v1/slug', { text: 'Héllo, World! This is TextKit', separator: '_' });
  assert.deepEqual(r, { status: 200, json: { slug: 'hello_world_this_is_textkit' } });
});

await check('POST /v1/slug lowercase=false sep=+ -> Hello+World', async () => {
  const r = await req('POST', '/v1/slug', { text: 'Hello World', lowercase: false, separator: '+' });
  assert.deepEqual(r, { status: 200, json: { slug: 'Hello+World' } });
});

await check('POST /v1/html-to-text -> Title\\nHello & welcome.', async () => {
  const r = await req('POST', '/v1/html-to-text', { html: '<h1>Title</h1><p>Hello &amp; welcome.</p>' });
  assert.deepEqual(r, { status: 200, json: { text: 'Title\nHello & welcome.' } });
});

await check('POST /v1/text-stats fox sentence -> exact stats object', async () => {
  const r = await req('POST', '/v1/text-stats', { text: 'The quick brown fox jumps over the lazy dog.' });
  assert.deepEqual(r.json, { characters: 44, words: 9, sentences: 1, paragraphs: 1, reading_time_seconds: 3 });
  assert.equal(r.status, 200);
});

for (const [to, expected] of [
  ['camel', 'helloWorldExample'], ['snake', 'hello_world_example'],
  ['upper', 'HELLO WORLD EXAMPLE'], ['lower', 'hello world example'],
  ['title', 'Hello World Example'], ['pascal', 'HelloWorldExample'],
  ['kebab', 'hello-world-example'],
]) {
  await check(`POST /v1/case to=${to} -> ${expected}`, async () => {
    const r = await req('POST', '/v1/case', { text: 'Hello World Example', to });
    assert.deepEqual(r, { status: 200, json: { result: expected } });
  });
}

await check('POST /v1/slug missing text -> 400 missing_or_invalid_field:text', async () => {
  const r = await req('POST', '/v1/slug', {});
  assert.equal(r.status, 400);
  assert.deepEqual(r.json, { error: 'missing_or_invalid_field:text' });
});

await check('GET /v1/slug -> 405 method_not_allowed allow POST', async () => {
  const res = await fetch(BASE + '/v1/slug');
  const json = await res.json();
  assert.equal(res.status, 405);
  assert.equal(json.error, 'method_not_allowed');
  assert.equal(res.headers.get('allow') || json.allow, 'POST');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
