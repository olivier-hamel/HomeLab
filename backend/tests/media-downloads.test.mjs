import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { MediaDownloads, downloadIntent } from '../src/lib/media/downloads.ts';
import { createMediaApi } from '../src/lib/media/api.ts';
import { FFmpeg } from '../src/lib/media/ffmpeg.ts';
import { inspectPlayback, choosePlayback } from '../src/lib/media/playback-plan.ts';
import { accountSession } from './fixtures/accounts.mjs';

const hash = 'b'.repeat(40);
const file = { id: 2, path: '../Show.S01E02.mp4', size: 10, kind: 'video', sample: false };
const intent = downloadIntent({ query: 'Show S01E02', media: { id: 55, kind: 'tv', title: 'Show', year: '2026', poster: 'https://image.tmdb.org/t/p/w500/show.jpg' }, context: { kind: 'tv', tmdbId: 55, season: 1, episode: 2 } }, file.path);
const waitFor = async (store, id, state) => {
  for (let attempt = 0; attempt < 300; attempt++) {
    const row = store.list('oli').find(row => row.id === id);
    if (row?.state === state) return row;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail(`Download did not enter ${state}: ${JSON.stringify(store.list('oli'))}`);
};
async function fixture(t, stream) {
  const root = await mkdtemp(join(tmpdir(), 'homelab-media-downloads-'));
  process.env.MEDIA_DOWNLOAD_RESERVE_MIB = '0';
  const store = new MediaDownloads({ stream }, root);
  t.after(async () => { await store.close(); await rm(root, { recursive: true, force: true }); });
  return { store, root };
}
const complete = async () => new Response('abcdefghij', { headers: { 'Content-Length': '10' } });

test('downloads are durable, account-scoped, deduplicated and seekable without TorrServer', async t => {
  let calls = 0;
  const { store, root } = await fixture(t, async () => { calls++; return complete(); });
  const row = await store.enqueue('oli', hash, file, intent);
  await waitFor(store, row.id, 'ready');
  assert.equal((await store.enqueue('oli', hash, file, intent)).id, row.id);
  assert.equal(calls, 1);
  assert.deepEqual(store.list('max'), []);
  assert.throws(() => store.get('max', row.id), /disponible/);
  assert.equal(JSON.stringify(store.list('oli')).includes(hash), false);
  assert.deepEqual(await readdir(join(root, 'files')), [row.id], 'untrusted torrent paths never become filesystem paths');
  await store.close();
  const restored = new MediaDownloads({ stream() { assert.fail('ready playback must never reach TorrServer'); } }, root);
  t.after(() => restored.close());
  const status = restored.status('oli', row.id);
  assert.equal(status.downloaded, true);
  const local = async (headers = {}, method = 'GET') => restored.stream(status.hash, file, new Request('http://dashboard.test/video', { headers, method }));
  assert.equal(await (await local()).text(), 'abcdefghij');
  let response = await local({ Range: 'bytes=2-5' });
  assert.equal(response.status, 206); assert.equal(response.headers.get('content-range'), 'bytes 2-5/10'); assert.equal(await response.text(), 'cdef');
  response = await local({ Range: 'bytes=-3' }); assert.equal(await response.text(), 'hij');
  response = await local({ Range: 'bytes=8-999' }); assert.equal(await response.text(), 'ij');
  for (const Range of ['bytes=20-', 'bytes=5-2', 'bytes=-0', 'bytes=0-1,3-4', 'garbage', 'bytes=999999999999999999999-']) {
    response = await local({ Range }); assert.equal(response.status, 416); assert.equal(response.headers.get('content-range'), 'bytes */10'); assert.equal(await response.text(), '');
  }
  response = await local({ Range: 'bytes=3-5', 'If-Range': '"stale"' }); assert.equal(response.status, 200); assert.equal(await response.text(), 'abcdefghij');
  response = await local({ Range: 'bytes=2-5' }, 'HEAD'); assert.equal(response.status, 206); assert.equal(response.headers.get('content-length'), '4'); assert.equal(await response.text(), '');
  await restored.remove('oli', row.id);
  assert.deepEqual(restored.list('oli'), []); assert.deepEqual(await readdir(join(root, 'files')), []);
  await assert.rejects(() => local(), /disponible/);
});

test('truncated transfers stay unplayable and retry resumes from actual bytes on disk', async t => {
  const ranges = [];
  const { store, root } = await fixture(t, async (_hash, _file, request) => {
    const range = request.headers.get('range'); ranges.push(range);
    return range ? new Response('efghij', { status: 206, headers: { 'Content-Range': 'bytes 4-9/10' } }) : new Response('abcd');
  });
  const row = await store.enqueue('oli', hash, file, intent);
  await waitFor(store, row.id, 'error');
  assert.throws(() => store.status('oli', row.id), /pas encore prêt/);
  assert.equal((await readFile(join(root, 'files', `${row.id}.part`))).toString(), 'abcd');
  store.retry('oli', row.id); await waitFor(store, row.id, 'ready');
  assert.deepEqual(ranges, [null, 'bytes=4-']);
  assert.equal((await readFile(join(root, 'files', row.id))).toString(), 'abcdefghij');
});

test('an upstream ignoring resume ranges restarts safely and invalid ranges never commit a ready file', async t => {
  let count = 0;
  const { store, root } = await fixture(t, async () => {
    count++;
    if (count === 1) return new Response('abcd');
    if (count === 2) return new Response('incorrect', { status: 206, headers: { 'Content-Range': 'bytes 0-8/10' } });
    return complete();
  });
  const row = await store.enqueue('oli', hash, file, intent); await waitFor(store, row.id, 'error');
  store.retry('oli', row.id); await waitFor(store, row.id, 'error');
  assert.equal((await readFile(join(root, 'files', `${row.id}.part`))).toString(), 'abcd');
  store.retry('oli', row.id); await waitFor(store, row.id, 'ready');
  assert.equal((await readFile(join(root, 'files', row.id))).toString(), 'abcdefghij');
});

test('active deletion cancels the transfer and removes partial bytes; another worker respects the lease', async t => {
  let calls = 0, cancelled = false;
  const { store, root } = await fixture(t, async (_hash, _file, request) => {
    calls++;
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('abc'));
        request.signal.addEventListener('abort', () => { cancelled = true; controller.error(new Error('abort')); }, { once: true });
      },
    }));
  });
  const first = await store.enqueue('oli', hash, file, intent);
  await waitFor(store, first.id, 'downloading');
  for (let i = 0; i < 100 && !calls; i++) await new Promise(resolve => setTimeout(resolve, 10));
  const secondWorker = new MediaDownloads({ stream() { assert.fail('another worker already holds a download lease'); } }, root);
  secondWorker.start();
  await new Promise(resolve => setTimeout(resolve, 30));
  await secondWorker.close();
  await store.remove('oli', first.id);
  assert.equal(cancelled, true); assert.deepEqual(store.list('oli'), []); assert.deepEqual(await readdir(join(root, 'files')), []);
});

test('expired worker leases and rename-before-crash recovery preserve completed downloads', async t => {
  let calls = 0;
  const { store, root } = await fixture(t, async () => { calls++; return complete(); });
  const row = await store.enqueue('oli', hash, file, intent); await waitFor(store, row.id, 'ready'); await store.close();
  const db = new DatabaseSync(join(root, 'downloads.sqlite'));
  db.prepare("UPDATE downloads SET state = 'downloading', lease = 1, token = 'dead-worker' WHERE id = ?").run(row.id); db.close();
  const recovered = new MediaDownloads({ stream() { assert.fail('the complete local file already exists'); } }, root);
  t.after(() => recovered.close()); recovered.start();
  await waitFor(recovered, row.id, 'ready'); assert.equal(calls, 1);
});

test('invalid files and mismatched catalogue metadata cannot enter the queue', async t => {
  const { store } = await fixture(t, complete);
  for (const changes of [{ kind: 'subtitle' }, { size: null }, { size: 0 }, { size: -1 }]) await assert.rejects(() => store.enqueue('oli', hash, { ...file, ...changes }, intent));
  assert.throws(() => downloadIntent({ media: { id: 1, kind: 'movie' }, context: { tmdbId: 2, kind: 'movie' } }, 'film'), /correspondent/);
  assert.throws(() => store.get('oli', '../../secret'));
  const fromPack = downloadIntent({ query: 'Show S01', media: intent.media, context: { kind: 'tv', tmdbId: 55, season: 1 } }, 'Show_S02E03.mp4');
  assert.equal(fromPack.context.season, 2); assert.equal(fromPack.context.episode, 3); assert.equal(fromPack.label, 'Show S02E03');
});

test('disk capacity is checked before starting the transfer and the failure remains manageable', async t => {
  const { store } = await fixture(t, () => { assert.fail('insufficient space must prevent torrent reading'); });
  const row = await store.enqueue('oli', hash, { ...file, size: Number.MAX_SAFE_INTEGER }, intent);
  const failed = await waitFor(store, row.id, 'error'); assert.match(failed.error, /Espace disque insuffisant/);
  await store.remove('oli', row.id); assert.deepEqual(store.list('oli'), []);
});

test('real FFmpeg probes and remuxes downloaded MKV bytes without torrent access', { skip: process.env.MEDIA_FFMPEG_TESTS !== '1' }, async t => {
  const execute = promisify(execFile);
  const { store, root } = await fixture(t, async () => new Response(await readFile(join(root, 'fixture.mkv'))));
  await execute(process.env.FFMPEG_PATH || 'ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=12', '-t', '2', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', join(root, 'fixture.mkv')]);
  const source = await readFile(join(root, 'fixture.mkv'));
  const localFile = { ...file, path: 'fixture.mkv', size: source.length };
  const row = await store.enqueue('oli', hash, localFile, intent); await waitFor(store, row.id, 'ready');
  const converter = new FFmpeg(store), signal = AbortSignal.timeout(15000);
  const local = store.status('oli', row.id).hash;
  const probe = await converter.probe(local, localFile, signal);
  const inspection = inspectPlayback(probe);
  const option = choosePlayback(inspection, inspection.options.filter(option => option.container === 'mp4').map(option => option.id));
  assert.equal(option.mode, 'remux'); assert.equal(option.video, 'copy');
  const response = await converter.stream(local, localFile, probe, option, new Request('http://localhost/converted', { signal }), 0);
  const converted = Buffer.from(await response.arrayBuffer());
  assert(converted.length > 1000); assert.equal(converted.toString('ascii', 4, 8), 'ftyp');
});

test('authenticated API queues a selected file, persists its source, then plays locally after a new session', async t => {
  Object.assign(process.env, { MEDIA_TRUSTED_NETWORK: 'true', MEDIA_ALLOWED_ORIGINS: 'http://downloads.test', MEDIA_SESSION_SECRET: 'download-test-secret-with-at-least-32-characters', TORRSERVER_BASE_URL: 'http://torrserver.test' });
  const persisted = [];
  const status = { hash, title: 'Show', stat: 3, file_stats: [{ id: file.id, path: file.path, length: file.size }] };
  const upstream = async (_url, init) => { const body = JSON.parse(init.body); if (body.action === 'add') persisted.push(body.save_to_db); return Response.json(status); };
  const { store } = await fixture(t, complete);
  let account = accountSession;
  const api = createMediaApi(upstream, { probe() { throw new Error('unused'); }, stream() { throw new Error('unused'); } }, async () => account, store);
  let cookie = (await api(new Request('http://downloads.test/api/media/status'))).headers.get('set-cookie').split(';')[0];
  const call = (path, body, extra = {}) => api(new Request(`http://downloads.test/api/media/${path}`, { ...extra, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}), headers: { Cookie: cookie, Origin: 'http://downloads.test', ...(body ? { 'X-Media-Request': '1', 'Content-Type': 'application/json' } : {}), ...extra.headers } }));
  let response = await call('downloads', { id: 'unknown' }); assert.equal(response.status, 410);
  const torrent = await (await call('playback', { magnet: `magnet:?xt=urn:btih:${hash}` })).json();
  const selected = await (await call('select', { id: torrent.id, fileId: file.id })).json();
  response = await call('downloads', { id: selected.id, intent }); assert.equal(response.status, 202);
  const row = (await response.json()).download;
  await waitFor(store, row.id, 'ready'); assert.deepEqual(persisted, [false, true]);
  cookie = (await api(new Request('http://downloads.test/api/media/status'))).headers.get('set-cookie').split(';')[0];
  const local = await (await call('downloads/playback', { downloadId: row.id })).json();
  assert.equal(local.downloaded, true); assert.equal(local.hash, undefined);
  response = await call(`stream/${local.id}`, undefined, { headers: { Range: 'bytes=1-3' } }); assert.equal(response.status, 206); assert.equal(await response.text(), 'bcd');
  account = { ...accountSession, user: { ...accountSession.user, username: 'max' } };
  assert.deepEqual((await (await call('downloads')).json()).downloads, []);
  assert.equal((await call('downloads/remove', { downloadId: row.id })).status, 404);
  account = accountSession;
  assert.equal((await call('downloads/remove', { downloadId: row.id })).status, 200);
  assert.equal((await call(`stream/${local.id}`)).status, 404);
});
