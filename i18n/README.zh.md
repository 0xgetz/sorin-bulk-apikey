<div align="center">

<img src="../brand/logo.svg" width="128" alt="sorin-bulk logo">

# sorin-bulk-apikey

**批量创建 [Sorin](https://heysorin.ai) 账号与 Agent API 密钥，并将其作为一个 OpenAI 兼容的池接入 [9Router](https://9router.com)。**

零依赖 · Node ≥ 18 · 基于 CDP · 端到端验证

[![License: MIT](https://img.shields.io/badge/License-MIT-22D3EE.svg)](../LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-339933.svg?logo=node.js&logoColor=white)](https://nodejs.org)
[![Dependencies](https://img.shields.io/badge/dependencies-0-34D399.svg)](../package.json)
[![9Router](https://img.shields.io/badge/9Router-ready-818CF8.svg)](https://9router.com)
[![Sorin](https://img.shields.io/badge/Sorin-heysorin.ai-F59E0B.svg)](https://heysorin.ai)
[![Platform](https://img.shields.io/badge/VPS-any%20Linux%20%E2%80%A2%20macOS%20%E2%80%A2%20Windows-64748B.svg)](#环境要求)

[English](../README.md) · [Bahasa](README.id.md) · [中文](README.zh.md) · [日本語](README.ja.md) · [Español](README.es.md)

</div>

---

## 功能简介

Sorin 没有公开的注册 API。账号必须通过真实界面创建：邮箱魔法链接、6 位验证码，
以及由 Magic 在 WalletConnect（Reown AppKit）弹窗中签发的 EVM 钱包签名。
`sorin-bulk-apikey` 通过 DevTools 协议在真实 Chrome 中驱动这一流程，每个账号使用
独立的浏览器上下文，随后捕获 Sorin 会话 JWT，并用它铸造 **Agent-as-a-Service API
密钥**——全自动完成。

产物是一个 JSON 密钥库：`email · password · apiKey · jwt`。内置网关
（`pool-adapter`）将全部密钥以一个 OpenAI 兼容端点对外提供，支持轮询负载均衡与
故障转移，`connect-9router.js` 只需一条命令即可把网关注册到 **9Router**。

```
┌────────────┐   CDP    ┌──────────────┐   mint     ┌─────────────┐
│  Chrome    │ ───────▶ │  heysorin.ai │ ─────────▶ │  Agent key  │
│ (任意 VPS) │  login   │  + Sahara AI │            │ sk-sahara…  │
└────────────┘          └──────────────┘            └──────┬──────┘
                                                           │ pool
                        ┌──────────────┐   /v1   ┌─────────▼────────┐
                        │   9Router    │ ◀────── │  pool-adapter    │
                        │ sorin/sorin-*│         │ round-robin + LB │
                        └──────────────┘         └──────────────────┘
```

## 环境要求

- **Node.js ≥ 18** —— 这就是全部依赖，无需 `npm install`。
- 一个可用调试端口启动的 **Chrome / Chromium**（登录流程无法用普通 HTTP 客户端复现）。
- 邮箱来自 [mail.tm](https://mail.tm)（免费、无需注册），工具会自动创建。

可在任意 Linux VPS、macOS 和 Windows 上运行。没有任何部分绑定特定主机——
你把它指向**你自己的** Chrome 即可。

## 快速开始

### 1. 以调试端口启动 Chrome

```bash
# Linux VPS / 服务器（无头）
google-chrome --headless=new --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.sorin-chrome" --no-sandbox --disable-gpu

# macOS
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 --user-data-dir="$HOME/.sorin-chrome"

# Windows (PowerShell)
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-port=9222 --user-data-dir="$env:USERPROFILE\.sorin-chrome"
```

> `--user-data-dir` **不能**使用你日常的 Chrome 配置目录。Chrome 136+ 在复用默认
> 配置时会静默禁用调试端口。

确认已启动：

```bash
curl http://127.0.0.1:9222/json/version
```

### 2. 铸造账号

```bash
# 一个账号
node src/cli.js --count 1

# 十个账号，每次三个，指定 Chrome
node src/cli.js --count 10 --concurrency 3 --cdp-url http://127.0.0.1:9222
```

每个账号约需 **1.5–2 分钟**（注册、验证码、钱包签名、铸造密钥、实时验证）。进度与
CSV/JSON 密钥库会写入 `outputs/`。

### 3. 将池接入 9Router

```bash
# 启动 OpenAI 兼容网关（默认 :8791）
SORIN_KEYSTORE=outputs/sorin-accounts.json node src/pool-adapter.js

# 注册到正在运行的 9Router（默认 http://localhost:20128）
node src/connect-9router.js --base http://localhost:20128 --adapter http://localhost:8791
```

9Router 中现在可用的模型：

```
sorin/sorin-fast     # 低延迟
sorin/sorin-auto     # 自动模式
sorin/sorin-expert   # 深度 / 研究模式
```

## CLI

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `-n, --count <n>` | `1` | 要创建的账号数 |
| `-c, --concurrency <n>` | `1` | 并行账号数（每个一个浏览器上下文） |
| `--cdp-url <url>` | `http://127.0.0.1:9222` | Chrome 调试 HTTP 端点 |
| `--cdp-ws <url>` | – | 显式 CDP WebSocket URL |
| `--out <file>` | `outputs/sorin-accounts.json` | JSON 密钥库路径 |
| `--csv <file>` | 与 `--out` 同目录 | CSV 导出路径 |
| `--key-prefix <name>` | `sorin-bulk` | Agent 密钥名前缀 |
| `--key-name <name>` | – | 固定密钥名（覆盖前缀） |
| `--no-verify` | 关 | 跳过每个密钥的实时验证 |
| `--connect-9router` | 关 | 完成后注册池到 9Router |
| `--base <url>` | `http://localhost:20128` | 9Router 基础 URL |
| `--password <pw>` | `123456` | 9Router 密码 |
| `--adapter <url>` | `http://localhost:8791` | 池适配器基础 URL |
| `--quiet` | 关 | 隐藏每账号进度 |

环境变量：`CDP_URL`、`CDP_WS`、`SORIN_KEYSTORE`、`SORIN_API_KEYS`。

## 密钥库格式

`outputs/sorin-accounts.json`：

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

同目录会写入对应的 `.csv`。**请将此文件视为机密** —— 其中包含有效的 API 密钥和会话令牌。

## 工作原理

1. **一次性邮箱** —— 每个账号一个全新的 mail.tm 邮箱。
2. **隔离的浏览器上下文** —— `Target.createBrowserContext` 为每个账号提供独立的
   cookie 与存储，账号之间互不干扰；一个 Chrome 即可并发多个账号。
3. **通过 CDP 驱动界面登录** —— 点击 *Sign In*，在 Reown AppKit 的 Shadow DOM 中
   填入邮箱，用完整的指针事件序列点击箭头按钮（AppKit 会忽略单纯的 `.click()`），
   输入 6 位验证码，然后在 WalletConnect `secure.walletconnect.org` iframe 内点击
   *Sign*。
4. **捕获 JWT** —— 应用以 `Authorization: Bearer <会话 JWT>` 调用 Sahara AI 后端；
   通过插桩 `fetch`/`XHR` 从首个已认证请求中截取。
5. **铸造密钥** —— `POST https://app.saharaai.com/developer/api/agent-api-keys`，
   带上 JWT 与 `Idempotency-Key` 头，返回 `sk-sahara-agent-…` 密钥（仅显示一次）。
6. **验证** —— 向 `POST https://api.heysorin.ai/v1/agent/runs` 发送一条极短提示，
   证明密钥可用。

完整协议见 [`docs/PROTOCOL.md`](../docs/PROTOCOL.md)。

## 池适配器

`src/pool-adapter.js` 是一个零依赖 HTTP 服务器，使用 OpenAI chat-completions 结构，
将请求分摊到你的全部 Sorin 密钥。

| 端点 | 用途 |
| --- | --- |
| `GET /health` | 池状态（密钥、健康数、模型） |
| `GET /v1/models` | OpenAI 模型列表 |
| `GET /v1/chat/completions` | 对话补全（流式与非流式） |
| `GET /pool` | 每个密钥的健康详情 |
| `POST /pool/reload` | 从磁盘重新读取密钥库 |

每次请求按轮询选择密钥；某个密钥失败则尝试下一个。模型别名：`sorin-fast`、
`sorin-auto`、`sorin-expert`（也接受 `sorin/` 前缀）。

```bash
curl http://127.0.0.1:8791/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"model":"sorin-auto","messages":[{"role":"user","content":"你好"}]}'
```

## 说明与限制

- Sorin 账号需要一个由 Magic 在客户端生成的 **EVM 钱包**；本工具从不接触私钥——
  它只是驱动界面。
- 免费 Sorin 账号有**每日配额**（约 30 次/天，每次约 2 积分）。需要更多配额就轮换
  更多账号；池正是为此设计。
- Agent 端点**不是**通用聊天 API：没有 `/v1/models`，也没有采样参数。`mode` 映射到
  界面模式 `fast` / `expert`。
- 请负责任地使用，并遵守各服务提供商的条款。

## 许可证

[MIT](../LICENSE)。
