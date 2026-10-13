# Wire protocol

Everything `sorin-bulk-apikey` does on the wire, so the flow can be reimplemented
in any language.

## 1. Disposable mailbox — mail.tm

| Step | Request |
| --- | --- |
| Domains | `GET https://api.mail.tm/domains` |
| Create account | `POST https://api.mail.tm/accounts` `{ address, password }` |
| Token | `POST https://api.mail.tm/token` `{ address, password }` → `{ token }` |
| List mail | `GET https://api.mail.tm/messages` |
| Read mail | `GET https://api.mail.tm/messages/<id>` |

Mail arrives in `text` (and `html`). Login codes match `\b(\d{6})\b`; a
device-approval mail contains a `https://register.walletconnect.com…` link.

## 2. Sorin login (browser, over CDP)

The sign-in widget is Reown AppKit in a `<w3m-modal>` with a shadow root; the
wallet is Magic. Sequence:

1. Open `https://heysorin.ai`, click **Sign In**. AppKit buttons ignore a bare
   `.click()` — dispatch `pointerover → pointerenter → pointerdown → mousedown →
   pointerup → mouseup → click` (`bubbles, composed`).
2. Fill the `input[type=email]` in the modal's shadow root (native value setter +
   `input`/`change` events), then real-click the arrow `button[type=submit]` beside
   it.
3. **Confirm Email** appears → read the 6-digit code from mail.tm → type it into
   the modal's OTP inputs.
4. A **signature request** dialog mounts inside the WalletConnect iframe
   `https://secure.walletconnect.org/sdk?…`. Attach to that iframe target, find the
   visible `WUI-BUTTON`/`BUTTON` labelled **Sign**, real-click it.
5. The app lands on `/chat` and calls the Sahara AI backend with
   `Authorization: Bearer <session JWT>`. We instrument `fetch` and
   `XMLHttpRequest` before login to capture that header into `window.__sorinJwt`.

### Detecting the OTP screen

Read text across shadow roots — `document.body.innerText` misses AppKit content:

```js
const walk = (root, out = []) => {
  for (const el of root.querySelectorAll('*')) {
    out.push(el);
    if (el.shadowRoot) walk(el.shadowRoot, out);
  }
  return out;
};
```

## 3. Mint an Agent API key (Sahara AI)

Base: `https://app.saharaai.com/developer/api/agent-api-keys`
Auth: `Authorization: Bearer <sorin session JWT>`

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/` | list keys (`api_keys`) |
| `POST` | `/` | create: body `{ name }`, header `Idempotency-Key: <uuid>` → `{ api_key, api_key_info }` |
| `DELETE` | `/<id>` | revoke |

`api_key` is `sk-sahara-agent-…` and is **returned only once**. Free plans allow a
few keys per account.

## 4. Run the agent (what the key is for)

Base: `https://api.heysorin.ai`
Auth: `Authorization: Bearer <sk-sahara-agent-…>`

```
POST /v1/agent/runs
Content-Type: application/json

{ "message": { "role": "user", "content": "…" },
  "mode": "fast" | "expert" }
```

Response (non-streaming, one completed run):

```json
{
  "id": "run_…",
  "content": "…",
  "usage": { "charged_credits": 2 }
}
```

Notes:

- There is **no `/v1/models`** and no sampling parameters. `mode` maps to the UI
  modes: *Fast/Auto* → `fast`, *Research/Expert* → `expert`.
- Each run charges credits (≈2). Free accounts have a daily cap.

## 5. Pool adapter (OpenAI-compatible)

`src/pool-adapter.js` translates OpenAI chat requests into `POST /v1/agent/runs`,
picking a key round-robin and failing over on error.

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | `{ status, keys, healthy, models }` |
| `GET /v1/models` | OpenAI model list |
| `POST /v1/chat/completions` | chat completion (stream + non-stream) |
| `GET /pool` | per-key health |
| `POST /pool/reload` | reload keystore |

The OpenAI `messages` array is flattened to a single `content` string; `model`
selects the Sorin `mode`. Non-streaming responses are synthesized into a
`chat.completion` object, streaming into `chat.completion.chunk` SSE frames ending
with `data: [DONE]`.

## 6. 9Router registration

9Router base (default `http://localhost:20128`), password default `123456`.

| Method | Path | Body |
| --- | --- | --- |
| `POST` | `/api/auth/login` | `{ password }` → session cookie |
| `POST` | `/api/provider-nodes` | `{ name, prefix, apiType:"chat", type:"openai-compatible", baseUrl }` |
| `POST` | `/api/providers` | `{ provider:<nodeId>, apiKey, name, priority }` |

The connector registers prefix `sorin` pointing at the pool adapter's `/v1`,
yielding `sorin/sorin-fast|auto|expert` inside 9Router.
