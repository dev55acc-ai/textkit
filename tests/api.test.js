const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const mod = require('../api/index.js');

function startServer() {
  const server = http.createServer((req, res) => {
    res.startTime = Date.now();
    mod.route(req, res);
  });
  return new Promise((resolve) => server.listen(0, () => resolve(server)));
}

test('textkit local integration', async (t) => {
  const server = await startServer();
  const base = `http://localhost:${server.address().port}`;
  t.after(() => new Promise((r) => server.close(r)));

  await t.test('health has processing_ms and X-Response-Time', async () => {
    const r = await fetch(`${base}/v1/health`);
    const j = await r.json();
    assert.strictEqual(r.status, 200);
    assert.strictEqual(j.status, 'ok');
    assert.strictEqual(typeof j.processing_ms, 'number');
    assert.ok(j.processing_ms < 50);
    assert.match(r.headers.get('x-response-time'), /^\d+(\.\d+)?ms$/);
  });

  await t.test('schema carries truthful limits', async () => {
    const r = await fetch(`${base}/v1/schema`);
    const j = await r.json();
    assert.strictEqual(j.limits.request_body_max_bytes, 65536);
    assert.strictEqual(j.limits.auth, 'none');
  });

  await t.test('slug schema example exact', async () => {
    const r = await fetch(`${base}/v1/slug`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Héllo, World! This is TextKit', separator: '_' }),
    });
    assert.deepStrictEqual(await r.json(), { slug: 'hello_world_this_is_textkit' });
  });

  await t.test('body over 64KB -> payload_too_large', async () => {
    const big = JSON.stringify({ text: 'a'.repeat(70 * 1024) });
    const r = await fetch(`${base}/v1/slug`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: big,
    });
    assert.strictEqual(r.status, 400);
    assert.strictEqual((await r.json()).error, 'payload_too_large');
  });

  await t.test('every endpoint emits X-Response-Time', async () => {
    const paths = [['/v1/slug', 'POST'], ['/v1/html-to-text', 'POST'], ['/v1/text-stats', 'POST'], ['/v1/case', 'POST']];
    for (const [p] of paths) {
      const r = await fetch(`${base}${p}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(p === '/v1/html-to-text'
          ? { html: '<p>x</p>' }
          : p === '/v1/case' ? { text: 'A B', to: 'snake' } : { text: 'x y z' }),
      });
      assert.strictEqual(r.status, 200);
      assert.ok(r.headers.get('x-response-time'), `${p} missing X-Response-Time`);
    }
  });
});
