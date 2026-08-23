# textkit

Deterministic text utilities over HTTP. Deployed on Vercel serverless functions. No auth on this deployment.

Base URL: `https://rapidapi-roan.vercel.app`

Machine-readable schema of every endpoint:

```sh
curl -s https://rapidapi-roan.vercel.app/v1/schema | jq
```

## Endpoints

### GET /v1/health

```sh
curl -s https://rapidapi-roan.vercel.app/v1/health
```

Response (200):

```json
{"status":"ok","version":"1.0.0","timestamp":"2026-08-23T10:15:28.385Z"}
```

### POST /v1/slug

Body: `{ "text": string, "separator": string (optional, default "-"), "lowercase": boolean (optional, default true) }`

Unicode NFKD-normalized; diacritics stripped; non-alphanumerics collapse to the separator.

```sh
curl -s -X POST https://rapidapi-roan.vercel.app/v1/slug \
  -H 'Content-Type: application/json' \
  -d '{"text":"Héllo, World! This is TextKit","separator":"_"}'
```

Response (200):

```json
{"slug":"hello_world_this_is_textkit"}
```

### POST /v1/html-to-text

Body: `{ "html": string }`. Strips tags, drops `<script>` and `<style>` blocks, decodes named and numeric entities, preserves block-level line breaks.

```sh
curl -s -X POST https://rapidapi-roan.vercel.app/v1/html-to-text \
  -H 'Content-Type: application/json' \
  -d '{"html":"<h1>Title</h1><p>Hello &amp; welcome.</p><script>evil()</script>"}'
```

Response (200):

```json
{"text":"Title\nHello & welcome."}
```

### POST /v1/text-stats

Body: `{ "text": string }`. Reading time assumes 200 words per minute, rounded up.

```sh
curl -s -X POST https://rapidapi-roan.vercel.app/v1/text-stats \
  -H 'Content-Type: application/json' \
  -d '{"text":"One two three.\n\nFour five!"}'
```

Response (200):

```json
{"characters":26,"words":5,"sentences":2,"paragraphs":2,"reading_time_seconds":2}
```

### POST /v1/case

Body: `{ "text": string, "to": one of upper|lower|title|camel|pascal|snake|kebab }`

```sh
curl -s -X POST https://rapidapi-roan.vercel.app/v1/case \
  -H 'Content-Type: application/json' \
  -d '{"text":"Hello World Example","to":"snake"}'
```

Response (200):

```json
{"result":"hello_world_example"}
```

## Errors

Missing or invalid field — 400:

```sh
curl -s -X POST https://rapidapi-roan.vercel.app/v1/case \
  -H 'Content-Type: application/json' -d '{"text":"x"}'
# {"error":"missing_or_invalid_field:to"}
```

Wrong method — 405:

```sh
curl -s -X POST https://rapidapi-roan.vercel.app/v1/health
# {"error":"method_not_allowed","allow":"GET"}
```

Unknown path — 404:

```sh
curl -s https://rapidapi-roan.vercel.app/nope
# {"error":"not_found","hint":"GET /v1/schema lists every endpoint"}
```

Malformed JSON body — 400: `{"error":"invalid_json"}`

## Limits

- Request body: 64 KB maximum (`payload_too_large`, 400).
- Auth: none on this deployment. Anyone can call it.
- Rate limit: none enforced.
- Availability: Vercel serverless, us-west region. No SLA published until uptime is measured over a full month.

## Latency

Measured 2026-08-23 14:18 UTC, `tests/prod_integration.mjs`, 10 sequential `POST /v1/slug` requests from the deploy machine to production, end-to-end including DNS/TLS: median 125 ms, min 115 ms, max 265 ms. Server-side handler time is on every response as `X-Response-Time` (typically 0-1 ms; the rest is network).

## Local development

```sh
node api/index.js                    # serves on :3000
npm test                             # 6 local tests against api/index.js
node tests/prod_integration.mjs      # 17 checks against production
```

## Deployment

```sh
vercel deploy --prod --yes   # linked project: rapidapi (benlafreniere6-3913s-projects)
```

## Uptime

Probed hourly by GitHub Actions: `GET /v1/health` must return 200 with `status: ok`, and `POST /v1/slug` must return the documented example output exactly. Every probe, pass or fail, appends one JSON line to [`uptime/log.jsonl`](uptime/log.jsonl).

```sh
curl -s https://raw.githubusercontent.com/dev55acc-ai/textkit/main/uptime/log.jsonl | tail -1
```

First probe: 2026-08-23 22:28 UTC, both checks passed (health 481 ms, slug 279 ms end-to-end). No SLA is published until the log covers a full month.
