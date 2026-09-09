import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer as createHttpServer, request } from 'node:http';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { createServer as createViteServer } from 'vite';
import config from '../vite.config.ts';

function throughProxy(port, headers, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path: '/api/media/status', headers, method }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('error', reject);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, ...JSON.parse(body) }); } catch (error) { reject(error); }
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('Proxy request timed out')));
    req.end();
  });
}

test('development API proxy preserves browser Host and Origin for media security checks', async t => {
  const backend = createHttpServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ host: req.headers.host, origin: req.headers.origin }));
  });
  t.after(() => new Promise((resolve, reject) => {
    backend.close(error => error ? reject(error) : resolve());
    backend.closeAllConnections();
  }));
  backend.listen(0, '127.0.0.1');
  await once(backend, 'listening');

  const target = `http://127.0.0.1:${backend.address().port}`;
  const proxy = Object.fromEntries(Object.entries(config.server.proxy).map(([path, options]) => [
    path, typeof options === 'string' ? target : { ...options, target },
  ]));
  const vite = await createViteServer({
    ...config,
    configFile: false,
    envFile: false,
    root: fileURLToPath(new URL('..', import.meta.url)),
    logLevel: 'silent',
    server: { ...config.server, host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: null, proxy },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  t.after(() => vite.close());
  await vite.listen();

  for (const host of ['localhost:3000', '127.0.0.1:3000']) {
    const port = vite.httpServer.address().port;
    assert.deepEqual(await throughProxy(port, { host }), { status: 200, host });
    const origin = `http://${host}`;
    assert.deepEqual(await throughProxy(port, { host, origin }, 'POST'), { status: 200, host, origin });
  }
});
