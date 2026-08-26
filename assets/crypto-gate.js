/**
 * assets/crypto-gate.js
 *
 * Passphrase gate for the site, and the only way the chart data gets loaded.
 *
 * The data files published alongside this page are AES-GCM ciphertext (see
 * encrypt-data.mjs). Nothing here can reveal them without the passphrase, and
 * the passphrase is not in this repo - it is typed by the visitor and lives
 * only in memory for the life of the page.
 *
 * That distinction is the whole point. A gate that merely hides the page still
 * leaves data/days.json fetchable by URL; this one leaves an attacker with
 * ciphertext whether they load the page or not.
 *
 * Exposes:  window.IronmanData.ready -> Promise<{workouts, days}>
 *
 * Session behaviour: a successful passphrase is held in sessionStorage so a
 * reload during the same tab session does not re-prompt. Closing the tab
 * clears it. Wrapped in try/catch because a private window can throw on
 * access rather than simply returning null.
 */
(function () {
  'use strict';

  const FILES = { workouts: 'data/workouts.enc', days: 'data/days.enc' };
  const SESSION_KEY = 'ironman.pass';

  let resolveReady, rejectReady;
  const ready = new Promise((res, rej) => { resolveReady = res; rejectReady = rej; });
  window.IronmanData = { ready };

  const dec = new TextDecoder();
  const enc = new TextEncoder();
  const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  async function deriveKey(pass, salt, iterations) {
    const base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );
  }

  async function decryptFile(url, pass) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
    const env = await res.json();
    const key = await deriveKey(pass, fromB64(env.salt), env.iterations);
    // A wrong passphrase fails here as an authentication-tag mismatch, which
    // is exactly what we want: GCM refuses to hand back garbage.
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64(env.iv) },
      key,
      fromB64(env.ct)
    );
    return JSON.parse(dec.decode(plain));
  }

  async function unlock(pass) {
    const [workouts, days] = await Promise.all([
      decryptFile(FILES.workouts, pass),
      decryptFile(FILES.days, pass),
    ]);
    return { workouts, days };
  }

  function readSession() {
    try { return sessionStorage.getItem(SESSION_KEY); } catch { return null; }
  }
  function writeSession(v) {
    try { sessionStorage.setItem(SESSION_KEY, v); } catch { /* private window */ }
  }
  function clearSession() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* private window */ }
  }

  function buildOverlay() {
    const el = document.createElement('div');
    el.id = 'gate';
    el.innerHTML = [
      '<div class="gate-card">',
      '  <div class="gate-title">Ironman 70.3 Long Beach</div>',
      '  <div class="gate-sub">Training log &mdash; enter passphrase</div>',
      '  <form id="gate-form" autocomplete="off">',
      '    <input id="gate-input" type="password" inputmode="numeric" autocomplete="current-password"',
      '           aria-label="Passphrase" placeholder="Passphrase" />',
      '    <button id="gate-go" type="submit">Unlock</button>',
      '  </form>',
      '  <div class="gate-msg" id="gate-msg" role="status" aria-live="polite"></div>',
      '</div>',
    ].join('\n');
    document.body.appendChild(el);
    return el;
  }

  function start() {
    const app = document.getElementById('app');
    if (app) app.style.visibility = 'hidden';

    const overlay = buildOverlay();
    const form = overlay.querySelector('#gate-form');
    const input = overlay.querySelector('#gate-input');
    const btn = overlay.querySelector('#gate-go');
    const msg = overlay.querySelector('#gate-msg');

    const succeed = (data) => {
      overlay.remove();
      if (app) app.style.visibility = '';
      resolveReady(data);
    };

    const attempt = async (pass, fromSession) => {
      btn.disabled = true;
      // Key derivation is deliberately slow, so say so rather than looking hung.
      msg.textContent = 'Decrypting…';
      msg.className = 'gate-msg';
      try {
        const data = await unlock(pass);
        writeSession(pass);
        succeed(data);
      } catch (err) {
        clearSession();
        btn.disabled = false;
        if (fromSession) { msg.textContent = ''; return; }
        // Any failure lands here: a wrong passphrase and a missing file are
        // not distinguished on purpose.
        msg.textContent = 'Incorrect passphrase.';
        msg.className = 'gate-msg gate-err';
        input.value = '';
        input.focus();
      }
    };

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = input.value.trim();
      if (v) attempt(v, false);
    });

    const cached = readSession();
    if (cached) attempt(cached, true);
    input.focus();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
