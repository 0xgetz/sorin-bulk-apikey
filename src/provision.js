'use strict';

/**
 * One-shot account provisioning: create a mail.tm inbox, drive the Sorin
 * sign-in in an isolated browser context, capture the session JWT, mint an
 * Agent-as-a-Service key, and (optionally) verify it with a live run.
 *
 * Returns a flat record ready to be persisted by the keystore.
 */

const { CDP } = require('./cdp');
const { MailTM } = require('./mailtm');
const { SorinBrowser, createAgentKey, testAgentKey, sleep } = require('./sorin');

/**
 * @param {CDP} cdp                 connected CDP client (browser level)
 * @param {object} opts
 * @param {string} opts.keyName     name of the Agent key to mint
 * @param {number} opts.index       1-based account index (for logs/labels)
 * @param {function} opts.log
 * @param {MailTM} opts.mail
 * @param {boolean} opts.verify     run a 1-shot prompt to verify the key
 * @returns {Promise<object>} account record
 */
async function provisionAccount(cdp, opts = {}) {
  const { keyName = 'sorin-bulk', index = 1, log = () => {}, verify = true } = opts;
  const mail = opts.mail || new MailTM();

  const started = Date.now();
  let browserContextId = null;
  let targetId = null;
  const record = {
    index,
    status: 'error',
    keyName,
    createdAt: new Date().toISOString(),
  };

  try {
    log('creating disposable inbox');
    const inbox = await mail.createAccount();
    record.email = inbox.address;
    record.emailPassword = inbox.password;

    // Isolate cookies/localStorage per account.
    browserContextId = await cdp.createBrowserContext();
    const { targetId: tid, sessionId } = await cdp.newPage({ browserContextId, url: 'about:blank' });
    targetId = tid;
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId).catch(() => {});

    const browser = new SorinBrowser(cdp, { sessionId, log });

    const { jwt } = await browser.login({
      email: inbox.address,
      log,
      getCode: async () => {
        // The newest mail is either a 6-digit login code or a device-approval
        // link. New device => open the approval link in the SAME context so the
        // device gets recognised, then request the code again.
        for (let attempt = 0; attempt < 4; attempt++) {
          const msgs = await mail.messages();
          const newest = msgs[0];
          if (!newest) {
            await sleep(4000);
            continue;
          }
          const full = await mail.message(newest.id);
          const text = `${full.text || ''}`;
          const approve = text.match(/https:\/\/register\.walletconnect\.com\S+/);
          if (approve) {
            log('approving new device');
            await browser.goto(approve[0], { waitMs: 2500 });
            await clickApprove(browser);
            await sleep(1500);
            // Go back and re-request a code.
            await browser.goto('https://heysorin.ai', { waitMs: 5000 });
            await browser.submitEmail(inbox.address);
            await browser.waitForText('Confirm Email', { timeoutMs: 60000 });
            continue;
          }
          const code = text.match(/\b(\d{6})\b/);
          if (code) return code[1];
          await sleep(3000);
        }
        throw new Error('no login code or approval link received');
      },
    });

    if (!jwt) throw new Error('could not capture session JWT');

    log('minting Agent API key');
    const created = await createAgentKey(jwt, keyName);
    const info = created.api_key_info || {};
    record.apiKey = created.api_key;
    record.apiKeyId = info.id;
    record.keyPreview = info.key_preview;
    record.jwt = jwt;

    if (verify) {
      log('verifying key');
      const t = await testAgentKey(record.apiKey);
      record.verified = !!t.ok;
      record.verifyContent = t.content || null;
      record.credits = t.usage && t.usage.charged_credits;
    }

    record.status = 'ok';
    record.elapsedMs = Date.now() - started;
    return record;
  } catch (e) {
    record.error = e.message;
    record.elapsedMs = Date.now() - started;
    return record;
  } finally {
    if (targetId) await cdp.closePage(targetId).catch(() => {});
    if (browserContextId) await cdp.disposeBrowserContext(browserContextId).catch(() => {});
  }
}

/** The device-approval page's "Approve" button needs a real mouse click. */
async function clickApprove(browser) {
  const rect = await browser.eval(`(() => {
    const b = [...document.querySelectorAll('button')].find(e => /^approve$/i.test((e.innerText||'').trim()));
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  if (!rect) return false;
  await browser.cdp.send(
    'Input.dispatchMouseEvent',
    { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 },
    browser.sessionId
  );
  await browser.cdp.send(
    'Input.dispatchMouseEvent',
    { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 },
    browser.sessionId
  );
  return true;
}

module.exports = { provisionAccount };
