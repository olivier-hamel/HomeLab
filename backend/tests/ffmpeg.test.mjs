// Opt in with MEDIA_FFMPEG_TESTS=1; requires ffmpeg and ffprobe on PATH or the
// configured FFMPEG_PATH / FFPROBE_PATH. All clips are generated locally.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { FFmpeg } from '../src/lib/media/ffmpeg.ts';
import { TorrServer } from '../src/lib/media/torrserver.ts';
import { choosePlayback, inspectPlayback } from '../src/lib/media/playback-plan.ts';

const execute = promisify(execFile);
const enabled = process.env.MEDIA_FFMPEG_TESTS === '1';
const binary = process.env.FFMPEG_PATH || 'ffmpeg';
const prober = process.env.FFPROBE_PATH || 'ffprobe';
const command = (bin, args) => execute(bin, args, { windowsHide: true, maxBuffer: 4 * 1024 * 1024 });

test('real FFmpeg: probe, copy-preserving remux, selective codecs, seek, failure and cancellation', { skip: !enabled, timeout: 120_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'homelab-ffmpeg-'));
  const hash = 'e'.repeat(40), files = new Map(), requests = [];
  let slow = false, cancelled = 0;
  Object.assign(process.env, { TORRSERVER_BASE_URL: 'http://fixture.test', TORRSERVER_USERNAME: 'fixture', TORRSERVER_PASSWORD: 'ffmpeg-test-private-canary', MEDIA_MAX_CONVERSIONS: '1' });
  const torrents = new TorrServer(async (url, init) => {
    const headers = new Headers(init.headers);
    assert.match(headers.get('authorization'), /^Basic /);
    const bytes = files.get(Number(new URL(url).searchParams.get('index')));
    const range = /^bytes=(\d+)-(\d*)$/.exec(headers.get('range') ?? '');
    const start = range ? Number(range[1]) : 0, end = range?.[2] ? Number(range[2]) : bytes.length - 1;
    requests.push({ range: headers.get('range'), file: new URL(url).searchParams.get('index') });
    if (start >= bytes.length) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${bytes.length}` } });
    let offset = start;
    init.signal.addEventListener('abort', () => cancelled++, { once: true });
    return new Response(new ReadableStream({
      async pull(controller) {
        if (slow) await new Promise(resolve => setTimeout(resolve, 10));
        if (init.signal.aborted) { controller.error(new Error('aborted')); return; }
        if (offset > end) { controller.close(); return; }
        const next = Math.min(offset + (slow ? 1024 : 16384), end + 1);
        controller.enqueue(bytes.subarray(offset, next)); offset = next;
      },
      cancel() { cancelled++; },
    }, { highWaterMark: 0 }), { status: range ? 206 : 200, headers: { 'Content-Length': String(end - start + 1), 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${bytes.length}` } : {}) } });
  });
  const converter = new FFmpeg(torrents);
  const signal = new AbortController().signal;
  const file = id => ({ id, path: 'deliberately-wrong-extension.avi', kind: 'video', size: files.get(id).length, sample: false });
  const packetHashes = async (path, stream) => JSON.parse((await command(prober, ['-v', 'error', '-select_streams', stream, '-show_packets', '-show_data_hash', 'sha256', '-show_entries', 'packet=data_hash', '-of', 'json', path])).stdout).packets.map(p => p.data_hash);
  const option = p => { const inspection = inspectPlayback(p); return choosePlayback(inspection, inspection.options.filter(o => o.mode !== 'direct' && o.mime.startsWith('video/mp4') && o.mime.includes('avc1.') && (o.audio === 'none' || o.mime.includes('mp4a.40.2'))).map(o => o.id)); };
  try {
    const base = join(directory, 'base.mp4');
    await command(binary, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '8', '-c:v', 'libx264', '-threads', '2', '-g', '24', '-pix_fmt', 'yuv420p', '-c:a', 'aac', base]);
    files.set(1, await readFile(base));
    const directProbe = await converter.probe(hash, file(1), signal);
    assert.equal(directProbe.container, 'mp4'); assert.equal(inspectPlayback(directProbe).options[0].mode, 'direct');
    assert.match(inspectPlayback(directProbe).options[0].mime, /avc1\.[\da-f]{6}/);
    const reads = requests.length;
    await converter.probe(hash, file(1), signal); assert.equal(requests.length, reads, 'successful probes are cached');
    for (const [id, name, codecs, expected] of [
      [2, 'remux.mkv', ['-c', 'copy'], ['copy', 'copy']],
      [3, 'audio.mkv', ['-c:v', 'copy', '-c:a', 'dca', '-strict', '-2', '-ac', '2'], ['copy', 'aac']],
      [4, 'video.mkv', ['-c:v', 'mpeg4', '-c:a', 'copy'], ['h264', 'copy']],
      [5, 'both.mkv', ['-c:v', 'mpeg4', '-c:a', 'pcm_s16le'], ['h264', 'aac']],
      [8, 'transport.ts', ['-c', 'copy'], ['copy', 'copy']],
    ]) {
      const input = join(directory, name);
      await command(binary, ['-v', 'error', '-i', base, ...codecs, input]);
      files.set(id, await readFile(input));
      const p = await converter.probe(hash, file(id), signal), choice = option(p);
      assert.deepEqual([choice.video, choice.audio], expected);
      const response = await converter.stream(hash, file(id), p, choice, new Request('http://dashboard/converted', { headers: { Range: 'bytes=500-' } }), 0);
      assert.equal(response.status, 200); assert.equal(response.headers.get('accept-ranges'), 'none'); assert.equal(response.headers.get('content-range'), null);
      const output = join(directory, `output-${id}.mp4`); await writeFile(output, Buffer.from(await response.arrayBuffer()));
      const metadata = JSON.parse((await command(prober, ['-v', 'error', '-show_streams', '-of', 'json', output])).stdout);
      assert.deepEqual(metadata.streams.map(s => s.codec_name), ['h264', 'aac']);
      await command(binary, ['-v', 'error', '-xerror', '-i', output, '-f', 'null', '-']);
      // TS changes Annex B / ADTS framing, so its demuxed packet hashes differ.
      if (choice.video === 'copy' && id !== 8) assert.deepEqual(await packetHashes(output, 'v:0'), await packetHashes(input, 'v:0'), `${name}: compressed video packets preserved`);
      if (choice.audio === 'copy' && id !== 8) assert.deepEqual(await packetHashes(output, 'a:0'), await packetHashes(input, 'a:0'), `${name}: compressed audio packets preserved`);
      if (id === 2) {
        const seek = await converter.stream(hash, file(id), p, choice, new Request('http://dashboard/converted'), 4);
        const seekPath = join(directory, 'seek.mp4'); await writeFile(seekPath, Buffer.from(await seek.arrayBuffer()));
        const duration = Number(JSON.parse((await command(prober, ['-v', 'error', '-show_format', '-of', 'json', seekPath])).stdout).format.duration);
        assert.ok(duration > 2 && duration < 5, `seek output duration: ${duration}`);
      }
    }
    const p = await converter.probe(hash, file(2), signal), choice = option(p);
    const beforeHead = requests.length;
    assert.equal((await converter.stream(hash, file(2), p, choice, new Request('http://dashboard/converted', { method: 'HEAD' }), 0)).body, null);
    assert.equal(requests.length, beforeHead, 'HEAD does not launch a process or read torrent bytes');
    slow = true;
    const controller = new AbortController();
    const active = await converter.stream(hash, file(2), p, choice, new Request('http://dashboard/converted', { signal: controller.signal }), 0);
    await assert.rejects(converter.stream(hash, file(2), p, choice, new Request('http://dashboard/converted'), 0), /converter is busy/);
    await active.body.cancel(); assert.ok(cancelled > 0, 'cancellation reaches the source');
    const another = await converter.stream(hash, file(2), p, choice, new Request('http://dashboard/converted'), 0);
    await another.body.cancel();
    const aborted = new AbortController(); aborted.abort();
    await assert.rejects(converter.stream(hash, file(2), p, choice, new Request('http://dashboard/converted', { signal: aborted.signal }), 0), /cancelled/i);
    slow = false;
    const old = process.env.FFMPEG_PATH; process.env.FFMPEG_PATH = join(directory, 'missing-ffmpeg');
    try { await assert.rejects(converter.stream(hash, file(2), p, choice, new Request('http://dashboard/converted'), 0), /could not start/); }
    finally { if (old === undefined) delete process.env.FFMPEG_PATH; else process.env.FFMPEG_PATH = old; }
    files.set(6, Buffer.from('not a video'));
    await assert.rejects(converter.probe(hash, file(6), signal), /could not be processed/);
  } finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('homelab-ffmpeg-'));
    await rm(directory, { recursive: true, force: true });
  }
});
