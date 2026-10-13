'use strict';

/**
 * Example: create a single Sorin account and print its Agent API key, then run
 * one prompt with the key to prove it works.
 *
 *   node examples/basic.js --cdp-url http://127.0.0.1:9222
 */

const { CDP } = require('../src/cdp');
const { MailTM } = require('../src/mailtm');
const { provisionAccount } = require('../src/provision');
const { testAgentKey } = require('../src/sorin');

(async () => {
  const argv = process.argv.slice(2);
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[++i];
  }
  const url = args['cdp-url'] || process.env.CDP_URL || 'http://127.0.0.1:9222';
  const ver = await (await fetch(url.replace(/\/$/, '') + '/json/version')).json();
  const wsUrl = args['cdp-ws'] || process.env.CDP_WS || ver.webSocketDebuggerUrl;

  const cdp = new CDP(wsUrl, {});
  await cdp.connect();
  await cdp.attachToPage();

  const account = await provisionAccount(cdp, {
    keyName: 'example-key',
    log: (m) => console.error('·', m),
    mail: new MailTM(),
    verify: false,
  });
  cdp.close();

  if (account.status !== 'ok') throw new Error(account.error);

  console.log('\naccount :', account.email);
  console.log('password:', account.emailPassword);
  console.log('api key :', account.apiKey);

  const run = await testAgentKey(account.apiKey);
  console.log('reply   :', run.content);
})().catch((e) => {
  console.error('[fatal]', e.message);
  process.exit(1);
});
