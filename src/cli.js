#!/usr/bin/env node
'use strict';

/**
 * sorin-bulk — bulk create heysorin.ai accounts, mint an Agent API key for each,
 * and connect the whole pool to 9Router.
 *
 *   node src/cli.js --count 3
 *   node src/cli.js --count 10 --concurrency 1 --out outputs/sorin-accounts.json
 *   node src/cli.js --connect-9router --base http://localhost:20128
 *
 * A CDP-reachable Chrome is required (the sign-in runs through Reown AppKit and
 * a wallet signature, which cannot be reproduced over plain HTTP). On a VPS:
 *
 *   google-chrome --headless=new --remote-debugging-port=9222 \
 *     --user-data-dir="$HOME/.sorin-chrome" --no-sandbox
 *   node src/cli.js --count 3 --cdp-url http://127.0.0.1:9222
 *
 * Zero dependencies. Node.js >= 18.
 */

const fs = require('fs');
const path = require('path');
const { CDP } = require('./cdp');
const { MailTM } = require('./mailtm');
const { provisionAccount } = require('./provision');
const { Keystore } = require('./keystore');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) args[key] = true;
      else {
        args[key] = next;
        i++;
      }
    } else args._.push(a);
  }
  return args;
}

function banner() {
  process.stderr.write(
    '\n' +
      '  \x1b[38;5;45m╭────────────────────────────────────────────────╮\x1b[0m\n' +
      '  \x1b[38;5;45m│\x1b[0m  \x1b[1m🛰  sorin-bulk\x1b[0m  ·  Sorin API-key pool builder     \x1b[38;5;45m│\x1b[0m\n' +
      '  \x1b[38;5;45m╰────────────────────────────────────────────────╯\x1b[0m\n\n'
  );
}

async function resolveWs(args) {
  if (args['cdp-ws']) return String(args['cdp-ws']);
  const httpUrl = args['cdp-url'] || process.env.CDP_URL;
  if (httpUrl) {
    const base = String(httpUrl).replace(/\/$/, '');
    const res = await fetch(`${base}/json/version`);
    if (!res.ok) throw new Error(`could not reach Chrome at ${base} (${res.status})`);
    const j = await res.json();
    return j.webSocketDebuggerUrl;
  }
  if (process.env.CDP_WS) return process.env.CDP_WS;
  const res = await fetch('http://127.0.0.1:9222/json/version');
  const j = await res.json();
  return j.webSocketDebuggerUrl;
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let idx = 0;
  let active = 0;
  return new Promise((resolve) => {
    const next = () => {
      if (idx >= items.length && active === 0) return resolve(results);
      while (active < limit && idx < items.length) {
        const i = idx++;
        active++;
        Promise.resolve(worker(items[i], i))
          .then((r) => (results[i] = r))
          .catch((e) => (results[i] = { status: 'error', error: e.message }))
          .finally(() => {
            active--;
            next();
          });
      }
    };
    next();
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) return usage();

  const count = parseInt(args.count || args.n || '1', 10);
  const concurrency = Math.max(1, parseInt(args.concurrency || args.c || '1', 10));
  const outPath = args.out || 'outputs/sorin-accounts.json';
  const csvPath = args.csv || outPath.replace(/\.json$/, '.csv');
  const keyPrefix = args['key-prefix'] || 'sorin-bulk';
  const keyName = args['key-name'] || null;
  const quiet = !!args.quiet;
  const noVerify = !!args['no-verify'];

  banner();

  let wsUrl;
  try {
    wsUrl = await resolveWs(args);
  } catch (e) {
    throw new Error(
      `${e.message}\n  Start Chrome with a debug port first, e.g.:\n` +
        '    google-chrome --headless=new --remote-debugging-port=9222 \\\n' +
        '      --user-data-dir="$HOME/.sorin-chrome" --no-sandbox\n' +
        '  then run: node src/cli.js --cdp-url http://127.0.0.1:9222'
    );
  }

  const cdp = new CDP(wsUrl, {});
  await cdp.connect();
  await cdp.attachToPage({});
  console.log(`connected to browser · minting ${count} account(s), concurrency ${concurrency}`);

  const mail = new MailTM();
  const store = new Keystore(outPath);
  const jobs = Array.from({ length: count }, (_, i) => i);

  const results = await mapLimit(jobs, concurrency, async (i) => {
    const tag = `[${i + 1}/${count}]`;
    const log = (m) => !quiet && process.stderr.write(`  ${tag} ${m}\n`);
    log('starting');
    const r = await provisionAccount(cdp, {
      keyName: keyName || `${keyPrefix}-${i + 1}`,
      index: i + 1,
      log,
      mail,
      verify: !noVerify,
    });
    log(r.status === 'ok' ? `✔ ${r.email} · ${r.apiKey}` : `✖ ${r.error}`);
    return r;
  });

  cdp.close();

  for (const r of results) if (r) store.add(r);
  store.save();

  const ok = store.ok();
  const csv = store.toCsv();
  fs.writeFileSync(csvPath, csv);

  console.log(`\n  done · ${ok.length}/${count} succeeded`);
  console.log(`  json → ${outPath}`);
  console.log(`  csv  → ${csvPath}`);

  if (args['connect-9router'] || args.connect) {
    const { connect } = require('./connect-9router');
    await connect({
      base: String(args.base || 'http://localhost:20128'),
      password: String(args.password || '123456'),
      adapterUrl: String(args.adapter || 'http://localhost:8791'),
    });
  }
  console.log('');
}

function usage() {
  console.log(`
sorin-bulk — bulk create Sorin (heysorin.ai) accounts + Agent API keys

Options:
  -n, --count <n>          number of accounts to create              [1]
  -c, --concurrency <n>    parallel accounts (1 per browser context) [1]
      --cdp-url <url>      Chrome debug HTTP endpoint      [http://127.0.0.1:9222]
      --cdp-ws <url>       explicit CDP WebSocket URL
      --out <file>         JSON keystore path         [outputs/sorin-accounts.json]
      --csv <file>         CSV export path (defaults beside --out)
      --key-prefix <name>  Agent key name prefix                    [sorin-bulk]
      --key-name <name>    fixed Agent key name (overrides prefix)
      --no-verify          skip the live prompt that verifies each key
      --connect-9router    register the pool in 9Router when done
      --base <url>         9Router base URL               [http://localhost:20128]
      --password <pw>      9Router password                        [123456]
      --adapter <url>      pool adapter base URL          [http://localhost:8791]
      --quiet              suppress per-account progress
  -h, --help               show this help

Serving the pool to 9Router:
  SORIN_KEYSTORE=outputs/sorin-accounts.json node src/pool-adapter.js
  node src/connect-9router.js --base http://localhost:20128 --adapter http://localhost:8791

Environment:
  CDP_URL / CDP_WS          CDP endpoint of the Chrome to drive
  SORIN_KEYSTORE            keystore path used by the pool adapter
  SORIN_API_KEYS            comma-separated keys (overrides keystore)
`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error('\x1b[31m[fatal]\x1b[0m ' + e.message);
    process.exit(1);
  });
}

module.exports = { main, parseArgs, mapLimit };
