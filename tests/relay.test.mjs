import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { AirOuterRelay } from '../lib/relay.js'

const silent = { info() {}, warn() {}, error() {}, debug() {} }

async function upstream(handler) {
  const server = createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => server.close((e) => e ? reject(e) : resolve())),
  }
}

async function relay(upstreamUrl, options = {}) {
  const instance = new AirOuterRelay({
    host: '127.0.0.1', port: 0, upstream: upstreamUrl,
    apiKeyEnv: 'AIR_OUTER_API_KEY', timeoutMs: 5000,
    maxBodyBytes: 1024 * 1024, verbose: false, logger: silent,
    environment: {}, ...options,
  })
  const address = await instance.start()
  return { instance, url: address.baseURL }
}

test('codex model sends codex_cli_rs fingerprint and forwards authorization', async (t) => {
  let seen
  const up = await upstream(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c)
    seen = { headers: req.headers, body: Buffer.concat(chunks).toString() }
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}')
  })
  const r = await relay(up.url)
  t.after(async () => { await r.instance.close(); await up.close() })
  const response = await fetch(`${r.url}/chat/completions`, {
    method: 'POST', headers: { authorization: 'Bearer secret', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-5.6-sol', messages: [] }),
  })
  assert.equal(response.status, 200)
  assert.equal(seen.headers.authorization, 'Bearer secret')
  assert.equal(seen.headers.originator, 'codex_cli_rs')
  assert.match(seen.headers['user-agent'], /^codex_cli_rs\//)
  assert.ok(seen.headers.session_id)
  assert.match(seen.body, /gpt-5\.6-sol/)
})

test('auth failure tries next fingerprint and caches the winner', async (t) => {
  const agents = []
  const up = await upstream((req, res) => {
    agents.push(req.headers['user-agent'])
    if (req.headers['user-agent'].startsWith('codex_cli_rs/')) {
      res.writeHead(401, { 'content-type': 'application/json' }).end('{"error":"API key is invalid"}')
    } else {
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}')
    }
  })
  const r = await relay(up.url)
  t.after(async () => { await r.instance.close(); await up.close() })
  const call = () => fetch(`${r.url}/chat/completions`, {
    method: 'POST', headers: { authorization: 'Bearer secret', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-5.6-sol' }),
  })
  assert.equal((await call()).status, 200)
  assert.deepEqual(agents.slice(0, 2).map((x) => x.split('/')[0]), ['codex_cli_rs', 'codex-cli'])
  agents.length = 0
  assert.equal((await call()).status, 200)
  assert.equal(agents.length, 1)
  assert.match(agents[0], /^codex-cli\//)
})

test('claude model uses known claude fingerprint first', async (t) => {
  let seen
  const up = await upstream((req, res) => {
    seen = req.headers
    res.writeHead(200, { 'content-type': 'application/json' }).end('{}')
  })
  const r = await relay(up.url)
  t.after(async () => { await r.instance.close(); await up.close() })
  await fetch(`${r.url}/chat/completions`, {
    method: 'POST', headers: { authorization: 'Bearer secret', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-opus-5' }),
  })
  assert.match(seen['user-agent'], /^claude-cli\//)
  assert.equal(seen['anthropic-version'], '2023-06-01')
})

test('uses environment credential and streams SSE without buffering semantics', async (t) => {
  let authorization
  const up = await upstream((req, res) => {
    authorization = req.headers.authorization
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write('data: one\n\n')
    setTimeout(() => res.end('data: two\n\n'), 10)
  })
  const r = await relay(up.url, { environment: { AIR_OUTER_API_KEY: 'env-secret' } })
  t.after(async () => { await r.instance.close(); await up.close() })
  const response = await fetch(`${r.url}/chat/completions`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-opus-5' }),
  })
  assert.equal(authorization, 'Bearer env-secret')
  assert.equal(response.headers.get('content-type'), 'text/event-stream')
  assert.equal(await response.text(), 'data: one\n\ndata: two\n\n')
})
