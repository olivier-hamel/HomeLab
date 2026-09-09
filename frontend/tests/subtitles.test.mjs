import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_SUBTITLE_BYTES, subtitleFormat, subtitleTiming, subtitleVtt, subtitleSearch } from '../src/lib/subtitles.ts';

const encode = text => new TextEncoder().encode(text).buffer;

test('subtitle timing shifts both boundaries, preserves cues before zero and resets without drift', () => {
  const cues = [{ startTime: 0.125, endTime: 0.375, text: 'Opening' }, { startTime: 1.25, endTime: 4.5, text: 'Dialogue' }];
  const original = structuredClone(cues);
  // Emulate the browser's live list changing order after cue times are updated.
  const live = { *[Symbol.iterator]() { for (let i = 0; i < cues.length; i++) yield [...cues].sort((a, b) => a.startTime - b.startTime)[i]; } };
  const timing = subtitleTiming(live);
  timing(2);
  assert.deepEqual(cues.map(cue => [cue.startTime, cue.endTime]), [[2.125, 2.375], [3.25, 6.5]]);
  timing(-0.5);
  assert.deepEqual(cues.map(cue => [cue.startTime, cue.endTime]), [[-0.375, -0.125], [0.75, 4]]);
  for (let i = 0; i < 100; i++) { timing(0.5); timing(-0.5); }
  timing(0);
  assert.deepEqual(cues, original);
});

test('online subtitle search retains catalogue IDs but uses the selected episode in a season pack', () => {
  const context = { kind: 'tv', imdbId: 'tt123', tmdbId: 456, season: 1, episode: 1 };
  const result = subtitleSearch('Pack/Show.S01E04.1080p.WEB-DL.mkv', { query: 'Show S01', context });
  assert.equal(result.context.episode, 4); assert.equal(result.context.imdbId, 'tt123'); assert.equal(context.episode, 1);
  const manual = subtitleSearch('C:\\Videos\\Some.Show.2x03.720p.mp4');
  assert.equal(manual.query, 'Some Show'); assert.equal(manual.context.kind, 'tv'); assert.equal(manual.context.season, 2); assert.equal(manual.context.episode, 3);
  assert.equal(subtitleSearch('Film.Name.2024.1080p.mkv').query, 'Film Name 2024');
  assert.equal(subtitleSearch('Film.mp4').context.kind, 'movie');
});

test('SRT conversion preserves multiline cues, formatting and timing through BOM and CRLF', () => {
  const result = subtitleVtt(encode('\uFEFF1\r\n00:00:01,250 --> 00:00:04,500\r\n<b>Hello</b>\r\nSecond line\r\n\r\n2\r\n01:02:03,000 --> 01:02:05,000\r\nLater cue\r\n'), 'English.SRT');
  assert.equal(result, 'WEBVTT\n\n00:00:01.250 --> 00:00:04.500\n<b>Hello</b>\nSecond line\n\n01:02:03.000 --> 01:02:05.000\nLater cue\n');
});

test('SRT accepts unnumbered cues and rejects invalid timings without rewriting dialogue', () => {
  const result = subtitleVtt(encode('00:00:01.000 --> 00:00:02.000\nNumber 1,000 stays unchanged\n\n2\n00:00:04,000 --> 00:00:03,000\nBackwards\n\n3\n00:60:00,000 --> 00:61:00,000\nInvalid minutes'), 'episode.srt');
  assert.match(result, /Number 1,000 stays unchanged/);
  assert.ok(!result.includes('Backwards') && !result.includes('Invalid minutes'));
  assert.throws(() => subtitleVtt(encode('<html>not subtitles</html>'), 'fake.srt'), /No readable/);
});

test('WebVTT retains cue identifiers, positions and native formatting', () => {
  const text = 'WEBVTT\n\nintro\n00:01.000 --> 00:02.000 line:80%\n<i>Bonjour</i>\n';
  assert.equal(subtitleVtt(encode(text), 'French.vtt'), text);
  assert.throws(() => subtitleVtt(encode('not WEBVTT'), 'fake.vtt'), /valid WebVTT/);
});

test('subtitle files are bounded, format checked, and support UTF-16 BOMs', () => {
  const source = '1\n00:00:00,000 --> 00:00:02,000\nAllô';
  const utf16 = Buffer.from(`\uFEFF${source}`, 'utf16le');
  const data = utf16.buffer.slice(utf16.byteOffset, utf16.byteOffset + utf16.byteLength);
  assert.match(subtitleVtt(data, 'French.srt'), /Allô/);
  assert.equal(subtitleFormat('subs/English.SRT'), 'srt');
  assert.equal(subtitleFormat('movie.ass'), null);
  assert.throws(() => subtitleVtt(encode(source), 'movie.ass'), /SRT or VTT/);
  assert.throws(() => subtitleVtt(new ArrayBuffer(MAX_SUBTITLE_BYTES + 1), 'big.srt'), /2 MiB/);
  assert.throws(() => subtitleVtt(new Uint8Array([0xff]).buffer, 'bad.srt'), /UTF-8/);
});
