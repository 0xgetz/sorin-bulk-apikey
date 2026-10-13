<div align="center">

<img src="../brand/logo.svg" width="128" alt="sorin-bulk logo">

# sorin-bulk-apikey

**Crea cuentas y claves Agent API de [Sorin](https://heysorin.ai) en masa y sirve todo como un único pool compatible con OpenAI en [9Router](https://9router.com).**

Cero dependencias · Node ≥ 18 · basado en CDP · verificado de extremo a extremo

[![License: MIT](https://img.shields.io/badge/License-MIT-22D3EE.svg)](../LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-339933.svg?logo=node.js&logoColor=white)](https://nodejs.org)
[![Dependencies](https://img.shields.io/badge/dependencies-0-34D399.svg)](../package.json)
[![9Router](https://img.shields.io/badge/9Router-ready-818CF8.svg)](https://9router.com)
[![Sorin](https://img.shields.io/badge/Sorin-heysorin.ai-F59E0B.svg)](https://heysorin.ai)
[![Platform](https://img.shields.io/badge/VPS-any%20Linux%20%E2%80%A2%20macOS%20%E2%80%A2%20Windows-64748B.svg)](#requisitos)

[English](../README.md) · [Bahasa](README.id.md) · [中文](README.zh.md) · [日本語](README.ja.md) · [Español](README.es.md)

</div>

---

## Qué hace

Sorin no tiene una API de registro pública. Las cuentas se crean a través de la
interfaz real: un enlace mágico por correo, un código de 6 dígitos y una firma de
monedero EVM emitida por Magic dentro de un modal de WalletConnect (Reown
AppKit). `sorin-bulk-apikey` ejecuta ese flujo en un Chrome real mediante el
DevTools Protocol, con un contexto de navegador aislado por cuenta, luego captura
el JWT de sesión de Sorin y lo usa para acuñar una **clave API
Agent-as-a-Service** — todo automáticamente.

El resultado es un keystore JSON con `email · password · apiKey · jwt`. Una
pasarela incluida (`pool-adapter`) expone todas las claves tras un único endpoint
compatible con OpenAI, con round-robin y failover, y `connect-9router.js` registra
esa pasarela en **9Router** con un solo comando.

```
┌────────────┐   CDP    ┌──────────────┐   mint     ┌─────────────┐
│  Chrome    │ ───────▶ │  heysorin.ai │ ─────────▶ │  Agent key  │
│ (cual VPS) │  login   │  + Sahara AI │            │ sk-sahara…  │
└────────────┘          └──────────────┘            └──────┬──────┘
                                                           │ pool
                        ┌──────────────┐   /v1   ┌─────────▼────────┐
                        │   9Router    │ ◀────── │  pool-adapter    │
                        │ sorin/sorin-*│         │ round-robin + LB │
                        └──────────────┘         └──────────────────┘
```

## Requisitos

- **Node.js ≥ 18** — esa es toda la lista de dependencias. Sin `npm install`.
- Un **Chrome / Chromium** que puedas lanzar con un puerto de depuración (el
  inicio de sesión no se puede reproducir con un cliente HTTP simple).
- Los buzones provienen de [mail.tm](https://mail.tm) (gratis, sin registro); la
  herramienta los crea por ti.

Funciona en cualquier VPS Linux, macOS y Windows. Nada aquí está atado a un host
concreto: tú lo apuntas a *tu* Chrome.

## Inicio rápido

### 1. Lanza Chrome con un puerto de depuración

```bash
# VPS Linux / servidor (headless)
google-chrome --headless=new --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.sorin-chrome" --no-sandbox --disable-gpu

# macOS
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 --user-data-dir="$HOME/.sorin-chrome"

# Windows (PowerShell)
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-port=9222 --user-data-dir="$env:USERPROFILE\.sorin-chrome"
```

> El `--user-data-dir` **no** debe ser tu perfil habitual de Chrome. Chrome 136+
> desactiva silenciosamente el puerto de depuración si reutilizas el perfil
> predeterminado.

Confirma que está activo:

```bash
curl http://127.0.0.1:9222/json/version
```

### 2. Acuña cuentas

```bash
# una cuenta
node src/cli.js --count 1

# diez cuentas, tres a la vez, desde un Chrome concreto
node src/cli.js --count 10 --concurrency 3 --cdp-url http://127.0.0.1:9222
```

Cada cuenta tarda aproximadamente **1,5–2 minutos** (registro, código, firma del
monedero, acuñado de clave, verificación en vivo). El progreso y el keystore
CSV/JSON se guardan en `outputs/`.

### 3. Sirve el pool a 9Router

```bash
# inicia la pasarela compatible con OpenAI (por defecto :8791)
SORIN_KEYSTORE=outputs/sorin-accounts.json node src/pool-adapter.js

# regístrala en un 9Router en ejecución (por defecto http://localhost:20128)
node src/connect-9router.js --base http://localhost:20128 --adapter http://localhost:8791
```

Modelos ahora disponibles en 9Router:

```
sorin/sorin-fast     # baja latencia
sorin/sorin-auto     # modo automático
sorin/sorin-expert   # modo profundo / investigación
```

## CLI

| Opción | Predeterminado | Descripción |
| --- | --- | --- |
| `-n, --count <n>` | `1` | número de cuentas a crear |
| `-c, --concurrency <n>` | `1` | cuentas en paralelo (un contexto cada una) |
| `--cdp-url <url>` | `http://127.0.0.1:9222` | endpoint HTTP de depuración de Chrome |
| `--cdp-ws <url>` | – | URL WebSocket CDP explícita |
| `--out <file>` | `outputs/sorin-accounts.json` | ruta del keystore JSON |
| `--csv <file>` | junto a `--out` | ruta de exportación CSV |
| `--key-prefix <name>` | `sorin-bulk` | prefijo del nombre de la clave Agent |
| `--key-name <name>` | – | nombre fijo de clave (anula el prefijo) |
| `--no-verify` | off | omite la verificación en vivo de cada clave |
| `--connect-9router` | off | registra el pool en 9Router al terminar |
| `--base <url>` | `http://localhost:20128` | URL base de 9Router |
| `--password <pw>` | `123456` | contraseña de 9Router |
| `--adapter <url>` | `http://localhost:8791` | URL base del pool adapter |
| `--quiet` | off | oculta el progreso por cuenta |

Variables de entorno: `CDP_URL`, `CDP_WS`, `SORIN_KEYSTORE`, `SORIN_API_KEYS`.

## Formato del keystore

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
      "verified": true,
      "credits": 2
    }
  ]
}
```

Se escribe un `.csv` equivalente junto a él. **Trata este archivo como un secreto**
— contiene claves API y tokens de sesión activos.

## Cómo funciona

1. **Buzón desechable** — un buzón mail.tm nuevo por cuenta.
2. **Contexto de navegador aislado** — `Target.createBrowserContext` da a cada
   cuenta sus propias cookies y almacenamiento, así que no colisionan; muchas
   pueden ejecutarse desde un solo Chrome.
3. **Inicio de sesión por CDP** — pulsa *Sign In*, rellena el correo en el Shadow
   DOM de Reown AppKit, envía el botón de flecha con una secuencia completa de
   puntero (AppKit ignora un `.click()` simple), escribe el código de 6 dígitos y
   pulsa *Sign* dentro del iframe de WalletConnect `secure.walletconnect.org`.
4. **Captura del JWT** — la app llama al backend de Sahara AI con
   `Authorization: Bearer <JWT de sesión>`; se instrumentan `fetch`/`XHR` para
   tomarlo de la primera petición autenticada.
5. **Acuñado de clave** — `POST https://app.saharaai.com/developer/api/agent-api-keys`
   con el JWT y una cabecera `Idempotency-Key` devuelve el secreto
   `sk-sahara-agent-…` (se muestra una sola vez).
6. **Verificación** — se envía un prompt mínimo a
   `POST https://api.heysorin.ai/v1/agent/runs` para probar que la clave está viva.

Consulta [`docs/PROTOCOL.md`](../docs/PROTOCOL.md) para el protocolo completo.

## Pool adapter

`src/pool-adapter.js` es un servidor HTTP sin dependencias que habla el formato
chat-completions de OpenAI y reparte las peticiones entre tus claves de Sorin.

| Endpoint | Propósito |
| --- | --- |
| `GET /health` | estado del pool (claves, sanas, modelos) |
| `GET /v1/models` | lista de modelos OpenAI |
| `GET /v1/chat/completions` | chat completion (streaming y no streaming) |
| `GET /pool` | detalle de salud por clave |
| `POST /pool/reload` | recarga el keystore desde disco |

Elige una clave por petición en round-robin; si una falla, prueba la siguiente.
Alias de modelo: `sorin-fast`, `sorin-auto`, `sorin-expert` (también con prefijo
`sorin/`).

```bash
curl http://127.0.0.1:8791/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"model":"sorin-auto","messages":[{"role":"user","content":"hola"}]}'
```

## Notas y límites

- Las cuentas Sorin requieren un **monedero EVM** que Magic genera en el cliente;
  esta herramienta nunca toca una clave privada — solo maneja la interfaz.
- Las cuentas gratuitas de Sorin tienen una **cuota diaria** (~30 ejecuciones/día,
  ~2 créditos por ejecución). Rota más cuentas para más margen; el pool está hecho
  justo para eso.
- El endpoint del agente **no** es una API de chat genérica: sin `/v1/models`, sin
  parámetros de muestreo. `mode` se asigna a los modos de la interfaz `fast` /
  `expert`.
- Úsalo con responsabilidad y conforme a los términos de los proveedores.

## Licencia

[MIT](../LICENSE).
