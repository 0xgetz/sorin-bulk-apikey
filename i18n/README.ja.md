<div align="center">

<img src="../brand/logo.svg" width="128" alt="sorin-bulk logo">

# sorin-bulk-apikey

**[Sorin](https://heysorin.ai) のアカウントと Agent API キーを一括作成し、[9Router](https://9router.com) に OpenAI 互換のプールとして接続します。**

依存ゼロ · Node ≥ 18 · CDP 駆動 · エンドツーエンド検証済み

[![License: MIT](https://img.shields.io/badge/License-MIT-22D3EE.svg)](../LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-339933.svg?logo=node.js&logoColor=white)](https://nodejs.org)
[![Dependencies](https://img.shields.io/badge/dependencies-0-34D399.svg)](../package.json)
[![9Router](https://img.shields.io/badge/9Router-ready-818CF8.svg)](https://9router.com)
[![Sorin](https://img.shields.io/badge/Sorin-heysorin.ai-F59E0B.svg)](https://heysorin.ai)
[![Platform](https://img.shields.io/badge/VPS-any%20Linux%20%E2%80%A2%20macOS%20%E2%80%A2%20Windows-64748B.svg)](#動作要件)

[English](../README.md) · [Bahasa](README.id.md) · [中文](README.zh.md) · [日本語](README.ja.md) · [Español](README.es.md)

</div>

---

## 概要

Sorin には公開されたサインアップ API がありません。アカウントは実際の UI を通じて
作成されます。メールのマジックリンク、6 桁コード、そして WalletConnect（Reown
AppKit）モーダル内で Magic が発行する EVM ウォレット署名です。`sorin-bulk-apikey`
は DevTools プロトコル経由で実ブラウザの Chrome でこのフローを実行し、アカウント
ごとに独立したブラウザコンテキストを使い、Sorin のセッション JWT を取得して
**Agent-as-a-Service API キー**を自動で発行します。

出力は `email · password · apiKey · jwt` を含む JSON キーストアです。同梱のゲート
ウェイ（`pool-adapter`）が全キーを単一の OpenAI 互換エンドポイントの背後にまとめ、
ラウンドロビンとフェイルオーバーを提供します。`connect-9router.js` はコマンド 1 つ
でそのゲートウェイを **9Router** に登録します。

```
┌────────────┐   CDP    ┌──────────────┐   mint     ┌─────────────┐
│  Chrome    │ ───────▶ │  heysorin.ai │ ─────────▶ │  Agent key  │
│ (任意のVPS)│  login   │  + Sahara AI │            │ sk-sahara…  │
└────────────┘          └──────────────┘            └──────┬──────┘
                                                           │ pool
                        ┌──────────────┐   /v1   ┌─────────▼────────┐
                        │   9Router    │ ◀────── │  pool-adapter    │
                        │ sorin/sorin-*│         │ round-robin + LB │
                        └──────────────┘         └──────────────────┘
```

## 動作要件

- **Node.js ≥ 18** — 依存はこれだけです。`npm install` は不要。
- デバッグポート付きで起動できる **Chrome / Chromium**（ログインは素の HTTP
  クライアントでは再現できません）。
- メールボックスは [mail.tm](https://mail.tm)（無料・登録不要）を使用。ツールが
  自動作成します。

任意の Linux VPS、macOS、Windows で動作します。特定のホストに依存する部分はあり
ません。*あなた自身の* Chrome を指定するだけです。

## クイックスタート

### 1. デバッグポート付きで Chrome を起動

```bash
# Linux VPS / サーバー（ヘッドレス）
google-chrome --headless=new --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.sorin-chrome" --no-sandbox --disable-gpu

# macOS
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 --user-data-dir="$HOME/.sorin-chrome"

# Windows (PowerShell)
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-port=9222 --user-data-dir="$env:USERPROFILE\.sorin-chrome"
```

> `--user-data-dir` は日常的に使う Chrome プロファイルに**しないでください**。
> Chrome 136+ では既定プロファイルを再利用するとデバッグポートが無効化されます。

起動確認：

```bash
curl http://127.0.0.1:9222/json/version
```

### 2. アカウントを作成

```bash
# 1 アカウント
node src/cli.js --count 1

# 10 アカウント、同時 3、Chrome を指定
node src/cli.js --count 10 --concurrency 3 --cdp-url http://127.0.0.1:9222
```

1 アカウントあたり約 **1.5〜2 分**（サインアップ、コード、ウォレット署名、キー発行、
実検証）。進捗と CSV/JSON キーストアは `outputs/` に出力されます。

### 3. プールを 9Router に接続

```bash
# OpenAI 互換ゲートウェイを起動（既定 :8791）
SORIN_KEYSTORE=outputs/sorin-accounts.json node src/pool-adapter.js

# 稼働中の 9Router に登録（既定 http://localhost:20128）
node src/connect-9router.js --base http://localhost:20128 --adapter http://localhost:8791
```

9Router で利用可能なモデル：

```
sorin/sorin-fast     # 低遅延
sorin/sorin-auto     # 自動モード
sorin/sorin-expert   # 深掘り / リサーチモード
```

## CLI

| フラグ | 既定 | 説明 |
| --- | --- | --- |
| `-n, --count <n>` | `1` | 作成するアカウント数 |
| `-c, --concurrency <n>` | `1` | 並列数（各 1 ブラウザコンテキスト） |
| `--cdp-url <url>` | `http://127.0.0.1:9222` | Chrome デバッグ HTTP エンドポイント |
| `--cdp-ws <url>` | – | CDP WebSocket URL を明示 |
| `--out <file>` | `outputs/sorin-accounts.json` | JSON キーストアのパス |
| `--csv <file>` | `--out` と同じ場所 | CSV 出力パス |
| `--key-prefix <name>` | `sorin-bulk` | Agent キー名の接頭辞 |
| `--key-name <name>` | – | 固定キー名（接頭辞を上書き） |
| `--no-verify` | オフ | 各キーの実検証をスキップ |
| `--connect-9router` | オフ | 完了後にプールを 9Router へ登録 |
| `--base <url>` | `http://localhost:20128` | 9Router のベース URL |
| `--password <pw>` | `123456` | 9Router のパスワード |
| `--adapter <url>` | `http://localhost:8791` | プールアダプタのベース URL |
| `--quiet` | オフ | アカウントごとの進捗を非表示 |

環境変数：`CDP_URL`、`CDP_WS`、`SORIN_KEYSTORE`、`SORIN_API_KEYS`。

## キーストア形式

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

対応する `.csv` も同じ場所に出力されます。**このファイルは機密として扱ってください**
— 有効な API キーとセッショントークンを含みます。

## 仕組み

1. **使い捨てメール** — アカウントごとに新しい mail.tm メールボックス。
2. **独立したブラウザコンテキスト** — `Target.createBrowserContext` で各アカウントに
   個別の Cookie とストレージを付与。アカウント同士が衝突せず、1 つの Chrome で
   多数を並行実行できます。
3. **CDP 経由の UI ログイン** — *Sign In* をクリックし、Reown AppKit の Shadow DOM
   にメールを入力、完全なポインタイベント列で矢印ボタンを押下（AppKit は素の
   `.click()` を無視します）、6 桁コードを入力し、WalletConnect
   `secure.walletconnect.org` iframe 内の *Sign* をクリック。
4. **JWT 取得** — アプリは `Authorization: Bearer <セッション JWT>` で Sahara AI
   バックエンドを呼びます。`fetch`/`XHR` に計装し、最初の認証済みリクエストから
   取得します。
5. **キー発行** — `POST https://app.saharaai.com/developer/api/agent-api-keys` を
   JWT と `Idempotency-Key` ヘッダ付きで呼び、`sk-sahara-agent-…` シークレットを
   受け取ります（表示は一度きり）。
6. **検証** — `POST https://api.heysorin.ai/v1/agent/runs` に短いプロンプトを送り、
   キーが有効であることを確認。

完全なプロトコルは [`docs/PROTOCOL.md`](../docs/PROTOCOL.md) を参照。

## プールアダプタ

`src/pool-adapter.js` は依存ゼロの HTTP サーバーで、OpenAI chat-completions 形式を
話し、全 Sorin キーにリクエストを分散します。

| エンドポイント | 用途 |
| --- | --- |
| `GET /health` | プール状態（キー、健全数、モデル） |
| `GET /v1/models` | OpenAI モデル一覧 |
| `GET /v1/chat/completions` | チャット補完（ストリーミング / 非ストリーミング） |
| `GET /pool` | キーごとの健全性詳細 |
| `POST /pool/reload` | ディスクからキーストアを再読込 |

リクエストごとにラウンドロビンでキーを選択し、失敗時は次を試行します。モデル別名：
`sorin-fast`、`sorin-auto`、`sorin-expert`（`sorin/` 接頭辞も可）。

```bash
curl http://127.0.0.1:8791/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"model":"sorin-auto","messages":[{"role":"user","content":"こんにちは"}]}'
```

## 注意と制限

- Sorin アカウントには Magic がクライアント側で生成する **EVM ウォレット**が必要です。
  本ツールは秘密鍵に一切触れず、UI を操作するだけです。
- 無料の Sorin アカウントには**日次クォータ**があります（約 30 回/日、1 回あたり約
  2 クレジット）。増やすにはアカウントをローテーションしてください。プールはその
  ために作られています。
- Agent エンドポイントは**汎用チャット API ではありません**：`/v1/models` も
  サンプリング設定もありません。`mode` は UI モード `fast` / `expert` に対応します。
- 各プロバイダの規約に従い、責任をもって使用してください。

## ライセンス

[MIT](../LICENSE)。
