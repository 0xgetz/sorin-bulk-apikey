#!/usr/bin/env node
'use strict';

/**
 * Connect the Sorin pool adapter to a running 9Router instance.
 *
 * Registers ONE provider-node of type "openai-compatible" whose baseUrl points
 * at the Sorin pool adapter (/v1), then one connection whose apiKey is a
 * placeholder (the pool holds the real Sorin keys server-side).
 *
 * Result in 9Router:
 *   sorin/sorin-fast
 *   sorin/sorin-auto
 *   sorin/sorin-expert
 *
 * Usage:
 *   node src/connect-9router.js --base http://localhost:20128 --password 123456 \
 *        --adapter http://localhost:8791
 *
 * Zero dependencies. Node.js >= 18.
 */

const UA = 'sorin-9router-connector/1.0';

async function login9router(base, password) {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({ password: password ?? '123456' }),
  });
  const setCookie = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  const cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
  const body = await res.text();
  return { ok: res.ok, cookie, body: body.slice(0, 200) };
}

async function api(base, cookie, p, init = {}) {
  const res = await fetch(`${base}${p}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': UA,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, ok: res.ok, json, text: text.slice(0, 400) };
}

async function ensureNode(base, cookie, { name, prefix, baseUrl }) {
  const list = await api(base, cookie, '/api/provider-nodes');
  const nodes = list.json?.nodes || [];
  const existing = nodes.find((n) => n.name === name || n.prefix === prefix);
  if (existing) {
    console.log(`provider-node exists: ${existing.id}`);
    return existing;
  }
  const created = await api(base, cookie, '/api/provider-nodes', {
    method: 'POST',
    body: JSON.stringify({ name, prefix, apiType: 'chat', type: 'openai-compatible', baseUrl }),
  });
  if (!created.ok) throw new Error(`create node failed ${created.status}: ${created.text}`);
  console.log(`provider-node created: ${created.json.node.id}`);
  return created.json.node;
}

async function ensureConnection(base, cookie, { nodeId, name, apiKey, defaultModel }) {
  const list = await api(base, cookie, '/api/providers');
  const conns = list.json?.connections || [];
  const existing = conns.find((c) => c.provider === nodeId && c.name === name);
  if (existing) {
    console.log(`connection exists: ${existing.id} (${existing.name})`);
    return existing;
  }
  const created = await api(base, cookie, '/api/providers', {
    method: 'POST',
    body: JSON.stringify({ provider: nodeId, apiKey, name, priority: 1, defaultModel: defaultModel || null }),
  });
  if (!created.ok && created.status !== 409) {
    throw new Error(`create connection failed ${created.status}: ${created.text}`);
  }
  console.log(`connection created: ${created.json?.connection?.id || '(conflict)'}`);
  return created.json?.connection;
}

async function connect({ base, password, adapterUrl }) {
  const { cookie, ok, body } = await login9router(base, password);
  console.log(`9Router login: ${ok ? 'ok' : 'not required/failed'} ${ok ? '' : body}`);
  const node = await ensureNode(base, cookie, {
    name: 'Sorin',
    prefix: 'sorin',
    baseUrl: `${adapterUrl.replace(/\/$/, '')}/v1`,
  });
  await ensureConnection(base, cookie, {
    nodeId: node.id,
    name: 'Sorin (Pool)',
    apiKey: 'sorin-pool',
    defaultModel: 'sorin/sorin-auto',
  });
  console.log('\nDone. Models available in 9Router:');
  for (const m of ['sorin-fast', 'sorin-auto', 'sorin-expert']) console.log(`  sorin/${m}`);
}

const args = Object.fromEntries(
  process.argv.slice(2).reduce((a, v, i, arr) => {
    if (v.startsWith('--')) a.push([v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
    return a;
  }, [])
);

if (require.main === module) {
  connect({
    base: String(args.base || 'http://localhost:20128'),
    password: args.password || '123456',
    adapterUrl: String(args.adapter || 'http://localhost:8791'),
  }).catch((e) => {
    console.error('connect failed:', e.message);
    process.exit(1);
  });
}

module.exports = { connect, login9router, ensureNode, ensureConnection };
