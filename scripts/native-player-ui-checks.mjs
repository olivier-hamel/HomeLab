import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

// Exercises the hosted app's real React lifecycle through a simulated Capacitor
// bridge. Native drawing/decoding still requires a physical device.
export async function checkNativePlayer({ call, evaluate, until, activate, origin, metrics }) {
  const injection = await call('Page.addScriptToEvaluateOnNewDocument', { source: `
    localStorage.setItem('homelab:media-profile:oli', 'oli');
    localStorage.setItem('homelab:advanced-media', 'false');
    localStorage.setItem('homelab:subtitle-timing:v1:' + JSON.stringify(['oli', 'Example movie.mp4', 1000000]), '-0.5');
    sessionStorage.clear();
    window.androidBridge = {};
    const listeners = new Map();
    let callbackId = 0;
    window.nativeFixture = {
      plays: [], responses: [], statuses: [], open: false,
      emit(event) { for (const entry of listeners.values()) if (entry.plugin === 'NativeVideoPlayer') entry.callback(event); },
      complete(result) { if (result.action === 'close') this.open = false; this.resolve(result); },
    };
    window.Capacitor = {
      PluginHeaders: [
        { name: 'Preferences', methods: [{ name: 'get', rtype: 'promise' }, { name: 'set', rtype: 'promise' }] },
        { name: 'App', methods: [{ name: 'addListener', rtype: 'callback' }, { name: 'removeListener', rtype: 'promise' }] },
        { name: 'NativeVideoPlayer', methods: [
          ...['play', 'supportedOptions', 'respond', 'status', 'removeListener'].map(name => ({ name, rtype: 'promise' })),
          { name: 'addListener', rtype: 'callback' },
        ] },
      ],
      nativeCallback(plugin, method, options, callback) {
        const id = String(++callbackId);
        listeners.set(id, { plugin, callback });
        return id;
      },
      nativePromise(plugin, method, options) {
        if (method === 'removeListener') { listeners.delete(options.callbackId); return Promise.resolve({}); }
        if (plugin === 'Preferences') return Promise.resolve({ value: location.origin });
        if (method === 'supportedOptions') return Promise.resolve({ supported: options.options.map(option => option.id) });
        if (method === 'respond') { nativeFixture.responses.push(options); return Promise.resolve({}); }
        if (method === 'status') { nativeFixture.statuses.push(options); return Promise.resolve({}); }
        if (method === 'play') {
          nativeFixture.open = true;
          nativeFixture.plays.push(options);
          return new Promise(resolve => { nativeFixture.resolve = resolve; });
        }
        return Promise.resolve({});
      },
    };
  ` });
  const added = metrics.adds.length;
  try {
    await call('Page.navigate', { url: `${origin}/?tv=1` });
    await until('!!document.querySelector(".tv-catalogue-grid button")');
    await activate('.tv-catalogue-grid button');
    await until('!!document.querySelector("dialog button.bg-orange-600:not(:disabled)")');
    await activate('dialog button.bg-orange-600');
    await until('!!document.querySelector(".simple-watch-pending")');
    await until('nativeFixture.plays.length === 1');
    assert.match(await evaluate('nativeFixture.plays[0].qualityInfo'), /Quality review: Good choice[\s\S]*1080p[\s\S]*5,000 seeders[\s\S]*strong streaming choice/);
    assert.equal(await evaluate('nativeFixture.plays[0].subtitleOffsetSeconds'), -0.5, 'Native playback receives remembered timing');
    await evaluate(`nativeFixture.emit({ action: 'subtitleTiming', playbackId: 'selected', subtitleOffsetSeconds: -1.5 })`);
    assert.equal(await evaluate(`localStorage.getItem('homelab:subtitle-timing:v1:' + JSON.stringify(['oli', 'Example movie.mp4', 1000000]))`), '-1.5');
    await evaluate(`nativeFixture.emit({ action: 'subtitleTiming', playbackId: 'foreign-session', subtitleOffsetSeconds: 10 })`);
    assert.equal(await evaluate(`localStorage.getItem('homelab:subtitle-timing:v1:' + JSON.stringify(['oli', 'Example movie.mp4', 1000000]))`), '-1.5', 'Foreign native sessions cannot change timing');
    await evaluate(`nativeFixture.emit({ action: 'playbackProgress', playbackId: 'selected', playbackPositionSeconds: 12.5, durationSeconds: 120 })`);
    for (let attempt = 0; attempt < 50 && metrics.progress.at(-1)?.playbackPositionSeconds !== 12.5; attempt++) await delay(20);
    assert.equal(metrics.progress.at(-1).playbackPositionSeconds, 12.5, 'Native progress events persist the absolute watch position');
    assert.equal(await evaluate('document.querySelector("video").hasAttribute("src")'), false, 'No WebView video decoding alongside native playback');
    assert.equal(await evaluate('document.querySelector(".tv-playback-controls").checkVisibility()'), false, 'Page keeps only the initial loading flow');
    await evaluate(`nativeFixture.emit({ action: 'subtitleAuto', playbackId: 'selected', requestId: 1 })`);
    await until('nativeFixture.responses.length === 1');
    assert.equal(metrics.subtitleSearches.at(-1).language, 'EN');
    assert.match(await evaluate('nativeFixture.responses[0].subtitle.content'), /WEBVTT[\s\S]*English fixture/);
    await evaluate(`nativeFixture.emit({ action: 'subtitleOff', playbackId: 'selected', requestId: 2 })`);
    await evaluate(`nativeFixture.emit({ action: 'subtitleAuto', playbackId: 'selected', requestId: 3 })`);
    await until('nativeFixture.responses.length === 2');
    assert.match(await evaluate('nativeFixture.responses[1].subtitle.content'), /English fixture/);
    assert.equal(await evaluate('nativeFixture.plays.length'), 1, 'Subtitle loading does not reopen the video');
    await evaluate(`nativeFixture.complete({ action: 'next', position: 32, duration: 120, ended: false })`);
    await until('nativeFixture.plays.length === 2');
    assert.deepEqual(metrics.adds.slice(added), ['best', 'broken', 'source'], 'Source change skips the unavailable torrent');
    assert.equal(await evaluate('nativeFixture.plays[1].position'), 32, 'New source resumes the viewer position');
    assert.equal(await evaluate('nativeFixture.plays[1].subtitleOffsetSeconds'), -1.5, 'Reopening the same file restores native timing');
    assert.equal(await evaluate('nativeFixture.open'), true, 'Source replacement keeps the native session open');
    await evaluate(`nativeFixture.complete({ action: 'next', position: 40, duration: 120, ended: false })`);
    await until('nativeFixture.statuses.some(status => status.error)');
    assert.equal(await evaluate('nativeFixture.open'), true, 'Exhausted sources report an error inside the native session');
    await evaluate(`nativeFixture.open = false; nativeFixture.emit({ action: 'close' })`);
    await until('!!document.querySelector(".tv-catalogue-grid") && !document.querySelector(".simple-watch")');
    const responses = await evaluate('nativeFixture.responses.length');
    await evaluate(`nativeFixture.emit({ action: 'subtitleSearch', playbackId: 'selected', requestId: 99 })`);
    assert.equal(await evaluate('nativeFixture.responses.length'), responses, 'Closing disposes the subtitle request handler');
  } catch (error) {
    error.message += '\nNative fixture: ' + JSON.stringify(await evaluate('({plays: nativeFixture.plays, statuses: nativeFixture.statuses, responses: nativeFixture.responses})'));
    throw error;
  } finally {
    await call('Page.removeScriptToEvaluateOnNewDocument', { identifier: injection.identifier });
  }
}
