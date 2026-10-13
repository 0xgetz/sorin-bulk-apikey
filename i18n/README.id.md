<div align="center">

<img src="../brand/logo.svg" width="128" alt="sorin-bulk logo">

# sorin-bulk-apikey

**Membuat akun [Sorin](https://heysorin.ai) dan Agent API key secara massal, lalu menyajikannya ke [9Router](https://9router.com) sebagai satu pool kompatibel-OpenAI.**

Tanpa dependensi · Node ≥ 18 · berbasis CDP · terverifikasi end-to-end

[![License: MIT](https://img.shields.io/badge/License-MIT-22D3EE.svg)](../LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-339933.svg?logo=node.js&logoColor=white)](https://nodejs.org)
[![Dependencies](https://img.shields.io/badge/dependencies-0-34D399.svg)](../package.json)
[![9Router](https://img.shields.io/badge/9Router-ready-818CF8.svg)](https://9router.com)
[![Sorin](https://img.shields.io/badge/Sorin-heysorin.ai-F59E0B.svg)](https://heysorin.ai)
[![Platform](https://img.shields.io/badge/VPS-any%20Linux%20%E2%80%A2%20macOS%20%E2%80%A2%20Windows-64748B.svg)](#persyaratan)

[English](../README.md) · [Bahasa](README.id.md) · [中文](README.zh.md) · [日本語](README.ja.md) · [Español](README.es.md)

</div>

---

## Apa fungsinya

Sorin tidak punya API pendaftaran publik. Akun dibuat lewat UI asli: tautan ajaib
email, kode 6 digit, dan tanda tangan wallet EVM yang diterbitkan Magic di dalam
modal WalletConnect (Reown AppKit). `sorin-bulk-apikey` menjalankan alur itu di
Chrome nyata lewat DevTools Protocol, satu konteks browser terisolasi per akun,
lalu menangkap JWT sesi Sorin dan memakainya untuk membuat **API key
Agent-as-a-Service** — semuanya otomatis.

Hasilnya adalah keystore JSON berisi `email · password · apiKey · jwt`. Sebuah
gateway bawaan (`pool-adapter`) menyajikan semua key di balik satu endpoint
kompatibel-OpenAI dengan round-robin dan failover, dan `connect-9router.js`
mendaftarkan gateway itu ke **9Router** dengan satu perintah.

```
┌────────────┐   CDP    ┌──────────────┐   mint     ┌─────────────┐
│  Chrome    │ ───────▶ │  heysorin.ai │ ─────────▶ │  Agent key  │
│ (VPS apa)  │  login   │  + Sahara AI │            │ sk-sahara…  │
└────────────┘          └──────────────┘            └──────┬──────┘
                                                           │ pool
                        ┌──────────────┐   /v1   ┌─────────▼────────┐
                        │   9Router    │ ◀────── │  pool-adapter    │
                        │ sorin/sorin-*│         │ round-robin + LB │
                        └──────────────┘         └──────────────────┘
```

## Persyaratan

- **Node.js ≥ 18** — itu seluruh daftar dependensinya. Tanpa `npm install`.
- **Chrome / Chromium** yang bisa dijalankan dengan port debug (login tidak bisa
  direproduksi dengan klien HTTP biasa).
- Kotak surat diambil dari [mail.tm](https://mail.tm) (gratis, tanpa daftar);
  tool membuatnya untuk Anda.

Berjalan di VPS Linux apa pun, macOS, dan Windows. Tidak ada bagian yang terikat
pada host tertentu — Anda mengarahkannya ke Chrome *milik Anda*.

## Mulai cepat

### 1. Jalankan Chrome dengan port debug

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

> `--user-data-dir` **tidak boleh** profil Chrome sehari-hari Anda. Chrome 136+
> diam-diam mematikan port debug bila Anda memakai profil default.

Pastikan sudah hidup:

```bash
curl http://127.0.0.1:9222/json/version
```

### 2. Buat akun

```bash
# satu akun
node src/cli.js --count 1

# sepuluh akun, tiga sekaligus, dari Chrome tertentu
node src/cli.js --count 10 --concurrency 3 --cdp-url http://127.0.0.1:9222
```

Setiap akun butuh sekitar **1,5–2 menit** (daftar, kode, tanda tangan wallet,
mint key, verifikasi langsung). Progres serta keystore CSV/JSON tersimpan di
`outputs/`.

### 3. Sajikan pool ke 9Router

```bash
# jalankan gateway kompatibel-OpenAI (default :8791)
SORIN_KEYSTORE=outputs/sorin-accounts.json node src/pool-adapter.js

# daftarkan ke 9Router yang berjalan (default http://localhost:20128)
node src/connect-9router.js --base http://localhost:20128 --adapter http://localhost:8791
```

Model yang kini tersedia di 9Router:

```
sorin/sorin-fast     # latensi rendah
sorin/sorin-auto     # mode otomatis
sorin/sorin-expert   # mode mendalam / riset
```

## CLI

| Flag | Default | Deskripsi |
| --- | --- | --- |
| `-n, --count <n>` | `1` | jumlah akun yang dibuat |
| `-c, --concurrency <n>` | `1` | akun paralel (satu konteks browser masing-masing) |
| `--cdp-url <url>` | `http://127.0.0.1:9222` | endpoint HTTP debug Chrome |
| `--cdp-ws <url>` | – | URL WebSocket CDP eksplisit |
| `--out <file>` | `outputs/sorin-accounts.json` | path keystore JSON |
| `--csv <file>` | di samping `--out` | path ekspor CSV |
| `--key-prefix <name>` | `sorin-bulk` | prefiks nama Agent key |
| `--key-name <name>` | – | nama key tetap (menimpa prefiks) |
| `--no-verify` | nonaktif | lewati prompt verifikasi tiap key |
| `--connect-9router` | nonaktif | daftarkan pool ke 9Router setelah selesai |
| `--base <url>` | `http://localhost:20128` | URL dasar 9Router |
| `--password <pw>` | `123456` | password 9Router |
| `--adapter <url>` | `http://localhost:8791` | URL dasar pool adapter |
| `--quiet` | nonaktif | sembunyikan progres per akun |

Variabel lingkungan: `CDP_URL`, `CDP_WS`, `SORIN_KEYSTORE`, `SORIN_API_KEYS`.

## Format keystore

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

File `.csv` yang sesuai ditulis di sebelahnya. **Anggap berkas ini rahasia** —
berisi API key dan token sesi yang aktif.

## Cara kerjanya

1. **Kotak masuk sekali pakai** — satu mailbox mail.tm baru per akun.
2. **Konteks browser terisolasi** — `Target.createBrowserContext` memberi tiap
   akun cookie dan storage sendiri, jadi akun tidak bertabrakan; banyak akun
   bisa jalan dari satu Chrome.
3. **Login UI lewat CDP** — klik *Sign In*, isi email di shadow DOM Reown AppKit,
   tekan tombol panah dengan urutan pointer lengkap (AppKit mengabaikan `.click()`
   biasa), ketik kode 6 digit, lalu klik *Sign* di dalam iframe WalletConnect
   `secure.walletconnect.org`.
4. **Penangkapan JWT** — aplikasi memanggil backend Sahara AI dengan
   `Authorization: Bearer <session JWT>`; `fetch`/`XHR` diinstrumentasi untuk
   mengambilnya dari permintaan terautentikasi pertama.
5. **Mint key** — `POST https://app.saharaai.com/developer/api/agent-api-keys`
   dengan JWT dan header `Idempotency-Key` mengembalikan secret
   `sk-sahara-agent-…` (hanya tampil sekali).
6. **Verifikasi** — satu prompt kecil dikirim ke
   `POST https://api.heysorin.ai/v1/agent/runs` untuk membuktikan key hidup.

Lihat [`docs/PROTOCOL.md`](../docs/PROTOCOL.md) untuk protokol lengkap.

## Pool adapter

`src/pool-adapter.js` adalah server HTTP tanpa dependensi yang berbicara dalam
bentuk chat-completions OpenAI dan menyebar permintaan ke semua key Sorin Anda.

| Endpoint | Fungsi |
| --- | --- |
| `GET /health` | status pool (key, jumlah sehat, model) |
| `GET /v1/models` | daftar model OpenAI |
| `GET /v1/chat/completions` | chat completion (streaming dan non-streaming) |
| `GET /pool` | detail kesehatan per key |
| `POST /pool/reload` | baca ulang keystore dari disk |

Pilih key per permintaan secara round-robin; bila satu key gagal, coba berikutnya.
Alias model: `sorin-fast`, `sorin-auto`, `sorin-expert` (juga menerima prefiks
`sorin/`).

```bash
curl http://127.0.0.1:8791/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"model":"sorin-auto","messages":[{"role":"user","content":"halo"}]}'
```

## Catatan & batasan

- Akun Sorin butuh **wallet EVM** yang dibuat Magic di sisi klien; tool ini tidak
  pernah menyentuh private key — hanya menjalankan UI.
- Akun Sorin gratis punya **kuota harian** (~30 run/hari, ~2 kredit per run).
  Rotasi lebih banyak akun untuk kuota lebih; pool memang dibuat untuk itu.
- Endpoint agen **bukan** API chat generik: tidak ada `/v1/models`, tidak ada
  knop sampling. `mode` memetakan ke mode UI `fast` / `expert`.
- Gunakan dengan tanggung jawab dan sesuai ketentuan penyedia.

## Lisensi

[MIT](../LICENSE).
