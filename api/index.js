const VERSION = '1.0.0';

function json(res, status, body) {
  const buf = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': buf.length,
    'X-API-Version': VERSION,
    'X-Response-Time': `${Date.now() - (res.startTime || Date.now())}ms`,
    'Access-Control-Allow-Origin': '*',
  });
  res.end(buf);
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let aborted = false;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit && !aborted) {
        aborted = true;
        chunks.length = 0;
        req.removeAllListeners('data');
        req.on('data', () => {});
        reject(new Error('payload_too_large'));
        return;
      }
      if (!aborted) chunks.push(c);
    });
    req.on('end', () => { if (!aborted) resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', (e) => { if (!aborted) reject(e); });
  });
}

async function parseJsonBody(req) {
  const raw = await readBody(req);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('body_must_be_object');
    }
    return parsed;
  } catch (e) {
    throw new Error('invalid_json');
  }
}

function requireString(body, field) {
  const v = body[field];
  if (typeof v !== 'string') {
    const err = new Error(`missing_or_invalid_field:${field}`);
    err.field = field;
    throw err;
  }
  return v;
}

function slugify(text, separator = '-', lowercase = true) {
  let s = String(text).normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  s = s.replace(/[''`]/g, '').replace(/[""]/g, '');
  s = s.replace(/[^a-zA-Z0-9]+/g, separator);
  s = s.split(separator).filter(Boolean).join(separator);
  if (lowercase) s = s.toLowerCase();
  return s;
}

function htmlToText(html) {
  let s = String(html);
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<\/(p|div|li|tr|h[1-6]|br)>/gi, '\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<[^>]+>/g, '');
  const entities = {
    '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
    '&#39;': "'", '&#x27;': "'", '&apos;': "'", '&nbsp;': ' ',
    '&mdash;': '—', '&ndash;': '–', '&hellip;': '…', '&copy;': '©',
  };
  s = s.replace(/&(amp|lt|gt|quot|#39|#x27|apos|nbsp|mdash|ndash|hellip|copy);/g,
    (m) => entities[m]);
  s = s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
  s = s.replace(/[ \t]+/g, ' ');
  s = s.replace(/ *\n */g, '\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

function textStats(text) {
  const characters = text.length;
  const words = text.split(/\s+/).filter(Boolean).length;
  const sentences = text.split(/[.!?]+\s|[.!?]+$/).map(s => s.trim()).filter(s => s.length > 0).length;
  const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 0).length;
  const reading_time_seconds = Math.ceil((words / 200) * 60);
  return { characters, words, sentences, paragraphs, reading_time_seconds };
}

function changeCase(text, to) {
  const words = () => text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map(w => w.toLowerCase());
  switch (to) {
    case 'upper': return text.toUpperCase();
    case 'lower': return text.toLowerCase();
    case 'title':
      return text.toLowerCase().replace(/(^|\s)([a-z])/g, (_, a, b) => a + b.toUpperCase());
    case 'camel': {
      const w = words();
      return w.map((x, i) => i === 0 ? x : x[0].toUpperCase() + x.slice(1)).join('');
    }
    case 'pascal': {
      return words().map(x => x[0].toUpperCase() + x.slice(1)).join('');
    }
    case 'snake': return words().join('_');
    case 'kebab': return words().join('-');
    default: {
      const err = new Error('missing_or_invalid_field:to');
      err.field = 'to';
      throw err;
    }
  }
}

const SCHEMA = {
  name: 'textkit',
  version: VERSION,
  description: 'Deterministic text utilities. No auth on this deployment.',
  limits: {
    request_body_max_bytes: 64 * 1024,
    request_content_type: 'application/json',
    auth: 'none',
    rate_limit: 'none enforced on this deployment',
    latency_header: 'X-Response-Time on every response, milliseconds server-side',
  },
  endpoints: [
    {
      method: 'GET', path: '/v1/health',
      response_example: { status: 'ok', version: VERSION },
    },
    {
      method: 'POST', path: '/v1/slug',
      request: { text: 'string (required)', separator: 'string (optional, default "-")', lowercase: 'boolean (optional, default true)' },
      response: { slug: 'string' },
      example_request: { text: 'Héllo, World! This is TextKit', separator: '_' },
      example_response: { slug: 'hello_world_this_is_textkit' },
    },
    {
      method: 'POST', path: '/v1/html-to-text',
      request: { html: 'string (required, max 64KB body)' },
      response: { text: 'string' },
      example_request: { html: '<h1>Title</h1><p>Hello &amp; welcome.</p>' },
      example_response: { text: 'Title\nHello & welcome.' },
    },
    {
      method: 'POST', path: '/v1/text-stats',
      request: { text: 'string (required)' },
      response: { characters: 'int', words: 'int', sentences: 'int', paragraphs: 'int', reading_time_seconds: 'int (at 200 wpm)' },
      example_request: { text: 'One two three.' },
      example_response: { characters: 14, words: 3, sentences: 1, paragraphs: 1, reading_time_seconds: 1 },
    },
    {
      method: 'POST', path: '/v1/case',
      request: { text: 'string (required)', to: 'one of upper | lower | title | camel | pascal | snake | kebab' },
      response: { result: 'string' },
      example_request: { text: 'Hello World Example', to: 'snake' },
      example_response: { result: 'hello_world_example' },
    },
  ],
};

function handleHealth(res) {
  json(res, 200, { status: 'ok', version: VERSION, timestamp: new Date().toISOString(), processing_ms: Date.now() - (res.startTime || Date.now()) });
}

async function handlePost(name, res, body) {
  switch (name) {
    case 'slug': {
      const text = requireString(body, 'text');
      const sep = typeof body.separator === 'string' && body.separator.length ? body.separator : '-';
      const lower = body.lowercase !== false;
      json(res, 200, { slug: slugify(text, sep, lower) });
      return;
    }
    case 'html-to-text': {
      const html = requireString(body, 'html');
      json(res, 200, { text: htmlToText(html) });
      return;
    }
    case 'text-stats': {
      const text = requireString(body, 'text');
      json(res, 200, textStats(text));
      return;
    }
    case 'case': {
      const text = requireString(body, 'text');
      json(res, 200, { result: changeCase(text, body.to) });
      return;
    }
    default:
      json(res, 404, { error: 'unknown_endpoint', endpoint: `/v1/${name}`, schema: '/v1/schema' });
  }
}

async function route(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname.replace(/\/+$/, '') || '/';
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }
    if (path === '/' || path === '/v1') {
      json(res, 200, SCHEMA);
      return;
    }
    if (path === '/v1/schema') {
      json(res, 200, SCHEMA);
      return;
    }
    if (path === '/v1/health') {
      if (req.method !== 'GET') { json(res, 405, { error: 'method_not_allowed', allow: 'GET' }); return; }
      handleHealth(res);
      return;
    }
    const m = path.match(/^\/v1\/(slug|html-to-text|text-stats|case)$/);
    if (m) {
      if (req.method !== 'POST') {
        json(res, 405, { error: 'method_not_allowed', allow: 'POST' });
        return;
      }
      let body;
      try { body = await parseJsonBody(req); } catch (e) { json(res, 400, { error: e.message }); return; }
      try {
        await handlePost(m[1], res, body);
      } catch (e) {
        json(res, e.message.startsWith('payload') || e.message.includes('field')
          ? 400 : 500, { error: e.message });
      }
      return;
    }
    json(res, 404, { error: 'not_found', hint: 'GET /v1/schema lists every endpoint' });
  } catch (e) {
    json(res, 500, { error: 'internal_error' });
  }
}

async function handler(req, res) {
  res.startTime = Date.now();
  return route(req, res);
}

module.exports = { route, slugify, htmlToText, textStats, changeCase, default: handler };

if (require.main === module) {
  const http = require('http');
  const server = http.createServer((req, res) => {
    res.startTime = Date.now();
    route(req, res);
  });
  const port = process.env.PORT || 3000;
  server.listen(port, () => console.log(`textkit ${VERSION} on :${port}`));
}
