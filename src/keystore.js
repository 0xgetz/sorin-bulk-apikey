'use strict';

/**
 * Tiny JSON keystore for minted Sorin accounts. Keeps a single file with an
 * `accounts` array and helpers to add / read / export.
 */

const fs = require('fs');
const path = require('path');

class Keystore {
  constructor(file) {
    this.file = file || 'outputs/sorin-accounts.json';
    this.data = { generated_at: null, accounts: [] };
  }

  load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) this.data = { generated_at: null, accounts: parsed };
      else this.data = { generated_at: parsed.generated_at || null, accounts: parsed.accounts || [] };
    } catch {
      /* fresh store */
    }
    return this;
  }

  add(account) {
    this.data.accounts.push(account);
    return this;
  }

  save() {
    this.data.generated_at = new Date().toISOString();
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    return this.file;
  }

  ok() {
    return this.data.accounts.filter((a) => a.status === 'ok' && a.apiKey);
  }

  toCsv() {
    const cols = ['status', 'email', 'emailPassword', 'apiKey', 'keyName', 'keyPreview', 'verified', 'credits', 'error'];
    const esc = (v) => (v === undefined || v === null ? '' : `"${String(v).replace(/"/g, '""')}"`);
    return [cols.join(','), ...this.data.accounts.map((a) => cols.map((c) => esc(a[c])).join(','))].join('\n');
  }
}

module.exports = { Keystore };
