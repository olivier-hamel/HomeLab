import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { CameraSettings, cameraHost } from '../src/lib/camera/config.ts';
import { createCameraApi } from '../src/lib/camera/api.ts';
import { TapoStreams, rtspInput, streamArguments } from '../src/lib/camera/stream.ts';
import { TapoControl, validPreset } from '../src/lib/camera/control.ts';
import { MediaError } from '../src/lib/media/core.ts';
import { Cam } from 'onvif';

const config = { name: 'Salon', username: 'camera-user', password: 'private@password:?' };
const origin = 'https://homelab.test';
const request = (path, data, headers = {}) => new Request(`${origin}/api/camera/${path}`, {
  headers: { Cookie: 'memo_session=fixture', ...(data ? { Origin: origin, 'X-Camera-Request': '1', 'Content-Type': 'application/json' } : {}), ...headers },
  ...(data ? { method: 'POST', body: JSON.stringify(data) } : {}),
});
function fixture() {
  const calls = [];
  const settings = { get: async () => config, save: async body => ({ ...config, ...body }) };
  const control = {
    status: async () => ({ connected: true, ptz: true, presetsSupported: true, presets: [{ name: 'Entrée', token: '1' }] }),
    move: async (...args) => { calls.push(['move', ...args]); }, stop: async (...args) => { calls.push(['stop', ...args]); },
    preset: async (...args) => { calls.push(['preset', ...args]); }, reset: () => { calls.push(['control-reset']); },
  };
  const streams = { asset: async (...args) => { calls.push(['asset', ...args]); return new Uint8Array([1, 2, 3]); }, reset: () => { calls.push(['stream-reset']); } };
  const auth = async req => { if (!req.headers.get('cookie')) throw new MediaError('account_session', 'Session required', 401); return { user: { username: 'oli' } }; };
  return { api: createCameraApi(auth, settings, control, streams), calls, control, settings };
}
test('all camera and video routes require a HomeLab account; cross-site commands fail before camera access', async () => {
  const { api, calls } = fixture();
  for (const path of ['status', 'stream/hd/index.m3u8', 'stream/sd/segment-000000001.ts']) {
    assert.equal((await api(new Request(`${origin}/api/camera/${path}`))).status, 401);
  }
  for (const headers of [{ Origin: 'https://evil.test' }, { 'X-Camera-Request': '' }, { Origin: '' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    assert.equal((await api(request('move', { direction: 'left', speed: 0.5 }, headers))).status, 403);
  }
  assert.equal(calls.length, 0);
});
test('status exposes connection and presets without revealing the camera account; offline errors are sanitized', async () => {
  const f = fixture();
  const response = await f.api(request('status'));
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const data = await response.json(); assert.equal(data.connected, true); assert.deepEqual(data.presets, [{ name: 'Entrée', token: '1' }]);
  assert.equal(data.username, undefined); assert.equal(data.password, undefined);
  f.control.status = async () => { throw new Error(config.password); };
  const offline = await (await f.api(request('status'))).json();
  assert.equal(offline.connected, false); assert.equal(JSON.stringify(offline).includes(config.password), false);
  f.settings.get = async () => ({ ...config, username: '', password: '' });
  assert.equal((await (await f.api(request('status'))).json()).configured, false);
});
test('commands use private server credentials, settings reset both transports, and stream assets have strict paths', async () => {
  const f = fixture();
  assert.equal((await f.api(request('move', { direction: 'up', speed: 0.25 }))).status, 200);
  assert.deepEqual(f.calls[0], ['move', config, 'up', 0.25]);
  assert.equal((await f.api(request('stop', {}))).status, 200);
  assert.equal((await f.api(request('preset', { action: 'save', value: 'Entrée' }))).status, 200);
  assert.equal((await f.api(request('settings', { name: 'Entrée' }))).status, 200);
  assert.ok(f.calls.some(call => call[0] === 'control-reset')); assert.ok(f.calls.some(call => call[0] === 'stream-reset'));
  const stream = await f.api(request('stream/hd/index.m3u8'));
  assert.equal(stream.headers.get('content-type'), 'application/vnd.apple.mpegurl'); assert.deepEqual([...new Uint8Array(await stream.arrayBuffer())], [1, 2, 3]);
  const count = f.calls.length;
  for (const path of ['stream/hd/secret.json', 'stream/4k/index.m3u8', 'stream/hd/..%2Faccount.json']) assert.equal((await f.api(request(path))).status, 404);
  assert.equal(f.calls.length, count);
});
test('settings persist with restrictive permissions; partial credentials and untrusted camera targets are rejected', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'camera-settings-test-'));
  try {
    const settings = new CameraSettings(directory);
    assert.equal((await settings.get()).username, '');
    await assert.rejects(settings.save({ name: 'Salon', username: 'only-user' }), error => error.status === 400);
    await assert.rejects(settings.save({ ...config, password: 'bad\npassword' }), error => error.status === 400);
    await settings.save(config); assert.deepEqual(await settings.get(), config);
    assert.equal((await stat(join(directory, 'account.json'))).mode & 0o777, 0o600);
    assert.equal((await stat(directory)).mode & 0o777, 0o700);
    await settings.save({ name: 'Entrée' }); assert.equal((await settings.get()).password, config.password);
    assert.equal((await readFile(join(directory, 'account.json'), 'utf8')).includes('Entrée'), true);
    const previous = process.env.TAPO_HOST; process.env.TAPO_HOST = '8.8.8.8';
    try { assert.throws(cameraHost, error => error.status === 503); }
    finally { if (previous === undefined) delete process.env.TAPO_HOST; else process.env.TAPO_HOST = previous; }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('RTSP input escapes credentials and the relay bounds decoding, encoding and mux buffering; invalid movement never connects', async () => {
  assert.equal(rtspInput(config, 'sd'), 'rtsp://camera-user:private%40password%3A%3F@192.168.0.188:554/stream2');
  const args = streamArguments('rtsp://fixture', '/tmp/output');
  assert.ok(args.includes('delete_segments+omit_endlist+temp_file+independent_segments+program_date_time'));
  assert.equal(args[args.indexOf('-tune') + 1], 'zerolatency');
  assert.equal(args[args.indexOf('-g') + 1], '10');
  assert.equal(args[args.indexOf('-threads') + 1], '1', 'The decoder must not accumulate a queue of live frames');
  assert.ok(args.indexOf('-threads') < args.indexOf('-i'), 'Decoder options must precede the RTSP input');
  assert.equal(args[args.indexOf('-max_interleave_delta') + 1], '100000');
  assert.equal(args[args.indexOf('-timeout') + 1], '10000000');
  const control = new TapoControl();
  await assert.rejects(control.move(config, 'diagonal', 0.5), error => error.status === 400);
  await assert.rejects(control.move(config, 'left', 100), error => error.status === 400);
  await assert.rejects(control.preset(config, 'save', '<script>'), error => error.status === 400);
  assert.equal(validPreset('1</PresetToken>'), false);
});
test('C200 movement omits unsupported optical zoom, uses its minimum one-second timeout and sends an early Stop', async () => {
  const bodies = [];
  const cam = Object.create(Cam.prototype);
  Object.assign(cam, { activeSource: { profileToken: 'profile1', ptz: true },
    _envelopeHeader: () => '<Envelope>', _envelopeFooter: () => '</Envelope>',
    _request: (options, done) => { bodies.push(options.body); done(null, []); }, on: () => cam,
  });
  const control = new TapoControl((saved, done) => { assert.deepEqual(saved, config); queueMicrotask(() => done(null)); return cam; });
  await control.move(config, 'left', 0.5);
  assert.match(bodies[0], /<Timeout>PT1S<\/Timeout>/);
  assert.match(bodies[0], /PanTilt x="-0\.5" y="0"/);
  assert.doesNotMatch(bodies[0], /<Zoom\b/);
  assert.match(bodies[1], /<PanTilt>true<\/PanTilt>/);
  assert.doesNotMatch(bodies[1], /<Zoom>true<\/Zoom>/);
  await control.stop(config);
  assert.match(bodies[2], /<Stop\b/);
});
test('batched camera audio keeps its full sample duration instead of collapsing onto packet arrival times', async () => {
  const args = streamArguments('rtsp://fixture', '/tmp/output');
  const result = await new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=8000:duration=3',
      '-af', `asetnsamples=n=4000:p=0,${args[args.indexOf('-af') + 1]}`, '-ar', '16000', '-c:a', 'pcm_s16le', '-f', 's16le', 'pipe:1']);
    let bytes = 0; child.stdout.on('data', chunk => { bytes += chunk.length; }); child.stderr.resume();
    child.once('error', reject); child.once('close', code => code ? reject(new Error('Audio clock regression failed')) : resolve(bytes / (16000 * 2)));
  });
  assert.ok(result >= 3 && result < 3.5, `Three seconds of batched samples must remain continuous audio, received ${result}s`);
});
test('a real FFmpeg relay shares one encoder and aligns absolute audio/video clocks in playable short segments', async () => {
  let starts = 0;
  const fixture = await mkdtemp(join(tmpdir(), 'camera-input-'));
  const input = join(fixture, 'camera.mkv');
  // Exercise the decoder with interleaved compressed tracks, as RTSP does.
  // A multi-output lavfi source does not obey -re pacing independently for audio.
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=20', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=8000',
    '-t', '3', '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '20', '-bf', '0', '-c:a', 'pcm_mulaw', input]);
  const streams = new TapoStreams((_binary, args, options) => {
    starts++;
    const adjusted = [];
    for (let index = 0; index < args.length; index++) {
      if (['-rtsp_transport', '-reorder_queue_size', '-timeout'].includes(args[index])) { index++; continue; }
      if (args[index] === '-i') { adjusted.push('-re', '-stream_loop', '-1', '-i', input); index++; }
      else adjusted.push(args[index]);
    }
    return spawn('ffmpeg', adjusted, options);
  });
  try {
    const [first, second] = await Promise.all([streams.asset(config, 'hd', 'index.m3u8', AbortSignal.timeout(15_000)), streams.asset(config, 'hd', 'index.m3u8', AbortSignal.timeout(15_000))]);
    assert.equal(starts, 1);
    const manifest = new TextDecoder().decode(first); assert.match(manifest, /#EXTM3U/); assert.match(new TextDecoder().decode(second), /#EXTINF/);
    const durations = [...manifest.matchAll(/#EXTINF:([\d.]+)/g)].map(match => Number(match[1]));
    assert.ok(durations.every(duration => duration <= 0.55), `Live segments must stay short: ${durations}`);
    assert.match(manifest, /#EXT-X-PROGRAM-DATE-TIME:/);
    assert.match(manifest, /#EXT-X-INDEPENDENT-SEGMENTS/);
    const segment = manifest.match(/segment-\d{9}\.ts/)[0];
    const bytes = await streams.asset(config, 'hd', segment, AbortSignal.timeout(1000)); assert.equal(bytes[0], 0x47); assert.ok(bytes.length > 1000);
    const tracks = await new Promise((resolve, reject) => {
      const child = spawn('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,start_time,duration', '-of', 'json', 'pipe:0']);
      let result = ''; child.stdout.on('data', chunk => { result += chunk; }); child.stderr.resume();
      child.on('error', reject); child.stdin.on('error', reject); child.on('close', code => code ? reject(new Error('Segment probe failed')) : resolve(JSON.parse(result).streams)); child.stdin.end(bytes);
    });
    assert.ok(tracks.some(track => track.codec_name === 'h264'));
    assert.ok(tracks.some(track => track.codec_name === 'aac'), 'The initial short segment must include audio so the player creates both buffers');
    const video = tracks.find(track => track.codec_type === 'video');
    const audio = tracks.find(track => track.codec_type === 'audio');
    assert.ok(Number(video.start_time) < 2, 'The probed keyframe must be decoded without waiting for the next GOP (including the MPEG-TS offset)');
    assert.ok(Number(video.start_time) < 10 && Number(audio.start_time) < 10, 'Absolute input clocks must be rebased before MPEG-TS timestamp rollover');
    assert.ok(Math.abs(Number(video.start_time) - Number(audio.start_time)) < 0.25, 'Audio and video must share the same playback clock');
    await assert.rejects(streams.asset(config, 'hd', '../account.json', AbortSignal.timeout(1000)), error => error.status === 404);
  } finally { streams.reset(); await rm(fixture, { recursive: true, force: true }); }
});
