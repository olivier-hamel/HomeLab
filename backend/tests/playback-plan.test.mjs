import assert from 'node:assert/strict';
import { test } from 'node:test';
import { choosePlayback, conversionArguments, inspectPlayback, parseProbe } from '../src/lib/media/playback-plan.ts';

const track = (codec_name, codec_type, index, more = {}) => ({ index, codec_name, codec_type, profile: codec_name === 'h264' ? 'High' : codec_name === 'aac' ? 'LC' : 'Main', level: 41, pix_fmt: 'yuv420p', ...more });
const probe = (container = 'mov,mp4,m4a,3gp,3g2,mj2', video = 'h264', audio = 'aac', more = {}) => parseProbe({ format: { format_name: container, duration: '120.5', tags: { major_brand: 'isom' } }, streams: [track(video, 'video', 2, more), ...(audio ? [track(audio, 'audio', 5)] : [])] }, Buffer.alloc(0));
const browser = (inspection, { video = 'avc1.', audio = 'mp4a.40.2', container = 'video/mp4' } = {}) => inspection.options.filter(o => o.mime.startsWith(container) && o.mime.includes(video) && (o.audio === 'none' || o.mime.includes(audio))).map(o => o.id);
const plan = (p, support) => { const inspection = inspectPlayback(p); return choosePlayback(inspection, browser(inspection, support)); };

test('compatible MP4 is direct; unsupported containers remux without encoding either track', () => {
  const direct = plan(probe()); assert.equal(direct.mode, 'direct');
  assert.throws(() => conversionArguments('http://127.0.0.1/input', probe(), direct));
  for (const container of ['matroska,webm', 'avi', 'mpegts']) {
    const p = probe(container); const chosen = plan(p);
    assert.equal(chosen.mode, 'remux'); assert.equal(chosen.video, 'copy'); assert.equal(chosen.audio, 'copy');
    const args = conversionArguments('http://127.0.0.1/input', p, chosen);
    assert.equal(args[args.indexOf('-c:v') + 1], 'copy'); assert.equal(args[args.indexOf('-c:a') + 1], 'copy');
    assert.ok(!args.includes('-vf') && !args.includes('-pix_fmt') && !args.includes('-ac'));
    assert.deepEqual(args.filter((_, i) => args[i - 1] === '-map'), ['0:2', '0:5']);
  }
});
test('incompatible audio converts alone, incompatible video converts alone, both convert only when needed', () => {
  for (const audio of ['dts', 'truehd', 'ac3', 'eac3']) {
    const chosen = plan(probe('matroska,webm', 'h264', audio));
    assert.equal(chosen.video, 'copy'); assert.equal(chosen.audio, 'aac'); assert.equal(chosen.mode, 'transcode');
  }
  const videoOnly = plan(probe('matroska,webm', 'mpeg4', 'aac'));
  assert.equal(videoOnly.video, 'h264'); assert.equal(videoOnly.audio, 'copy');
  const both = plan(probe('avi', 'mpeg4', 'pcm_s16le'));
  assert.equal(both.video, 'h264'); assert.equal(both.audio, 'aac');
});
test('HEVC, AV1, multichannel and WebM are preserved when this browser supports them', () => {
  const hevc = probe('matroska,webm', 'hevc', 'aac', { profile: 'Main 10', level: 153, pix_fmt: 'yuv420p10le' });
  assert.equal(plan(hevc, { video: 'hvc1.2' }).video, 'copy');
  assert.equal(plan(hevc).video, 'h264');
  const ac3 = plan(probe('matroska,webm', 'h264', 'ac3'), { audio: 'ac-3' });
  assert.equal(ac3.audio, 'copy');
  const webm = parseProbe({ format: { format_name: 'matroska,webm' }, streams: [track('vp9', 'video', 0, { profile: 'Profile 0' }), track('opus', 'audio', 1)] }, Buffer.from('4282847765626d', 'hex'));
  assert.equal(plan(webm, { video: 'vp09.', audio: 'opus', container: 'video/webm' }).mode, 'direct');
  const av1 = probe('mov,mp4', 'av1', 'aac', { level: 8 });
  assert.equal(plan(av1, { video: 'av01.' }).mode, 'direct');
});
test('default real video/audio tracks are selected; cover art and missing audio are handled', () => {
  const p = parseProbe({ format: { format_name: 'avi' }, streams: [track('mjpeg', 'video', 0, { disposition: { attached_pic: 1 } }), track('h264', 'video', 1), track('dts', 'audio', 2), track('aac', 'audio', 3, { disposition: { default: 1 } })] }, Buffer.alloc(0));
  assert.equal(p.video.index, 1); assert.equal(p.audio.index, 3); assert.equal(plan(p).mode, 'remux');
  const silent = probe('avi', 'h264', null), chosen = plan(silent);
  assert.equal(chosen.audio, 'none'); assert.equal(chosen.mode, 'remux');
  const args = conversionArguments('http://localhost/input', silent, chosen);
  assert.ok(args.includes('-an')); assert.ok(!args.includes('-c:a'));
  assert.throws(() => parseProbe({ streams: [] }, Buffer.alloc(0)), /No readable video/);
});
test('probe signatures and codec configuration override misleading file extensions or generic codec guesses', () => {
  const p = probe('mov,mp4', 'h264', 'aac', { profile: 'High 10', pix_fmt: 'yuv420p10le', extradata: '\n00000000: 016e 0033 ffe1 0000  .n.3....\n' });
  assert.match(inspectPlayback(p).options[0].mime, /avc1\.6e0033/);
  assert.equal(probe('matroska,webm').container, 'matroska');
  const q = parseProbe({ format: { format_name: 'mov,mp4', tags: { major_brand: 'qt  ' } }, streams: [track('h264', 'video', 0)] }, Buffer.alloc(0));
  assert.equal(q.container, 'mov');
});
test('server chooses cheapest supported plan regardless of client order and rejects arbitrary options', () => {
  const inspection = inspectPlayback(probe());
  assert.equal(choosePlayback(inspection, inspection.options.map(o => o.id).reverse()).mode, 'direct');
  for (const input of [[], ['-c:v copy; arbitrary'], ['http://private/'], null, Array(21).fill('x')]) assert.throws(() => choosePlayback(inspection, input));
  const p = probe('matroska,webm', 'h264', 'dts');
  const args = conversionArguments('http://127.0.0.1/scoped-token', p, plan(p), 30);
  assert.ok(args.indexOf('-ss') < args.indexOf('-i'), 'seek input instead of decoding from the beginning');
  assert.ok(args.includes('http,tcp') && args.includes('pipe:1'));
});
