import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isPrivateLanCidr, lanAccess } from '../dist/access.js';
import { loadConfig } from '../dist/config.js';

test('accès LAN : plages privées précises, IPv6 et adresses IPv4 mappées', () => {
  for (const cidr of ['192.168.50.0/24', '10.10.0.0/16', '172.20.0.0/16', 'fd12:3456::/64']) assert.equal(isPrivateLanCidr(cidr), true, cidr);
  for (const cidr of ['0.0.0.0/0', '192.168.0.0/8', '172.16.0.0/8', '8.8.8.0/24', '::/0', 'fc00::/6', 'fd12::/129', '192.168.1.0/33', 'not-a-cidr']) assert.equal(isPrivateLanCidr(cidr), false, cidr);
  const allowed = lanAccess(['192.168.50.0/24', 'fd12:3456::/64']);
  for (const ip of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '192.168.50.42', '::ffff:192.168.50.42', 'fd12:3456::42']) assert.equal(allowed(ip), true, ip);
  for (const ip of ['192.168.51.42', '203.0.113.10', 'fd12:3457::42']) assert.equal(allowed(ip), false, ip);
});

test('configuration : défaut local, sous-réseau obligatoire pour le LAN, aucun joker ni origine ambiguë', t => {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-config-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const load = environment => loadConfig({ BRIDGE_DATA_DIR: dir, ...environment });
  assert.equal(load({}).host, '127.0.0.1');
  assert.deepEqual(load({}).lanCidrs, []);
  assert.throws(() => load({ BRIDGE_HOST: '0.0.0.0' }), /BRIDGE_LAN_CIDRS/);
  assert.throws(() => load({ BRIDGE_LAN_CIDRS: '0.0.0.0/0' }));
  assert.throws(() => load({ BRIDGE_ALLOWED_HOSTS: '*' }));
  assert.throws(() => load({ BRIDGE_ALLOWED_HOSTS: 'bridge.local:3211' }));
  for (const origin of ['*', 'null', 'http://app.local/', 'http://app.local/path', 'http://user:pass@app.local', 'http://app.local?x=y']) assert.throws(() => load({ BRIDGE_ALLOWED_ORIGINS: origin }), origin);
  const config = load({ BRIDGE_HOST: '0.0.0.0', BRIDGE_LAN_CIDRS: '192.168.50.0/24', BRIDGE_ALLOWED_HOSTS: '192.168.50.10,Bridge.local' });
  assert.ok(config.allowedHosts.includes('192.168.50.10'));
  assert.ok(config.allowedHosts.includes('bridge.local'));
});
