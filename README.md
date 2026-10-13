<div align="center">

<img src="brand/logo.svg" width="128" alt="sorin-bulk logo">

# sorin-bulk-apikey

**Bulk-create [Sorin](https://heysorin.ai) accounts and Agent API keys, then serve them to [9Router](https://9router.com) as one OpenAI-compatible pool.**

Zero dependencies · Node ≥ 18 · CDP-driven · end-to-end verified

[![License: MIT](https://img.shields.io/badge/License-MIT-22D3EE.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-339933.svg?logo=node.js&logoColor=white)](https://nodejs.org)
[![Dependencies](https://img.shields.io/badge/dependencies-0-34D399.svg)](package.json)
[![9Router](https://img.shields.io/badge/9Router-ready-818CF8.svg)](https://9router.com)
[![Sorin](https://img.shields.io/badge/Sorin-heysorin.ai-F59E0B.svg)](https://heysorin.ai)
[![Platform](https://img.shields.io/badge/VPS-any%20Linux%20%E2%80%A2%20macOS%20%E2%80%A2%20Windows-64748B.svg)](#requirements)

[English](README.md) · [Bahasa](i18n/README.id.md) · [中文](i18n/README.zh.md) · [日本語](i18n/README.ja.md) · [Español](i18n/README.es.md)

</div>

---

## What it does

Sorin has no public signup API. Accounts are created through the real UI: an
email magic-link, a 6-digit code, and an EVM wallet signature issued by Magic
inside a WalletConnect (Reown AppKit) modal. `sorin-bulk-apikey` drives that flow
in a real Chrome over the DevTools Protocol, one isolated browser context per
account, then captures the Sorin session JWT and uses it to mint an
**Agent-as-a-Service API key** — all automatically.

The result is a JSON keystore of `email · password · apiKey · jwt`. A bundled
gateway (`pool-adapter`) exposes every key behind a single OpenAI-compatible
endpoint with round-robin load balancing and failover, and
`connect-9router.js` registers that gateway in **9Router** with one command.

```
┌────────────┐   CDP    ┌──────────────┐   mint     ┌─────────────┐
│  Chrome    │ ───────▶ │  heysorin.ai │ ─────────▶ │  Agent key  │
│ (any VPS)  │  login   │  + Sahara AI │            │ sk-sahara…  │
└────────────┘          └──────────────┘            └──────┬──────┘
                                                           │ pool
                        ┌──────────────┐   /v1   ┌─────────▼────────┐
                        │   9Router    │ ◀────── │  pool-adapter    │
                        │ sorin/sorin-*│         │ round-robin + LB │
                        └──────────────┘         └──────────────────┘
```

## Requirements

- **Node.js ≥ 18** — that is the entire dependency list. No `npm install`.
- **A Chrome / Chromium** you can launch with a debug port (the login cannot be
  reproduced with a plain HTTP client).
- Mailboxes come from [mail.tm](https://mail.tm) (free, no signup); the tool
  creates them for you.

Works on any Linux VPS, on macOS, and on Windows. Nothing here is tied to a
particular host — you point it at *your* Chrome.

## Quick start

### 1. Launch Chrome with a debug port

```bash
# Linux VPS / server (headless)
google-chrome --headless=new --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.sorin-chrome" --no-sandbox --disable-gpu

# macOS
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 --user-data-dir="$HOME/.sorin-chrome"

# Windows (PowerShell)
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-port=9222 --user-data-dir="$env:USERPROFILE\.sorin-chrome"
```

> The `--user-data-dir` must **not** be your everyday Chrome profile. Chrome 136+
> silently disables the debug port when you reuse the default profile.

Confirm it is up:

```bash
curl http://127.0.0.1:9222/json/version
```

### 2. Mint accounts

```bash
# one account
node src/cli.js --count 1

# ten accounts, three at a time, from a specific Chrome
node src/cli.js --count 10 --concurrency 3 --cdp-url http://127.0.0.1:9222
```

Each account takes roughly **1.5–2 minutes** (sign-up, code, wallet signature,
key mint, live verification). Progress and a CSV/JSON keystore land in
`outputs/`.

### 3. Serve the pool to 9Router

```bash
# start the OpenAI-compatible gateway (defaults to :8791)
SORIN_KEYSTORE=outputs/sorin-accounts.json node src/pool-adapter.js

# register it in a running 9Router (defaults to http://localhost:20128)
node src/connect-9router.js --base http://localhost:20128 --adapter http://localhost:8791
```

Models now available in 9Router:

```
sorin/sorin-fast     # low-latency
sorin/sorin-auto     # automatic mode
sorin/sorin-expert   # deep / research mode
```

## CLI

| Flag | Default | Description |
| --- | --- | --- |
| `-n, --count <n>` | `1` | number of accounts to create |
| `-c, --concurrency <n>` | `1` | parallel accounts (one browser context each) |
| `--cdp-url <url>` | `http://127.0.0.1:9222` | Chrome debug HTTP endpoint |
| `--cdp-ws <url>` | – | explicit CDP WebSocket URL |
| `--out <file>` | `outputs/sorin-accounts.json` | JSON keystore path |
| `--csv <file>` | beside `--out` | CSV export path |
| `--key-prefix <name>` | `sorin-bulk` | Agent key name prefix |
| `--key-name <name>` | – | fixed key name (overrides prefix) |
| `--no-verify` | off | skip the live prompt that verifies each key |
| `--connect-9router` | off | register the pool in 9Router when done |
| `--base <url>` | `http://localhost:20128` | 9Router base URL |
| `--password <pw>` | `123456` | 9Router password |
| `--adapter <url>` | `http://localhost:8791` | pool adapter base URL |
| `--quiet` | off | suppress per-account progress |

Environment variables: `CDP_URL`, `CDP_WS`, `SORIN_KEYSTORE`, `SORIN_API_KEYS`.

## Keystore format

`outputs/sorin-accounts.json`:

```json
{
  "generated_at": "2026-10-13T03:28:14.629Z",
  "accounts": [
    {
      "index": 1,
      "status": "ok",
      "email": "7tjqmyupmv64d4iq@maxxspace.com",
      "emailPassword": "gialh5g93qnAa1!",
      "apiKey": "sk-sahara-agent-…",
      "apiKeyId": "ak_…",
      "keyPreview": "sk-sahara-agent-...8PZs",
      "jwt": "eyJhbGciOi…",
      "verified": true,
      "verifyContent": "pong",
      "credits": 2
    }
  ]
}
```

A matching `.csv` is written next to it. **Treat this file as secret** — it holds
live API keys and session tokens.

## How it works

1. **Disposable inbox** — a fresh mail.tm mailbox per account.
2. **Isolated browser context** — `Target.createBrowserContext` gives every
   account its own cookies and storage, so accounts never collide; many can run
   from a single Chrome.
3. **UI login over CDP** — click *Sign In*, fill the email in the Reown AppKit
   shadow DOM, submit the arrow button with a full pointer sequence (AppKit
   ignores a bare `.click()`), type the 6-digit code, then click *Sign* inside the
   WalletConnect `secure.walletconnect.org` iframe.
4. **JWT capture** — the app calls the Sahara AI backend with
   `Authorization: Bearer <session JWT>`; `fetch`/`XHR` are instrumented to grab
   it from the first authenticated request.
5. **Key mint** — `POST https://app.saharaai.com/developer/api/agent-api-keys`
   with the JWT and an `Idempotency-Key` header returns the `sk-sahara-agent-…`
   secret (shown only once).
6. **Verify** — one tiny prompt is sent to
   `POST https://api.heysorin.ai/v1/agent/runs` to prove the key is live.

See [`docs/PROTOCOL.md`](docs/PROTOCOL.md) for the full wire protocol.

## Pool adapter

`src/pool-adapter.js` is a dependency-free HTTP server that speaks the OpenAI
chat-completions shape and fans requests across your Sorin keys.

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | pool status (keys, healthy count, models) |
| `GET /v1/models` | OpenAI model list |
| `GET /v1/chat/completions` | chat completion (streaming and non-streaming) |
| `GET /pool` | per-key health detail |
| `POST /pool/reload` | re-read the keystore from disk |

Pick a key per request in round-robin order; on a failed key, try the next.
Model aliases: `sorin-fast`, `sorin-auto`, `sorin-expert` (also accepted with a
`sorin/` prefix).

```bash
curl http://127.0.0.1:8791/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"model":"sorin-auto","messages":[{"role":"user","content":"hello"}]}'
```

## Notes & limits

- Sorin accounts require an **EVM wallet** that Magic generates client-side; this
  tool never touches a private key — it only drives the UI.
- Free Sorin accounts have a **daily run quota** (~30 runs/day, ~2 credits per
  run). Rotate more accounts for more headroom; the pool is built for exactly
  that.
- The agent endpoint is **not** a generic chat API: no `/v1/models`, no sampling
  knobs. `mode` maps to the UI modes `fast` / `expert`.
- Use responsibly and in line with the providers' terms.

## License

[MIT](LICENSE).
