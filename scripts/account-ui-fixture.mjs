import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { request } from 'node:https';
import { resolve } from 'node:path';

export const fixtureAccount = { enabled: true, user: { username: 'oli', display_name: 'Oli', must_change_password: false }, accounts: [{ username: 'oli', display_name: 'Oli' }, { username: 'max', display_name: 'Max' }] };
export const fixtureCookie = `memo_session=${'t'.repeat(43)}; HttpOnly; Secure; SameSite=Strict; Path=/`;

export function fixtureTls(directory) {
  const keyPath = process.env.TV_TEST_KEY || resolve(directory, 'https-fixture.key');
  const certPath = process.env.TV_TEST_CERT || resolve(directory, 'https-fixture.crt');
  if (!existsSync(keyPath) || !existsSync(certPath)) {
    execFileSync(process.env.OPENSSL_BIN || 'openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '30', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1', '-keyout', keyPath, '-out', certPath], { stdio: 'ignore', windowsHide: true });
  }
  return { keyPath, certPath, key: readFileSync(keyPath), cert: readFileSync(certPath) };
}

// Trust only this test certificate, without disabling TLS verification globally.
export function fetchFixtureHttps(url, init, tls) {
  return new Promise((resolve, reject) => {
    const outgoing = request(url, { ...init, ca: tls.cert }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => resolve(new Response(init?.method === 'HEAD' ? null : Buffer.concat(chunks), {
        status: response.statusCode,
        headers: Object.fromEntries(Object.entries(response.headers).filter(([, value]) => value !== undefined).map(([name, value]) => [name, Array.isArray(value) ? value.join(', ') : value])),
      })));
    });
    outgoing.on('error', reject);
    outgoing.end();
  });
}
