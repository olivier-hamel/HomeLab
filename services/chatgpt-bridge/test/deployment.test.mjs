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
  for (const file of ['install-ubuntu.sh','install-from-git.sh','prepare-git.sh','deploy-git.sh','backup.sh','chatgpt-bridge']) {
    const syntax = spawnSync('bash', ['-n', join(projectDir, 'deployment', file)], { encoding: 'utf8' });
    assert.equal(syntax.status, 0, syntax.stderr);
  }
  const plan = spawnSync('bash', [join(projectDir, 'deployment/install-ubuntu.sh'), '--dry-run'], { encoding: 'utf8' });
  assert.equal(plan.status, 0, plan.stderr);
  assert.match(plan.stdout, /sans modification ni accès réseau/);
  assert.match(plan.stdout, /aucune question/);
});

test('déploiement Git : commit exact, reprise du dépôt, historique réécrit et aucun fichier privé', t => {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-git-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const source = join(dir, 'source'), repository = join(dir, 'server.git'), bundle = join(dir, 'source.bundle');
  mkdirSync(source);
  const git = (...args) => {
    const result = spawnSync('git', ['-C', source, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git('init', '--initial-branch=main'); git('config', 'user.name', 'Deployment test'); git('config', 'user.email', 'test@example.invalid');
  writeFileSync(join(source, '.gitignore'), '.local-data/\n.env\n');
  writeFileSync(join(source, 'version.txt'), 'old revision');
  git('add', '.'); git('commit', '-m', 'First');
  const first = git('rev-parse', 'HEAD');
  writeFileSync(join(source, 'version.txt'), 'new revision'); git('commit', '-am', 'Second');
  const second = git('rev-parse', 'HEAD');
  writeFileSync(join(source, '.env'), 'PRIVATE=not-transferred');
  mkdirSync(join(source, '.local-data')); writeFileSync(join(source, '.local-data/profile'), 'not-transferred');
  git('bundle', 'create', bundle, '--branches');
  const prepare = (commit, checkout) => spawnSync('bash', [join(projectDir, 'deployment/prepare-git.sh'), repository, bundle, commit, checkout], { encoding: 'utf8' });
  const oldCheckout = join(dir, 'old');
  assert.equal(prepare(first, oldCheckout).status, 0);
  assert.equal(readFileSync(join(oldCheckout, 'version.txt'), 'utf8'), 'old revision');
  assert.equal(existsSync(join(oldCheckout, '.env')), false);
  assert.equal(existsSync(join(oldCheckout, '.local-data')), false);
  const currentCheckout = join(dir, 'current');
  assert.equal(prepare(second, currentCheckout).status, 0);
  assert.equal(readFileSync(join(currentCheckout, 'version.txt'), 'utf8'), 'new revision');
  const unavailable = join(dir, 'unavailable');
  assert.notEqual(prepare('f'.repeat(40), unavailable).status, 0);
  assert.equal(existsSync(unavailable), false);
  // An amended/reworded branch is a valid new Git deployment, without publishing
  // or force-pushing any source repository. Old release worktrees stay intact.
  git('commit', '--amend', '-m', 'Renamed second');
  const amended = git('rev-parse', 'HEAD');
  git('bundle', 'create', bundle, '--branches');
  assert.equal(prepare(amended, join(dir, 'amended')).status, 0);
  assert.equal(readFileSync(join(oldCheckout, 'version.txt'), 'utf8'), 'old revision');
});

test('déploiement Git : aperçu sans SSH, source autonome et refus des fichiers non committés', t => {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-git-dry-run-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const source = join(dir, 'source'); mkdirSync(source); mkdirSync(join(source, 'deployment'));
  for (const file of ['deploy-git.sh', 'install-from-git.sh']) writeFileSync(join(source, 'deployment', file), readFileSync(join(projectDir, 'deployment', file)));
  const git = (...args) => {
    const result = spawnSync('git', ['-C', source, ...args], { encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
  };
  git('init', '--initial-branch=main'); git('config', 'user.name', 'Deployment test'); git('config', 'user.email', 'test@example.invalid');
  git('add', '.'); git('commit', '-m', 'Deployment fixture');
  const script = join(source, 'deployment/deploy-git.sh');
  const preview = spawnSync('bash', [script, '--dry-run', 'agent@vm.example'], { encoding: 'utf8' });
  assert.equal(preview.status, 0, preview.stderr);
  assert.match(preview.stdout, new RegExp(git('rev-parse', 'HEAD')));
  assert.match(preview.stdout, /No changes or network access/);
  const receiver = spawnSync('bash', [join(source, 'deployment/install-from-git.sh'), '--dry-run', '--bundle', script, '--commit', git('rev-parse', 'HEAD'), '--source-path', '.'], { encoding: 'utf8' });
  assert.equal(receiver.status, 0, receiver.stderr);
  writeFileSync(join(source, 'deployment/uncommitted.sh'), 'must not deploy');
  assert.notEqual(spawnSync('bash', [script, '--dry-run', 'agent@vm.example'], { encoding: 'utf8' }).status, 0);
  assert.notEqual(spawnSync('bash', [script, '--dry-run', '-oProxyCommand=unsafe'], { encoding: 'utf8' }).status, 0);
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
