import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { packageServer, rootFiles } from '../scripts/package-server.mjs';
import { loadConfig, projectDir } from '../dist/config.js';
import { Desktop } from '../dist/desktop.js';

test('archive serveur : code et déploiement inclus, données privées et dépendances exclues', t => {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-package-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const source = join(dir, 'source'); mkdirSync(source);
  for (const file of rootFiles) writeFileSync(join(source, file), file === 'package.json' ? JSON.stringify({ name: 'chatgpt-plus-bridge', version: '0.1.0' }) : 'source\n');
  for (const name of ['src','scripts','test','deployment','.local-data','node_modules','dist']) mkdirSync(join(source, name));
  writeFileSync(join(source, 'src/main.ts'), 'export {};');
  writeFileSync(join(source, 'deployment/chatgpt-bridge.service'), '[Unit]\nDescription=Bridge');
  writeFileSync(join(source, 'deployment/bridge.env'), 'BRIDGE_PORT=3211');
  writeFileSync(join(source, '.env'), 'SECRET=must-not-leave');
  writeFileSync(join(source, 'SSH.local.md'), 'Private connection details must-not-leave');
  writeFileSync(join(source, '.local-data/api-token'), 'must-not-leave');
  writeFileSync(join(source, 'node_modules/private.js'), 'must-not-leave');
  writeFileSync(join(source, 'dist/private.js'), 'must-not-leave');
  const output = join(dir, 'handoff.tar.gz');
  packageServer(source, output);
  const listing = spawnSync('tar', ['-tzf', output], { encoding: 'utf8' });
  assert.equal(listing.status, 0);
  assert.match(listing.stdout, /deployment\/bridge.env/); assert.match(listing.stdout, /src\/main.ts/);
  assert.doesNotMatch(listing.stdout, /(^|\n)(\.env\n|SSH\.local\.md\n|\.local-data|node_modules|dist)/);
  assert.ok(existsSync(output + '.sha256'));
  symlinkSync(join(source, '.local-data/api-token'), join(source, 'src/leak.ts'));
  assert.throws(() => packageServer(source, output), /Lien symbolique interdit/);
});

test('installateur : syntaxe et aperçu sans root, sans réseau ni mutation', () => {
  for (const file of ['install-ubuntu.sh','backup.sh','chatgpt-bridge']) {
    const syntax = spawnSync('bash', ['-n', join(projectDir, 'deployment', file)], { encoding: 'utf8' });
    assert.equal(syntax.status, 0, syntax.stderr);
  }
  const plan = spawnSync('bash', [join(projectDir, 'deployment/install-ubuntu.sh'), '--dry-run'], { encoding: 'utf8' });
  assert.equal(plan.status, 0, plan.stderr);
  assert.match(plan.stdout, /sans modification ni accès réseau/);
  assert.match(plan.stdout, /aucune question/);
});

test('chemins serveur : Chromium hors du code, données séparées et valeurs locales conservées', t => {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-paths-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const environment = parseEnv(readFileSync(join(projectDir, 'deployment/bridge.env'), 'utf8'));
  assert.equal(environment.BRIDGE_DATA_DIR, '/var/lib/chatgpt-bridge');
  const config = loadConfig({ ...environment, BRIDGE_DATA_DIR: dir });
  const desktop = new Desktop(config, {});
  assert.equal(desktop.environment().PLAYWRIGHT_BROWSERS_PATH, '/var/cache/chatgpt-bridge/browsers');
  const local = loadConfig({ BRIDGE_DATA_DIR: dir });
  assert.equal(local.browsersDir, join(projectDir, '.local-data/browsers'));
});
