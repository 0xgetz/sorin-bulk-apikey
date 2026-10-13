# Structure

```
sorin-bulk-apikey/
├── src/
│   ├── cli.js              # entry point: args, fan-out, keystore + CSV
│   ├── cdp.js              # dependency-free CDP client (raw WebSocket)
│   ├── mailtm.js           # mail.tm disposable inboxes
│   ├── sorin.js            # UI login + JWT capture + key mint + verify
│   ├── provision.js        # one-shot account provisioning (login→key→verify)
│   ├── pool-adapter.js     # OpenAI-compatible, load-balanced gateway
│   ├── keystore.js         # JSON keystore + CSV export
│   └── connect-9router.js  # register the pool in 9Router
├── docs/
│   └── PROTOCOL.md         # full wire protocol
├── examples/
│   ├── basic.js            # create one account programmatically
│   └── inference.js        # call the pool like the OpenAI API
├── i18n/
│   ├── README.id.md        # Bahasa Indonesia
│   ├── README.zh.md        # 中文
│   ├── README.ja.md        # 日本語
│   └── README.es.md        # Español
├── brand/
│   ├── logo.svg
│   └── icon.svg
├── package.json
├── LICENSE
└── README.md
```

## Data flow

```
cli.js
  └─ mapLimit(concurrency)
       └─ provision.js :: provisionAccount
            ├─ mailtm.js         create inbox
            ├─ cdp.js            Target.createBrowserContext (isolation)
            ├─ sorin.js :: SorinBrowser.login
            │     ├─ submitEmail      (AppKit shadow DOM + pointer sequence)
            │     ├─ enterLoginCode   (mail.tm OTP)
            │     └─ signWallet       (WalletConnect iframe → Sign)
            ├─ sorin.js :: createAgentKey   (Sahara API, Idempotency-Key)
            └─ sorin.js :: testAgentKey     (live run)
       └─ keystore.js           JSON + CSV

pool-adapter.js ──▶ /v1/chat/completions ──▶ api.heysorin.ai/v1/agent/runs
connect-9router.js ──▶ 9Router /api/provider-nodes + /api/providers
```

## Module responsibilities

| Module | Depends on | Responsibility |
| --- | --- | --- |
| `cdp.js` | – | WebSocket framing, `send`, `waitFor`, browser contexts |
| `mailtm.js` | – | Create inbox, poll and read messages |
| `sorin.js` | `cdp.js` | Drive the login UI; mint/list/delete keys; test a key |
| `provision.js` | `cdp.js`, `mailtm.js`, `sorin.js` | Full per-account pipeline |
| `pool-adapter.js` | – | HTTP gateway, round-robin, failover, streaming |
| `keystore.js` | – | Persist accounts, export CSV |
| `connect-9router.js` | – | Register provider-node + connection |
| `cli.js` | all of the above | CLI, fan-out, progress, wiring |
