#!/usr/bin/env node
'use strict';

/**
 * Sorin pool adapter - an OpenAI-compatible gateway in front of N Sorin Agent
 * API keys, with round-robin + failover. Point 9Router (or any OpenAI client)
 * at it and every Sorin account you minted is used in turn.
 *
 *   GET  /v1/models
 *   POST /v1/chat/completions   (stream + non-stream)
 *   GET  /health
 *   GET  /pool
 *   POST /pool/reload
 *
 * Models mirror the Sorin run modes:
 *   sorin-fast   -> mode=fast
 *   sorin-auto   -> mode=fast   (default)
 *   sorin-expert -> mode=expert
 *
 * Keys are loaded from a keystore JSON (see src/keystore.js) or from the
 * SORIN_API_KEYS env var (comma-separated).
 *
 * Zero dependencies. Node.js >= 18.
 */

const http = require('http');

const PORT = process.env.PORT || 8791;
const HOST = process.env.HOST || '0.0.0.0';
const API_BASE = process.env.SORIN_API || 'https://api.heysorin.ai';

const MODELS = {
  'sorin-fast': { mode: 'fast', label: 'Sorin Fast' },
  'sorin-auto': { mode: 'fast', label: 'Sorin Auto' },
  'sorin-expert': { mode: 'expert', label: 'Sorin Expert' },
};

/* ------------------------------ key pool ------------------------------ */

class Pool {
  constructor(keys = []) {
    this.keys = keys.map((k) => ({ key: typeof k === 'string' ? k : k.apiKey, ...(typeof k === 'object' ? k : {}), failures: 0, cooldownUntil: 0 }));
    this.cursor = 0;
  }

  get size() {
    return this.keys.length;
  }

  alive() {
    const now = Date.now();
    return this.keys.filter((k) => k.cooldownUntil < now);
  }

  /** Round-robin pick the next healthy key; falls back to any key. */
  pick() {
    if (!this.keys.length) return null;
    const now = Date.now();
    for (let i = 0; i < this.keys.length; i++) {
      this.cursor = (this.cursor + 1) % this.keys.length;
      const k = this.keys[this.cursor];
      if (k.cooldownUntil < now) return k;
    }
    return this.keys[this.cursor];
  }

  penalize(k, ms = 60000) {
    k.failures++;
    k.cooldownUntil = Date.now() + Math.min(ms * k.failures, 600000);
  }

  reset(k) {
    k.failures = 0;
    k.cooldownUntil = 0;
  }

  stats() {
    return this.keys.map((k) => ({
      key: k.key.slice(0, 18) + '...',
      name: k.keyName || k.name || null,
      failures: k.failures,
      cooldownUntil: k.cooldownUntil || 0,
    }));
  }
}

function loadKeys() {
  if (process.env.SORIN_API_KEYS) {
    return process.env.SORIN_API_KEYS.split(',').map((s) => s.trim()).filter(Boolean);
  }
  if (process.env.SORIN_KEYSTORE) {
    try {
      const data = JSON.parse(require('fs').readFileSync(process.env.SORIN_KEYSTORE, 'utf8'));
      const accounts = (data.accounts || data).filter((a) => a.apiKey || (a.status === 'ok' && a.apiKey));
      return accounts.map((a) => ({ apiKey: a.apiKey, keyName: a.keyName }));
    } catch (e) {
      console.error('[pool] could not read keystore:', e.message);
    }
  }
  return [];
}

let pool = new Pool(loadKeys());

/* ------------------------------ helpers ------------------------------ */

function resolveModel(name) {
  if (!name) return 'sorin-auto';
  if (MODELS[name]) return name;
  const short = String(name).split('/').pop();
  if (MODELS[short]) return short;
  return null;
}

function messagesToPrompt(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return '';
  if (messages.length === 1) return String(messages[0].content ?? '');
  const lines = [];
  for (const m of messages) {
    const role = m.role || 'user';
    const content =
      typeof m.content === 'string'
        ? m.content
        : Array.isArray(m.content)
          ? m.content.map((p) => (typeof p === 'string' ? p : p.text || '')).join('')
          : String(m.content ?? '');
    if (!content) continue;
    if (role === 'system') lines.push('System instructions: ' + content);
    else if (role === 'assistant') lines.push('Assistant: ' + content);
    else lines.push('User: ' + content);
  }
  return lines.join('\n\n');
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function sseChunk(id, model, delta, finish) {
  return (
    'data: ' +
    JSON.stringify({
      id,
      object: 'chat.completion.chunk',
      created: nowSec(),
      model,
      choices: [{ index: 0, delta, finish_reason: finish || null }],
    }) +
    '\n\n'
  );
}

async function callSorin(apiKey, mode, prompt) {
  const res = await fetch(API_BASE + '/v1/agent/runs', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({ message: { role: 'user', content: prompt }, mode }),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  if (!res.ok) {
    const msg = (json && (json.message || json.error)) || text.slice(0, 300);
    const err = new Error(`sorin http ${res.status}: ${msg}`);
    err.status = res.status;
    throw err;
  }
  return json || {};
}

/** Try every healthy key before giving up. */
async function runWithFailover(mode, prompt) {
  const attempts = Math.max(1, pool.size);
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    const k = pool.pick();
    if (!k) break;
    try {
      const out = await callSorin(k.key, mode, prompt);
      pool.reset(k);
      return { out, key: k };
    } catch (e) {
      lastErr = e;
      // 401/403/429 => key bad/throttled; back off and rotate.
      if ([401, 403, 429].includes(e.status)) pool.penalize(k);
      else pool.penalize(k, 5000);
    }
  }
  throw lastErr || new Error('no API keys configured');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', (c) => {
      buf += c;
      if (buf.length > 20e6) reject(new Error('body too large'));
    });
    req.on('end', () => resolve(buf));
    req.on('error', reject);
  });
}

function send(res, status, obj) {
  const body = typeof obj === 'string' ? obj : JSON.stringify(obj);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
  });
  res.end(body);
}

/* ------------------------------ server ------------------------------ */

const server = http.createServer(async (req, res) => {
  const { method, url } = req;
  if (method === 'OPTIONS') return send(res, 204, '');

  try {
    if (method === 'GET' && url === '/health') {
      return send(res, 200, { status: 'ok', keys: pool.size, healthy: pool.alive().length, models: Object.keys(MODELS) });
    }

    if (method === 'GET' && url === '/pool') {
      return send(res, 200, { size: pool.size, healthy: pool.alive().length, keys: pool.stats() });
    }

    if (method === 'POST' && url === '/pool/reload') {
      pool = new Pool(loadKeys());
      return send(res, 200, { reloaded: true, size: pool.size });
    }

    if (method === 'GET' && url === '/v1/models') {
      const data = Object.entries(MODELS).map(([id, m]) => ({
        id,
        object: 'model',
        created: 0,
        owned_by: 'sorin',
        _label: m.label,
      }));
      return send(res, 200, { object: 'list', data });
    }

    if (method === 'POST' && url === '/v1/chat/completions') {
      const raw = await readBody(req);
      let body = {};
      try {
        body = JSON.parse(raw || '{}');
      } catch {
        return send(res, 400, { error: { message: 'invalid JSON body', type: 'invalid_request_error' } });
      }
      if (!pool.size) {
        return send(res, 500, { error: { message: 'no Sorin API keys configured', type: 'server_error' } });
      }
      const modelId = resolveModel(body.model);
      if (!modelId) {
        return send(res, 404, {
          error: { message: `unknown model "${body.model}". Available: ${Object.keys(MODELS).join(', ')}`, type: 'invalid_request_error' },
        });
      }
      const mode = MODELS[modelId].mode;
      const prompt = messagesToPrompt(body.messages);

      let out, used;
      try {
        const r = await runWithFailover(mode, prompt);
        out = r.out;
        used = r.key;
      } catch (e) {
        return send(res, 502, { error: { message: e.message, type: 'upstream_error' } });
      }

      const content = out.content ?? '';
      const id = 'chatcmpl-' + (out.id || out.messageId || Math.random().toString(36).slice(2));
      const inTok = out.usage?.input_tokens ?? 0;
      const outTok = out.usage?.output_tokens ?? 0;

      if (body.stream) {
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
          'access-control-allow-origin': '*',
        });
        res.write(sseChunk(id, modelId, { role: 'assistant', content: '' }, null));
        for (let i = 0; i < content.length; i += 80) {
          res.write(sseChunk(id, modelId, { content: content.slice(i, i + 80) }, null));
        }
        res.write(sseChunk(id, modelId, {}, 'stop'));
        res.write('data: [DONE]\n\n');
        return res.end();
      }

      return send(res, 200, {
        id,
        object: 'chat.completion',
        created: nowSec(),
        model: modelId,
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: inTok, completion_tokens: outTok, total_tokens: inTok + outTok },
        _sorin: { run_id: out.id, mode: out.mode, charged_credits: out.usage?.charged_credits, pool_key: used && used.keyName },
      });
    }

    return send(res, 404, { error: { message: `no route ${method} ${url}`, type: 'not_found' } });
  } catch (e) {
    return send(res, 500, { error: { message: String((e && e.message) || e), type: 'server_error' } });
  }
});

function start() {
  server.listen(PORT, HOST, () => {
    console.log(`[sorin-pool] gateway on http://${HOST}:${PORT}`);
    console.log(`[sorin-pool] upstream ${API_BASE}`);
    console.log(`[sorin-pool] keys loaded: ${pool.size} (healthy ${pool.alive().length})`);
    console.log(`[sorin-pool] models: ${Object.keys(MODELS).join(', ')}`);
  });
}

if (require.main === module) start();

module.exports = { server, start, Pool, resolveModel, MODELS };
