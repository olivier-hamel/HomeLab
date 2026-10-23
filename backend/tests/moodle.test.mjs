import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMoodleApi } from '../src/lib/moodle/api.ts';
import { createAccountVerifier } from '../src/lib/accounts.ts';
import { moodleEndpoint, moodleResult, withMoodle } from '../src/lib/moodle/client.ts';

const origin = 'https://moodle.test';
const cookie = `memo_session=${'m'.repeat(43)}`;
const course = { id: 42, shortname: 'TEST101', fullname: 'Test course' };
const file = { id: 'file:42/7?x=a%2Fb', filename: 'document.pdf', mimetype: 'application/pdf', filesize: 1000, section: 'General', module: 'Document' };
const extracted = { filename: file.filename, course_id: course.id, text: 'Private document canary', truncated: false, characters_extracted: 23, note: '' };
Object.assign(process.env, { MOODLE_ALLOWED_USERS: 'oli', MOODLE_MCP_URL: 'http://127.0.0.1:18000/mcp', MEMO_AUTH_URL: 'http://memo.test:8000' });

function request(path, body, headers = {}) {
  return new Request(`${origin}/api/moodle/${path}`, { method: body === undefined ? 'GET' : 'POST', headers: {
    Cookie: cookie, Origin: origin, ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Moodle-Request': '1' }), ...headers,
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
function fixture() {
  const calls = [];
  let username = 'oli', enabled = true, expired = false, changePassword = false;
  const authenticate = createAccountVerifier(async () => expired ? Response.json({}, { status: 401 }) : Response.json({
    enabled, user: { username, display_name: username, must_change_password: changePassword }, accounts: [{ username }],
  }));
  const connect = async (_signal, work) => {
    calls.push(['connect']);
    return work({ tools: ['list_courses', 'list_files', 'read_file'],
      courses: async () => { calls.push(['list_courses', {}]); return [course]; },
      files: async id => { calls.push(['list_files', { course_id: id }]); return [file]; },
      read: async (id, fileId) => { calls.push(['read_file', { course_id: id, file_id: fileId }]); return extracted; },
    });
  };
  return { calls, api: createMoodleApi(authenticate, connect), user: value => { username = value; },
    disabled: () => { enabled = false; }, expire: () => { expired = true; }, changePassword: () => { changePassword = true; } };
}

test('every Moodle route requires a valid account AND explicit personal-account authorization before MCP connects', async () => {
  const f = fixture();
  for (const [path, body] of [['status'], ['courses'], ['files', { course_id: 42 }], ['read', { course_id: 42, file_id: file.id }]]) {
    assert.equal((await f.api(request(path, body, { Cookie: '' }))).status, 401);
    f.user('max');
    assert.equal((await f.api(request(path, body))).status, 403);
    // Selecting Oli in a body/header cannot impersonate the authenticated user.
    assert.equal((await f.api(request(path, body, { 'X-Media-Profile': 'oli', 'X-Moodle-User': 'oli' }))).status, 403);
  }
  assert.equal(f.calls.length, 0);
  for (const setup of ['disabled', 'expire', 'changePassword']) {
    const other = fixture(); other[setup]();
    assert.ok([401, 403, 503].includes((await other.api(request('courses'))).status));
    assert.equal(other.calls.length, 0);
  }
  const previous = process.env.MOODLE_ALLOWED_USERS;
  delete process.env.MOODLE_ALLOWED_USERS;
  try { assert.equal((await fixture().api(request('courses'))).status, 403); }
  finally { process.env.MOODLE_ALLOWED_USERS = previous; }
});

test('routes use discovered course/file identities and preserve the exact file ID with its course', async () => {
  const f = fixture();
  const status = await f.api(request('status'));
  assert.deepEqual(await status.json(), { available: true, tools: ['list_courses', 'list_files', 'read_file'], personalAccount: true });
  assert.equal(status.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await (await f.api(request('courses'))).json(), { courses: [course] });
  assert.deepEqual(await (await f.api(request('files', { course_id: 42 }))).json(), { course_id: 42, files: [file] });
  assert.deepEqual(await (await f.api(request('read', { course_id: 42, file_id: file.id }))).json(), { file: extracted });
  assert.deepEqual(f.calls.slice(-4), [['connect'], ['list_courses', {}], ['list_files', { course_id: 42 }], ['read_file', { course_id: 42, file_id: file.id }]]);
  f.calls.length = 0;
  assert.equal((await f.api(request('read', { course_id: 99, file_id: file.id }))).status, 404);
  assert.ok(!f.calls.some(call => call[0] === 'list_files'));
  f.calls.length = 0;
  assert.equal((await f.api(request('read', { course_id: 42, file_id: 'other-course-file' }))).status, 404);
  assert.ok(!f.calls.some(call => call[0] === 'read_file'));
});

test('cross-site requests, arbitrary tool names and invalid inputs never reach Moodle', async () => {
  const f = fixture();
  for (const req of [request('courses', undefined, { Origin: 'https://evil.test' }), request('courses', undefined, { 'Sec-Fetch-Site': 'cross-site' }),
    request('files', { course_id: 42 }, { 'X-Moodle-Request': '' }), request('files', { course_id: 42 }, { Origin: '' }),
    request('files', { course_id: '42' }), request('files', { course_id: -1 }), request('files', []),
    request('read', { course_id: 42, file_id: 7 }), request('read', { course_id: 42, file_id: '' }),
    request('call_tool', { name: 'delete_file' }), request('courses', { endpoint: 'http://evil.test' }),
  ]) assert.ok([400, 403, 404].includes((await f.api(req)).status));
  assert.equal(f.calls.length, 0);
});

test('transport failures are sanitized and oversized files are not downloaded', async () => {
  const verify = async () => ({ user: { username: 'oli' }, accounts: [] });
  const failure = createMoodleApi(verify, async () => { throw new Error('credential-canary Private document canary'); });
  const response = await failure(request('courses'));
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /canary/);
  let read = false;
  const large = createMoodleApi(verify, async (_signal, work) => work({ courses: async () => [course], files: async () => [{ ...file, filesize: 25 * 1024 * 1024 + 1 }], read: async () => { read = true; } }));
  assert.equal((await large(request('read', { course_id: 42, file_id: file.id }))).status, 413);
  assert.equal(read, false);
});

test('structured results take priority; JSON fallback reads all rows instead of only the first text block', () => {
  const content = [{ type: 'text', text: JSON.stringify(course) }, { type: 'text', text: JSON.stringify({ ...course, id: 43 }) }];
  assert.deepEqual(moodleResult({ structuredContent: { result: [course] }, content }, true), [course]);
  assert.deepEqual(moodleResult({ content }, true), [course, { ...course, id: 43 }]);
  assert.deepEqual(moodleResult({ content: [{ type: 'text', text: 'Information' }, { type: 'text', text: JSON.stringify([course]) }] }, true), [course]);
  assert.deepEqual(moodleResult({ content: [{ type: 'text', text: JSON.stringify(extracted) }] }, false), extracted);
  assert.deepEqual(moodleResult({ structuredContent: { result: [] }, content: [] }, true), []);
  assert.throws(() => moodleResult({ isError: true, content: [{ type: 'text', text: 'credential-canary' }] }, true), error => error.code === 'moodle_tool' && !error.message.includes('canary'));
  assert.throws(() => moodleResult({ content: [] }, true));
  assert.throws(() => moodleResult({ content }, false));
});

function httpFixture(overrides = {}) {
  const calls = [];
  const schemas = [
    { name: 'list_courses', inputSchema: { type: 'object', properties: {} }, outputSchema: { type: 'object', properties: { result: { type: 'array', items: { type: 'object' } } }, required: ['result'] } },
    { name: 'list_files', inputSchema: { type: 'object', properties: { course_id: { type: 'integer' } }, required: ['course_id'] } },
    { name: 'read_file', inputSchema: { type: 'object', properties: { course_id: { type: 'integer' }, file_id: { type: 'string' } }, required: ['course_id', 'file_id'] } },
  ];
  const fetcher = async (url, init) => {
    assert.equal(String(url), 'http://127.0.0.1:18000/mcp');
    assert.equal(init.redirect, 'error');
    assert.equal(init.credentials, 'omit');
    assert.ok(!new Headers(init.headers).has('cookie'));
    if (init.method === 'GET') return new Response(null, { status: 405 });
    if (init.method === 'DELETE') { calls.push({ method: 'DELETE' }); return new Response(null, { status: 200 }); }
    const rpc = JSON.parse(init.body);
    calls.push(rpc);
    if (rpc.id === undefined) return new Response(null, { status: 202 });
    let result;
    if (rpc.method === 'initialize') result = { protocolVersion: rpc.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'test-moodle', version: '1' } };
    else if (rpc.method === 'tools/list') result = rpc.params?.cursor ? { tools: schemas.slice(1).filter(tool => tool.name !== overrides.missing) } : { tools: schemas.slice(0, 1), nextCursor: 'next-page' };
    else if (rpc.method === 'tools/call') {
      if (overrides.toolError) result = { isError: true, content: [{ type: 'text', text: 'credential-canary Private document canary' }] };
      else if (rpc.params.name === 'list_courses') result = { content: [{ type: 'text', text: JSON.stringify(course) }], structuredContent: { result: [course] } };
      else if (rpc.params.name === 'list_files') result = { content: [{ type: 'text', text: JSON.stringify(file) }] };
      else result = { content: [{ type: 'text', text: JSON.stringify({ ...extracted, ...(overrides.text || {}) }) }] };
    } else throw new Error(`Unexpected MCP method ${rpc.method}`);
    return Response.json({ jsonrpc: '2.0', id: rpc.id, result }, { headers: { 'mcp-session-id': 'fixture-session' } });
  };
  return { calls, fetcher };
}

test('official Streamable HTTP client initializes, discovers paginated tools, calls all three and terminates its session', async () => {
  const original = globalThis.fetch;
  const f = httpFixture(); globalThis.fetch = f.fetcher;
  try {
    await withMoodle(new AbortController().signal, async session => {
      assert.deepEqual(await session.courses(), [course]);
      assert.deepEqual(await session.files(course.id), [file]);
      assert.deepEqual(await session.read(course.id, file.id), extracted);
    });
    assert.deepEqual(f.calls.map(call => call.method), ['initialize', 'notifications/initialized', 'tools/list', 'tools/list', 'tools/call', 'tools/call', 'tools/call', 'DELETE']);
    assert.deepEqual(f.calls.find(call => call.params?.name === 'read_file').params.arguments, { course_id: course.id, file_id: file.id });
  } finally { globalThis.fetch = original; }
});

test('missing tools, tool errors, mismatched course IDs and over-limit returned text fail closed; later sessions recover', async () => {
  const original = globalThis.fetch;
  try {
    for (const options of [{ missing: 'read_file' }, { toolError: true }, { text: { course_id: 99 } }, { text: { text: 'x'.repeat(50_001) } }]) {
      const f = httpFixture(options); globalThis.fetch = f.fetcher;
      await assert.rejects(withMoodle(new AbortController().signal, session => session.read(course.id, file.id)), error => !error.message.includes('canary'));
      assert.equal(f.calls.at(-1).method, 'DELETE');
    }
    globalThis.fetch = httpFixture().fetcher;
    assert.deepEqual(await withMoodle(new AbortController().signal, session => session.courses()), [course]);
  } finally { globalThis.fetch = original; }
});

test('unauthenticated remote endpoints and caller-controlled MCP addresses are rejected', () => {
  const previous = process.env.MOODLE_MCP_URL;
  try {
    for (const url of ['', 'http://192.168.0.196:8000/mcp', 'http://127.0.0.1:8000/mcp', 'http://user:secret@127.0.0.1:18000/mcp', 'http://127.0.0.1:18000/mcp?token=private']) {
      process.env.MOODLE_MCP_URL = url;
      assert.throws(moodleEndpoint, error => error.code === 'moodle_config' && !error.message.includes('private'));
    }
  } finally { process.env.MOODLE_MCP_URL = previous; }
});
