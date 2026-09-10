// Read-only probe. Pipe this file into Node INSIDE the backend container.
// No torrent adds, downloads, configuration changes, or stream requests.
let failed = false;
async function check(label, variable, path, headers, inspect) {
  if (!process.env[variable]) { console.log(`${label}: missing ${variable}`); failed = true; return; }
  try {
    const base = new URL(process.env[variable].replace(/\/$/, '') + '/');
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) throw Error('Invalid base');
    const response = await fetch(new URL(path, base), { headers, redirect: 'manual', signal: AbortSignal.timeout(10_000) });
    console.log(`${label}: HTTP ${response.status}`);
    if (!response.ok) { failed = true; await response.body?.cancel(); return; }
    const chunks = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.length; if (size > 4 * 1024 * 1024) throw Error('Too large'); chunks.push(chunk); }
    if (inspect) inspect(Buffer.concat(chunks).toString('utf8'));
  } catch { console.log(`${label}: unavailable, timed out, or incompatible response (details suppressed)`); failed = true; }
}
const prowlarrHeaders = { 'X-Api-Key': process.env.PROWLARR_API_KEY || '' };
const tsHeaders = {};
if (process.env.TORRSERVER_USERNAME && process.env.TORRSERVER_PASSWORD) tsHeaders.Authorization = `Basic ${Buffer.from(`${process.env.TORRSERVER_USERNAME}:${process.env.TORRSERVER_PASSWORD}`).toString('base64')}`;
const safeVersion = text => /^[A-Za-z0-9._ +:-]{1,100}$/.test(text.trim()) ? text.trim() : '(unrecognized version format)';
await check('Prowlarr authenticated API', 'PROWLARR_BASE_URL', 'api/v1/system/status', prowlarrHeaders, text => console.log(`Prowlarr version: ${safeVersion(JSON.parse(text).version || '')}`));
await check('TorrServer echo', 'TORRSERVER_BASE_URL', 'echo', tsHeaders, text => console.log(`TorrServer version: ${safeVersion(text)}`));
await check('TorrServer Swagger UI', 'TORRSERVER_BASE_URL', 'swagger/index.html', tsHeaders);
// gin-swagger normally uses doc.json. A 404 requires manually locating the UI's
// schema via its Network tab, not assuming that the installed contract matches.
await check('TorrServer installed schema', 'TORRSERVER_BASE_URL', 'swagger/doc.json', tsHeaders, text => {
  const schema = JSON.parse(text);
  for (const [path, method] of [['/torrents', 'post'], ['/torrent/upload', 'post'], ['/stream', 'get'], ['/echo', 'get']]) {
    const exists = !!schema.paths?.[path]?.[method]; console.log(`${method.toUpperCase()} ${path}: ${exists ? 'present' : 'MISSING'}`); if (!exists) failed = true;
  }
});
// /echo can be public. Check media connections in the UI also verifies Basic auth
// with the documented read-only POST /torrents {action: list}.
process.exitCode = failed ? 1 : 0;
