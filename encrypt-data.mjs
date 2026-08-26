#!/usr/bin/env node
/**
 * encrypt-data.mjs
 *
 * Encrypts data/*.json into data/*.enc so the published site carries only
 * ciphertext. Run it after build-log.mjs:
 *
 *   node build-log.mjs
 *   IRONMAN_PASSPHRASE=... node encrypt-data.mjs
 *
 * Why this exists: this repo is public and GitHub Pages serves data/ directly,
 * so before this, anyone could fetch data/days.json and read every night of
 * sleep, HRV and resting HR without ever loading the page. A JavaScript
 * password prompt does not fix that - it only hides the front door while the
 * side door stays open. Encrypting the payload closes the side door: a direct
 * fetch now returns bytes that are useless without the passphrase.
 *
 * The passphrase is NEVER written to this repo. It comes from the environment
 * here, and from the visitor's keyboard in the browser.
 *
 * Crypto: PBKDF2-SHA256 -> AES-256-GCM. Parameters must stay in lockstep with
 * assets/crypto-gate.js; both read them from the header of the .enc file, so
 * changing ITERATIONS here does not break already-published files.
 *
 * A NOTE ON STRENGTH, because it decides whether this is worth anything:
 * PBKDF2 makes each guess expensive, not impossible. A short numeric PIN is
 * still brute-forceable offline once someone has the ciphertext - 5 digits is
 * only 100,000 guesses. The iteration count below buys time, not safety. If
 * this data actually matters, use a passphrase of several words.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { webcrypto as crypto } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const ITERATIONS = 600000; // OWASP guidance for PBKDF2-SHA256
const FILES = ['days', 'workouts'];

const passphrase = process.env.IRONMAN_PASSPHRASE;
if (!passphrase) {
  console.error('Set IRONMAN_PASSPHRASE. It is deliberately not stored in this repo.');
  process.exit(2);
}

const enc = new TextEncoder();

async function deriveKey(pass, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );
}

const b64 = (buf) => Buffer.from(buf).toString('base64');

let wrote = 0;
for (const name of FILES) {
  const src = join(__dirname, 'data', `${name}.json`);
  if (!existsSync(src)) {
    console.error(`missing ${src} - run build-log.mjs first`);
    process.exit(1);
  }
  const plaintext = readFileSync(src);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, ITERATIONS);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);

  // Self-describing envelope: the reader takes the KDF parameters from here
  // rather than hardcoding them, so these can be raised later without
  // stranding files that were encrypted under the old settings.
  const envelope = {
    v: 1,
    kdf: 'PBKDF2-SHA256',
    iterations: ITERATIONS,
    cipher: 'AES-GCM',
    salt: b64(salt),
    iv: b64(iv),
    ct: b64(new Uint8Array(ct)),
  };
  const out = join(__dirname, 'data', `${name}.enc`);
  writeFileSync(out, JSON.stringify(envelope));
  console.log(`encrypted data/${name}.json -> data/${name}.enc  (${(plaintext.length / 1024).toFixed(1)}K -> ${(JSON.stringify(envelope).length / 1024).toFixed(1)}K)`);
  wrote++;
}

console.log(`\n${wrote} file(s) encrypted. Commit the .enc files; the .json files are gitignored.`);
