'use strict';

/**
 * Sorin (heysorin.ai) account + Agent-API-key automation primitives.
 *
 * Why a browser is required
 * -------------------------
 * Sorin signs users in through Reown AppKit (WalletConnect) using an e-mail
 * magic link and an EVM wallet signature. The wallet is created client-side by
 * Magic; both the login modal (a Web Component with a shadow DOM) and the
 * signature request page are protected by anti-bot measures and cannot be
 * reproduced with a plain HTTP client. Accounts are therefore created by
 * driving the real UI in a (cloud) browser over CDP inside an isolated browser
 * context, so many independent accounts can be minted from one browser.
 *
 * After the wallet signature the app talks to the Sahara AI backend and calls
 * its own API with an `Authorization: Bearer <sorin session JWT>` header. That
 * JWT is never written to web storage, so we capture it from the first
 * authenticated XHR by instrumenting `fetch`/`XMLHttpRequest` in the page.
 *
 * Key minting (out of band, using the captured JWT):
 *   GET    https://app.saharaai.com/developer/api/agent-api-keys
 *   POST   https://app.saharaai.com/developer/api/agent-api-keys   (Idempotency-Key: <uuid>)
 *   DELETE https://app.saharaai.com/developer/api/agent-api-keys/<id>
 *
 * Agent run endpoint (what you actually call with the key):
 *   POST   https://api.heysorin.ai/v1/agent/runs
 *          { message:{role,content}, mode:"fast"|"expert" }
 *
 * Zero dependencies. Node.js >= 18.
 */

const { CDP } = require('./cdp');

const SITE = 'https://heysorin.ai';
const API_BASE = 'https://api.heysorin.ai';
const SAHARA_KEYS = 'https://app.saharaai.com/developer/api/agent-api-keys';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Collect text from the document AND every open shadow root. Needed because the
 * Reown AppKit modal is a Web Component whose labels ("Confirm Email",
 * "Approve Transaction") never appear in document.body.innerText.
 */
const TEXT_JS = `(() => {
  const seen = new Set();
  let out = '';
  const walk = (root) => {
    if (!root || seen.has(root)) return;
    seen.add(root);
    let txt = '';
    try { txt = root.innerText || (root.textContent || ''); } catch (e) {}
    if (txt) out += txt + '\\n';
    const nodes = root.querySelectorAll ? root.querySelectorAll('*') : [];
    for (const el of nodes) if (el.shadowRoot) walk(el.shadowRoot);
  };
  walk(document.body || document.documentElement);
  return out;
})()`;

/** Find the deep (shadow-piercing) element list inside a Web Component root. */
const WALK_JS = `(root) => {
  const out = [];
  const walk = (node) => { for (const e of node.querySelectorAll('*')) { out.push(e); if (e.shadowRoot) walk(e.shadowRoot); } };
  walk(root);
  return out;
}`;

/**
 * Fire the full pointer + mouse sequence a Web Component button expects. A bare
 * `.click()` is ignored by the AppKit/WUI buttons; they listen for pointerdown.
 */
const REAL_CLICK_JS = `(el) => {
  const r = el.getBoundingClientRect();
  const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
  const base = { bubbles: true, cancelable: true, composed: true, clientX: cx, clientY: cy, button: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true };
  el.dispatchEvent(new PointerEvent('pointerover', base));
  el.dispatchEvent(new PointerEvent('pointerenter', base));
  el.dispatchEvent(new PointerEvent('pointerdown', Object.assign({}, base, { buttons: 1 })));
  el.dispatchEvent(new MouseEvent('mousedown', Object.assign({}, base, { buttons: 1 })));
  el.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, base, { buttons: 0 })));
  el.dispatchEvent(new MouseEvent('mouseup', Object.assign({}, base, { buttons: 0 })));
  el.dispatchEvent(new MouseEvent('click', Object.assign({}, base, { buttons: 0 })));
  return [cx, cy];
}`;

/** Instrument the page so the Sahara JWT is captured from the first XHR/fetch. */
const JWT_HOOK = `(() => {
  if (window.__sorinJwtHook) return 'already';
  window.__sorinJwt = null;
  const grab = (url, headers) => {
    try {
      if (!/saharaai\\.com/.test(String(url))) return;
      let auth = null;
      if (headers && typeof headers.get === 'function') auth = headers.get('authorization') || headers.get('Authorization');
      else if (headers && typeof headers === 'object') auth = headers['Authorization'] || headers['authorization'];
      if (auth && /^Bearer\\s/i.test(auth)) window.__sorinJwt = auth.replace(/^Bearer\\s+/i, '');
    } catch (e) {}
  };
  const of = window.fetch;
  window.fetch = function (...a) {
    const url = typeof a[0] === 'string' ? a[0] : (a[0] && a[0].url);
    const opt = a[1] || {};
    grab(url, opt.headers);
    return of.apply(this, a);
  };
  const oo = XMLHttpRequest.prototype.open;
  const osend = XMLHttpRequest.prototype.send;
  const oset = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (m, u) { this.__u = u; return oo.apply(this, arguments); };
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) { this.__h = this.__h || {}; this.__h[k] = v; return oset.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function () { grab(this.__u, this.__h); return osend.apply(this, arguments); };
  window.__sorinJwtHook = true;
  return 'hooked';
})()`;

/**
 * Drives the Sorin login UI inside one isolated browser context.
 * One instance per account.
 */
class SorinBrowser {
  constructor(cdp, { sessionId, log = () => {} } = {}) {
    this.cdp = cdp;
    this.sessionId = sessionId;
    this.log = log;
  }

  async eval(expression) {
    const r = await this.cdp.send(
      'Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true },
      this.sessionId
    );
    if (r.exceptionDetails) {
      const ex = r.exceptionDetails.exception;
      throw new Error(
        `eval failed: ${(ex && (ex.description || ex.value)) || r.exceptionDetails.text}`
      );
    }
    return r.result.value;
  }

  async goto(url, { waitMs = 4000 } = {}) {
    const loaded = this.cdp
      .waitFor('Page.loadEventFired', { timeoutMs: 30000, sessionId: this.sessionId })
      .catch(() => {});
    await this.cdp.send('Page.navigate', { url }, this.sessionId);
    await Promise.race([loaded, sleep(15000)]);
    await sleep(waitMs);
  }

  reload({ waitMs = 6000 } = {}) {
    const loaded = this.cdp
      .waitFor('Page.loadEventFired', { timeoutMs: 30000, sessionId: this.sessionId })
      .catch(() => {});
    return Promise.resolve(this.cdp.send('Page.reload', {}, this.sessionId))
      .then(() => Promise.race([loaded, sleep(15000)]))
      .then(() => sleep(waitMs));
  }

  text() {
    // The Reown AppKit modal (and anything a Web Component renders) lives in a
    // shadow DOM, so document.body.innerText alone misses the important text.
    return this.eval(TEXT_JS);
  }

  async waitForText(substr, { timeoutMs = 45000, pollMs = 700 } = {}) {
    const deadline = Date.now() + timeoutMs;
    let last = '';
    while (Date.now() < deadline) {
      const txt = await this.text().catch(() => '');
      last = txt;
      if (txt && txt.toLowerCase().includes(substr.toLowerCase())) return true;
      await sleep(pollMs);
    }
    this.lastText = last;
    return false;
  }

  currentUrl() {
    return this.eval('location.href');
  }

  /** Open the "Connect Wallet" modal and submit the e-mail in the Reown AppKit shadow DOM. */
  async submitEmail(email) {
    // Click "Sign In" (opens the AppKit modal). AppKit buttons ignore a bare
    // .click(), so fire the full pointer sequence a real user generates.
    await this.eval(`(() => {
      const realClick = ${REAL_CLICK_JS};
      const walk = ${WALK_JS};
      const b = [...document.querySelectorAll('button')].find(e => /^sign in$/i.test((e.innerText||'').trim()));
      if (b) { realClick(b); return 'clicked'; }
      const any = walk(document.documentElement).find((e) => (e.tagName === 'BUTTON' || e.tagName === 'WUI-BUTTON') && /sign in|log ?in|connect/i.test((e.innerText||'').trim()) && e.getBoundingClientRect().width > 5);
      if (any) { realClick(any); return 'clicked-alt'; }
      return 'no-signin';
    })()`);

    // Poll until the e-mail field is actually rendered inside the modal's shadow
    // tree (the modal mounts asynchronously and a fixed sleep is unreliable).
    const deadline = Date.now() + 30000;
    let ready = null;
    while (Date.now() < deadline) {
      ready = await this.eval(`(() => {
        const w = document.querySelector('w3m-modal');
        if (!w || !w.shadowRoot) return null;
        const walk = ${WALK_JS};
        const els = walk(w.shadowRoot);
        const inp = els.find((e) => e.tagName === 'INPUT' && e.type === 'email');
        if (!inp) return null;
        inp.focus();
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(inp, ${JSON.stringify(email)});
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        const r = inp.getBoundingClientRect();
        const arrow = els.find((e) => {
          if (e.tagName !== 'BUTTON' || e.type !== 'submit') return false;
          const q = e.getBoundingClientRect();
          return Math.abs(q.y - r.y) < 30 && q.x > r.right - 60 && q.width > 5;
        });
        if (!arrow) return { ok: false, reason: 'no-submit-button' };
        const realClick = ${REAL_CLICK_JS};
        const c = realClick(arrow);
        return { ok: true, x: c[0], y: c[1] };
      })()`).catch(() => null);
      if (ready && ready.ok) return ready;
      await sleep(800);
    }
    return ready || { ok: false, reason: 'no email input' };
  }

  /** Type the 6-digit login code into the "Confirm Email" OTP inputs. */
  async enterLoginCode(code) {
    const digits = String(code).replace(/\D/g, '');
    // Focus the first OTP cell inside the modal shadow DOM, then type.
    await this.eval(`(() => {
      const w = document.querySelector('w3m-modal');
      if (!w || !w.shadowRoot) return false;
      const walk = ${WALK_JS};
      const inp = walk(w.shadowRoot).find((e) => e.tagName === 'INPUT');
      if (inp) inp.focus();
      return !!inp;
    })()`);
    await this.cdp.send('Input.insertText', { text: digits }, this.sessionId);
    return true;
  }

  /**
   * Approve the "Approve Transaction" signature request. The dialog is rendered
   * by Reown inside a cross-origin iframe target; we find it, attach, and click
   * the WUI-BUTTON labelled "Sign".
   */
  async signWallet({ timeoutMs = 90000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const targets = await this.cdp.send('Target.getTargets', {}, null);
      const frames = targets.targetInfos.filter(
        (t) => t.type === 'iframe' && /secure\.walletconnect\.org|reown|walletconnect/i.test(t.url)
      );
      for (const frame of frames) {
        let sid = null;
        try {
          const att = await this.cdp.send('Target.attachToTarget', { targetId: frame.targetId, flatten: true }, null);
          sid = att.sessionId;
          const r = await this.cdp.send(
            'Runtime.evaluate',
            {
              expression: `(() => {
                const walk = ${WALK_JS};
                const realClick = ${REAL_CLICK_JS};
                const all = walk(document.documentElement);
                const vis = (e) => { const q = e.getBoundingClientRect(); return q.width > 5 && q.height > 5; };
                const sign = all.find((e) => /WUI-BUTTON|BUTTON/i.test(e.tagName) && /^sign\\b/i.test((e.innerText||'').trim()) && vis(e));
                if (sign) { realClick(sign); return 'clicked'; }
                const approve = all.find((e) => /WUI-BUTTON|BUTTON/i.test(e.tagName) && /^(approve|confirm|continue|connect)$/i.test((e.innerText||'').trim()) && vis(e));
                if (approve) { realClick(approve); return 'clicked-alt'; }
                return (document.body && /sign|approve|confirm/i.test(document.body.innerText)) ? 'waiting' : 'none';
              })()`,
              returnByValue: true,
            },
            sid
          );
          if (r.result && (r.result.value === 'clicked' || r.result.value === 'clicked-alt')) return true;
        } catch {
          /* frame not ready yet */
        } finally {
          if (sid) await this.cdp.send('Target.detachFromTarget', { sessionId: sid }, null).catch(() => {});
        }
      }
      await sleep(1500);
    }
    return false;
  }

  /** Full login: email -> code -> wallet signature. */
  async login({ email, getCode, log = () => {}, codeTimeoutMs = 120000 }) {
    log('opening site');
    await this.goto(SITE, { waitMs: 6000 });
    await this.reload({ waitMs: 8000 });

    // Instrument now, before the first authenticated request.
    await this.eval(JWT_HOOK).catch(() => {});

    log('submitting e-mail');
    const sub = await this.submitEmail(email);
    if (!sub || !sub.ok) throw new Error(`email submit failed: ${sub && sub.reason}`);

    log('requesting code');
    await this.waitForText('Confirm Email', { timeoutMs: 60000 });
    const code = await getCode();
    log(`code ${code}`);
    await this.enterLoginCode(code);

    log('awaiting signature prompt');
    await this.waitForText('Approve Transaction', { timeoutMs: 60000 });
    const signed = await this.signWallet({ timeoutMs: codeTimeoutMs });
    if (!signed) throw new Error('wallet signature was not approved');

    log('waiting for session');
    const ok = await this.waitForText('Credits', { timeoutMs: 60000 }).catch(() => false);
    const jwt = await this.eval('window.__sorinJwt').catch(() => null);
    return { jwt: jwt || null, loggedIn: ok };
  }

  async captureJwt() {
    return this.eval('window.__sorinJwt').catch(() => null);
  }
}

/* ----------------------------- HTTP helpers ----------------------------- */

const https = require('https');
const { URL } = require('url');

function httpJson(method, url, { headers = {}, body, timeoutMs = 45000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const req = https.request(
      {
        method,
        hostname: u.hostname,
        port: 443,
        path: u.pathname + u.search,
        headers: Object.assign(
          {
            'User-Agent': 'sorin-bulk-apikey/1.0',
            Accept: 'application/json',
          },
          data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {},
          headers
        ),
      },
      (res) => {
        let chunks = '';
        res.on('data', (c) => (chunks += c));
        res.on('end', () => {
          let parsed = null;
          try {
            parsed = chunks ? JSON.parse(chunks) : null;
          } catch {
            parsed = chunks;
          }
          resolve({ status: res.statusCode, headers: res.headers, body: parsed });
        });
      }
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error('HTTP timeout')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function uuid() {
  return globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });
}

/**
 * Mint an Agent-as-a-Service API key using a captured Sorin session JWT.
 * The endpoint requires an `Idempotency-Key` UUID header.
 * Returns { api_key, api_key_info }.
 */
async function createAgentKey(jwt, name) {
  const res = await httpJson('POST', SAHARA_KEYS, {
    headers: { Authorization: `Bearer ${jwt}`, 'Idempotency-Key': uuid() },
    body: { name },
    timeoutMs: 60000,
  });
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`create key failed (${res.status}): ${JSON.stringify(res.body).slice(0, 300)}`);
  }
  return res.body;
}

async function listAgentKeys(jwt) {
  const res = await httpJson('GET', SAHARA_KEYS, {
    headers: { Authorization: `Bearer ${jwt}` },
    timeoutMs: 30000,
  });
  if (res.status !== 200) throw new Error(`list keys failed (${res.status})`);
  return (res.body && res.body.api_keys) || [];
}

async function deleteAgentKey(jwt, id) {
  const res = await httpJson('DELETE', `${SAHARA_KEYS}/${id}`, {
    headers: { Authorization: `Bearer ${jwt}` },
    timeoutMs: 30000,
  });
  return res.status;
}

/** Sanity-check an agent key by running one tiny prompt. */
async function testAgentKey(apiKey, { mode = 'fast', content = 'Reply with just: pong' } = {}) {
  const res = await httpJson('POST', `${API_BASE}/v1/agent/runs`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    body: { message: { role: 'user', content }, mode },
    timeoutMs: 60000,
  });
  if (res.status !== 201 && res.status !== 200) {
    return { ok: false, status: res.status, body: res.body };
  }
  return { ok: true, content: res.body.content, usage: res.body.usage, runId: res.body.id };
}

module.exports = {
  SorinBrowser,
  createAgentKey,
  listAgentKeys,
  deleteAgentKey,
  testAgentKey,
  httpJson,
  sleep,
  JWT_HOOK,
  SITE,
  API_BASE,
  SAHARA_KEYS,
};
