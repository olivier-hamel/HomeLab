import assert from "node:assert/strict";
import test from "node:test";
import { MovieDiscovery } from "../src/lib/media/movie-discovery.ts";
import { createMediaApi } from "../src/lib/media/api.ts";
import { MediaError } from "../src/lib/media/core.ts";

const secret = "discovery-test-only-secret-not-for-production";
process.env.GEMINI_API_KEY = secret;
const signal = () => new AbortController().signal;
const history = async () => [{ kind: "movie", tmdbId: 999, title: "Watched film", year: "2001", filePath: "private/path.mkv" }];
const movie = id => ({ id, kind: "movie", title: `Film ${id}`, year: "2020", overview: "Movie description", poster: null });
const answer = movies => Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ movies }) }] } }] });
function fixture() {
  const inputs = [];
  let failed = false;
  const service = new MovieDiscovery(async (_url, init) => {
    assert.equal(new Headers(init.headers).get("x-goog-api-key"), secret);
    assert.equal(init.body.includes(secret), false);
    assert.equal(init.body.includes("private/path"), false);
    const input = JSON.parse(JSON.parse(init.body).contents[0].parts[0].text);
    inputs.push(input);
    if (failed) return new Response(secret, { status: 503 });
    const offset = input.alreadyShown.length;
    return answer(Array.from({ length: 16 }, (_, i) => movie(offset + i + 1)));
  }, { browse: async (kind, query) => {
    assert.equal(kind, "movie");
    return { titles: [movie(Number(query.split(" ")[1]))] };
  } });
  return { service, inputs, fail: value => { failed = value; } };
}
const choose = batch => ({ sessionId: batch.sessionId, choices: batch.titles.filter((_, i) => i % 4 === 0).map(title => title.id) });

test("sixteen verified movies refine from four group preferences, retain earlier taste, and retry idempotently", async () => {
  const { service, inputs } = fixture();
  const first = await service.next("owner", "oli", {}, history, signal());
  assert.equal(first.titles.length, 16);
  const second = await service.next("owner", "oli", choose(first), history, signal());
  assert.equal(inputs[1].preferences.length, 4);
  assert.deepEqual(inputs[1].preferences[0], { preferred: { id: 1, title: "Film 1", year: "2020" }, alternatives: [2, 3, 4].map(id => ({ id, title: `Film ${id}`, year: "2020" })) });
  assert.equal(inputs[1].alreadyShown.length, 16);
  assert.ok(second.titles.every(title => !first.titles.some(old => old.id === title.id)));
  assert.deepEqual(await service.next("owner", "oli", choose(first), history, signal()), second);
  assert.equal(inputs.length, 2, "a repeated submission does not spend another Gemini request");
  await service.next("owner", "oli", choose(second), history, signal());
  assert.equal(inputs[2].preferences.length, 8);
  assert.equal(inputs[2].alreadyShown.length, 32);
});

test("session ownership, profile separation, and exactly one selection per group are enforced", async () => {
  const { service, inputs } = fixture();
  const first = await service.next("owner", "oli", {}, history, signal());
  for (const [owner, profile] of [["other", "oli"], ["owner", "max"]]) {
    await assert.rejects(service.next(owner, profile, choose(first), history, signal()), error => error.status === 410);
  }
  for (const choices of [[1], [1, 2, 3, 4], [999, 5, 9, 13], ["1", 5, 9, 13], [false, 5, 9, 13], [1, 5, 9, 13, null]]) {
    await assert.rejects(service.next("owner", "oli", { sessionId: first.sessionId, choices }, history, signal()), error => error.status === 400);
  }
  assert.equal(inputs.length, 1);
});

test("Don't know skips a group without inventing a preference, including an entirely skipped batch", async () => {
  const { service, inputs } = fixture();
  const first = await service.next("owner", "oli", {}, history, signal());
  const second = await service.next("owner", "oli", { sessionId: first.sessionId, choices: [1, null, 9, null] }, history, signal());
  assert.equal(inputs[1].preferences[0].preferred.id, 1);
  assert.equal(inputs[1].preferences[1].preferred, null);
  assert.deepEqual(inputs[1].preferences[1].alternatives.map(movie => movie.id), [5, 6, 7, 8]);
  const request = { sessionId: second.sessionId, choices: [null, null, null, null] };
  const third = await service.next("owner", "oli", request, history, signal());
  assert.equal(third.titles.length, 16);
  assert.ok(inputs[2].preferences.slice(-4).every(preference => preference.preferred === null && preference.alternatives.length === 4));
  assert.ok(third.titles.every(movie => ![...first.titles, ...second.titles].some(old => old.id === movie.id)));
  assert.deepEqual(await service.next("owner", "oli", request, history, signal()), third);
  assert.equal(inputs.length, 3);
});

test("failed refinement preserves choices and can be retried without leaking provider errors", async () => {
  const f = fixture();
  const first = await f.service.next("owner", undefined, {}, async () => [], signal());
  assert.deepEqual(f.inputs[0].recentWatchHistory, []);
  f.fail(true);
  await assert.rejects(f.service.next("owner", undefined, choose(first), history, signal()), error => error.status === 503 && !error.message.includes(secret));
  f.fail(false);
  const result = await f.service.next("owner", undefined, choose(first), history, signal());
  assert.equal(result.titles.length, 16);
  assert.equal(f.inputs.length, 5, "a transient outage receives two automatic retries before the user retries");
  assert.deepEqual(f.inputs[1], f.inputs.at(-1));
});

test("a failed refill keeps verified movies for the next manual retry", async () => {
  let calls = 0;
  const inputs = [];
  const service = new MovieDiscovery(async (_url, init) => {
    inputs.push(JSON.parse(JSON.parse(init.body).contents[0].parts[0].text));
    calls++;
    if (calls === 1) return answer(Array.from({ length: 16 }, (_, i) => movie(i + 1)));
    if (calls === 2) return answer(Array.from({ length: 12 }, (_, i) => movie(i + 17)));
    if (calls <= 5) return new Response(secret, { status: 503 });
    return answer(Array.from({ length: 4 }, (_, i) => movie(i + 29)));
  }, { browse: async (_kind, query) => ({ titles: [movie(Number(query.split(" ")[1]))] }) });
  const first = await service.next("owner", "oli", {}, history, signal());
  await assert.rejects(service.next("owner", "oli", choose(first), history, signal()), error => error.code === "discovery_unavailable");
  const second = await service.next("owner", "oli", choose(first), history, signal());
  assert.deepEqual(second.titles.map(movie => movie.id), Array.from({ length: 16 }, (_, i) => i + 17));
  assert.deepEqual(inputs.at(-1).alreadyShown.map(movie => movie.id), Array.from({ length: 28 }, (_, i) => i + 1));
  assert.deepEqual(inputs.at(-1).preferences, inputs[1].preferences);
  assert.equal(calls, 6);
});

test("a temporary provider failure retries automatically and a complete MAX_TOKENS payload is usable", async () => {
  let calls = 0;
  const service = new MovieDiscovery(async () => {
    if (++calls === 1) return new Response(secret, { status: 503 });
    return Response.json({ candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ thought: true, text: secret }, { text: JSON.stringify({ movies: Array.from({ length: 16 }, (_, i) => movie(i + 1)) }) }] } }] });
  }, { browse: async (_kind, query) => ({ titles: [movie(Number(query.split(" ")[1]))] }) });
  assert.equal((await service.next("owner", undefined, {}, history, signal())).titles.length, 16);
  assert.equal(calls, 2);
});

test("quota and configuration failures have distinct safe messages and are not immediately retried", async () => {
  for (const [status, code] of [[429, "discovery_quota"], [400, "discovery_configuration"], [403, "discovery_configuration"], [404, "discovery_configuration"]]) {
    let calls = 0;
    const service = new MovieDiscovery(async () => { calls++; return new Response(secret, { status }); });
    await assert.rejects(service.next("owner", undefined, {}, history, signal()), error => error.code === code && !error.message.includes(secret));
    assert.equal(calls, 1);
  }
});

test("shortfalls never silently replace Gemini selections with unrelated popular movies", async () => {
  let calls = 0;
  let catalogueCalls = 0;
  const service = new MovieDiscovery(async () => answer(++calls === 1 ? Array.from({ length: 15 }, (_, i) => movie(i + 1)) : []), {
    browse: async (_kind, query) => {
      if (query) return { titles: [movie(Number(query.split(" ")[1]))] };
      catalogueCalls++;
      return { titles: [movie(999), movie(1), { ...movie(1000), year: "9999" }, movie(1001)] };
    },
  });
  await assert.rejects(service.next("owner", undefined, {}, history, signal()), error => error.code === "discovery_shortfall");
  assert.equal(calls, 6);
  assert.equal(catalogueCalls, 0);
});

test("one-year release differences are accepted only for an unambiguous matching title", async () => {
  let calls = 0;
  const service = new MovieDiscovery(async () => answer(++calls === 1 ? Array.from({ length: 16 }, (_, i) => movie(i + 1)) : [movie(17)]), {
    browse: async (_kind, query) => {
      const id = Number(query.split(" ")[1]);
      if (id === 1) return { titles: [{ ...movie(1), year: "2021" }] };
      if (id === 2) return { titles: [{ ...movie(2), year: "2021" }, { ...movie(2), id: 2002, year: "2019" }] };
      return { titles: [movie(id)] };
    },
  });
  const result = await service.next("owner", undefined, {}, history, signal());
  assert.equal(result.titles.find(movie => movie.id === 1).year, "2021");
  assert.equal(result.titles.some(movie => [2, 2002].includes(movie.id)), false);
  assert.equal(result.titles.at(-1).id, 17);
});

test("real catalogue regressions: unrelated same-name releases do not reject the intended film", async () => {
  const cases = [
    { title: "Ex Machina", year: "2014", id: 264660, actualYear: "2015", others: ["2023", "2025"] },
    { title: "Coherence", year: "2013", id: 220289, actualYear: "2014", others: ["", "1981"] },
    { title: "Enemy", year: "2013", id: 181886, actualYear: "2014", others: ["2021", "1965"] },
    { title: "The Invisible Guest", year: "2016", id: 411088, actualYear: "2017", others: ["2023", "2026"] },
  ];
  let calls = 0;
  const service = new MovieDiscovery(async () => { calls++; return answer([...cases, ...Array.from({ length: 12 }, (_, i) => movie(i + 1))]); }, {
    browse: async (_kind, query) => {
      const row = cases.find(item => item.title === query);
      return { titles: row ? [{ ...movie(row.id), title: row.title, year: row.actualYear }, ...row.others.map((year, i) => ({ ...movie(row.id + i + 1), title: row.title, year }))] : [movie(Number(query.split(" ")[1]))] };
    },
  });
  const result = await service.next("owner", undefined, {}, history, signal());
  assert.equal(calls, 1, "all sixteen actual movie identities resolve on the first pass");
  assert.deepEqual(result.titles.slice(0, 4).map(title => title.id), cases.map(row => row.id));
});

test("TMDB original and alternative titles resolve canonical names without accepting unrelated search hits", async () => {
  const aliases = [
    { query: "12 Monkeys", id: 63, title: "Twelve Monkeys", year: "1995", originalTitle: "Twelve Monkeys", alternativeTitles: ["12 Monkeys"] },
    { query: "Paddington 3", id: 516729, title: "Paddington in Peru", year: "2024", originalTitle: "Paddington in Peru", alternativeTitles: ["Paddington 3"] },
    { query: "La vita è bella", id: 637, title: "Life Is Beautiful", year: "1997", originalTitle: "La vita è bella", alternativeTitles: [] },
  ];
  const detailsCalls = [];
  let calls = 0;
  const service = new MovieDiscovery(async () => answer(++calls === 1 ? [...Array.from({ length: 12 }, (_, i) => movie(i + 1)), ...aliases.map(row => ({ title: row.query, year: row.year })), { title: "Unknown film", year: "2020" }] : [movie(50)]), {
    browse: async (_kind, query) => {
      const row = aliases.find(item => item.query === query);
      if (row) return { titles: [{ ...movie(row.id), title: row.title, year: row.year }] };
      return { titles: [movie(query === "Unknown film" ? 9998 : Number(query.split(" ")[1]))] };
    },
    details: async (_kind, id) => { detailsCalls.push(id); return { ...movie(id), originalTitle: "Unrelated", alternativeTitles: [], ...aliases.find(row => row.id === id) }; },
  });
  const result = await service.next("owner", undefined, {}, history, signal());
  assert.ok(aliases.every(row => result.titles.some(title => title.id === row.id && title.title === row.title)));
  assert.equal(result.titles.some(title => title.id === 9998), false, "a matching year alone never proves identity");
  assert.equal(result.titles.at(-1).id, 50);
  assert.deepEqual(detailsCalls.sort((a, b) => a - b), [63, 637, 9998, 516729]);
});

test("refills request only missing movies and explain unresolvable suggestions to Gemini", async () => {
  let calls = 0;
  const service = new MovieDiscovery(async (_url, init) => {
    const body = JSON.parse(init.body);
    if (++calls === 1) return answer([...Array.from({ length: 14 }, (_, i) => movie(i + 1)), movie(999), { title: "Unresolvable title", year: "2020" }]);
    const input = JSON.parse(body.contents[0].parts[0].text);
    assert.equal(input.requestedCount, 1);
    assert.deepEqual(input.alreadyShown.map(title => title.id), [...Array.from({ length: 14 }, (_, i) => i + 1), 999]);
    assert.equal(body.contents[1].role, "model");
    const correction = body.contents.at(-1).parts.map(part => part.text).join("\n");
    assert.match(correction, /title_not_found/);
    assert.match(correction, /Watched film \(2001\)/);
    return answer([movie(15)]);
  }, { browse: async (_kind, query) => ({ titles: query === "Unresolvable title" ? [] : [movie(Number(query.split(" ")[1]))] }) });
  assert.equal((await service.next("owner", undefined, {}, history, signal())).titles.length, 16);
  assert.equal(calls, 2);
});

test("leaving discovery cancels the retry delay without making another provider call", async () => {
  const controller = new AbortController();
  let calls = 0;
  const service = new MovieDiscovery(async () => {
    calls++;
    setTimeout(() => controller.abort(), 20);
    return new Response(null, { status: 503 });
  });
  await assert.rejects(service.next("owner", undefined, {}, history, controller.signal), error => error.name === "AbortError");
  assert.equal(calls, 1);
});

test("provider timeouts and catalogue outages report the actual failure category", async () => {
  const timeout = new MovieDiscovery(async () => { throw new MediaError("timeout", secret, 504); });
  await assert.rejects(timeout.next("owner", undefined, {}, history, signal()), error => error.code === "discovery_timeout" && error.status === 504 && !error.message.includes(secret));
  const catalogue = new MovieDiscovery(async () => answer([movie(1)]), { browse: async () => { throw new Error(secret); } });
  await assert.rejects(catalogue.next("owner", undefined, {}, history, signal()), error => error.code === "discovery_metadata" && !error.message.includes(secret));
});

test("duplicates and watched movies pass while invalid and wrong-year titles still require a refill", async () => {
  let calls = 0;
  const service = new MovieDiscovery(async () => answer(++calls === 1
    ? [movie(999), movie(1), movie(1), movie(2), { title: secret, year: "2020" }, { title: "Invalid", year: "unknown" }]
    : Array.from({ length: 16 }, (_, i) => movie(i + 10))), {
    browse: async (_kind, query) => { const title = movie(Number(query.split(" ")[1])); return { titles: [{ ...title, year: title.id === 2 ? "1999" : "2020" }] }; },
  });
  const result = await service.next("owner", undefined, {}, history, signal());
  assert.equal(calls, 2);
  assert.equal(result.titles.length, 16);
  assert.deepEqual(result.titles.slice(0, 3).map(title => title.id), [999, 1, 1]);
  assert.ok(result.titles.every(title => title.id !== 2));
});

test("repeats within and across batches pass without retrying and retain choices and exclusions", async () => {
  const inputs = [];
  const service = new MovieDiscovery(async (_url, init) => {
    inputs.push(JSON.parse(JSON.parse(init.body).contents[0].parts[0].text));
    return answer(Array.from({ length: 16 }, () => movie(1)));
  }, { browse: async () => ({ titles: [movie(1)] }) });
  const first = await service.next("owner", "oli", {}, history, signal());
  const second = await service.next("owner", "oli", choose(first), history, signal());
  assert.deepEqual(first.titles.map(title => title.id), Array(16).fill(1));
  assert.deepEqual(second.titles, first.titles);
  assert.equal(inputs.length, 2, "repeated movies do not trigger replacement requests");
  assert.equal(inputs[0].requestedCount, 16);
  assert.equal(inputs[1].requestedCount, 16);
  assert.ok(inputs[1].preferences.every(preference => preference.preferred.id === 1));
  assert.deepEqual(inputs[1].alreadyShown.map(title => title.id), Array(16).fill(1));
  assert.deepEqual(await service.next("owner", "oli", choose(first), history, signal()), second);
  assert.equal(inputs.length, 2);
});

test("a refill may repeat an accepted movie to complete all sixteen slots", async () => {
  let calls = 0;
  const service = new MovieDiscovery(async (_url, init) => {
    const input = JSON.parse(JSON.parse(init.body).contents[0].parts[0].text);
    assert.equal(input.requestedCount, calls === 0 ? 16 : 1);
    return answer(++calls === 1 ? Array.from({ length: 15 }, (_, i) => movie(i + 1)) : [movie(1)]);
  }, { browse: async (_kind, query) => ({ titles: [movie(Number(query.split(" ")[1]))] }) });
  const result = await service.next("owner", undefined, {}, history, signal());
  assert.deepEqual(result.titles.map(title => title.id), [...Array.from({ length: 15 }, (_, i) => i + 1), 1]);
  assert.equal(calls, 2);
});

test("malformed model output and insufficient metadata fail cleanly; missing configuration makes no calls", async () => {
  for (const response of [() => answer([]), () => Response.json({ candidates: [{ finishReason: "MAX_TOKENS" }] }), () => new Response("invalid JSON")]) {
    const service = new MovieDiscovery(async () => response(), { browse: async () => ({ titles: [] }) });
    await assert.rejects(service.next("owner", undefined, {}, history, signal()), error => error.status === 503);
  }
  delete process.env.GEMINI_API_KEY;
  try {
    await assert.rejects(new MovieDiscovery(async () => assert.fail("No upstream request expected")).next("owner", undefined, {}, history, signal()), error => error.status === 503);
  } finally { process.env.GEMINI_API_KEY = secret; }
});

test("discovery API works without MongoDB and requires an authenticated same-origin POST", async () => {
  Object.assign(process.env, { MEDIA_TRUSTED_NETWORK: "true", MEDIA_ALLOWED_ORIGINS: "http://discovery.test", MEDIA_SESSION_SECRET: secret, TMDB_READ_ACCESS_TOKEN: secret });
  delete process.env.MONGODB_URI;
  const api = createMediaApi(async (input) => {
    const url = new URL(input);
    if (url.hostname === "generativelanguage.googleapis.com") return answer(Array.from({ length: 16 }, (_, i) => movie(i + 1)));
    const id = Number(url.searchParams.get("query").split(" ")[1]);
    return Response.json({ results: [{ id, title: `Film ${id}`, release_date: "2020-01-01" }] });
  });
  const status = await api(new Request("http://discovery.test/api/media/status"));
  assert.equal((await status.json()).discovery, true);
  const headers = { cookie: status.headers.get("set-cookie").split(";")[0], Origin: "http://discovery.test", "Content-Type": "application/json", "X-Media-Request": "1", "X-Media-Profile": "oli" };
  assert.equal((await api(new Request("http://discovery.test/api/media/discovery", { method: "POST", headers: { ...headers, cookie: "" }, body: "{}" }))).status, 401);
  assert.equal((await api(new Request("http://discovery.test/api/media/discovery", { method: "POST", headers: { ...headers, Origin: "http://other.test" }, body: "{}" }))).status, 403);
  const response = await api(new Request("http://discovery.test/api/media/discovery", { method: "POST", headers, body: "{}" }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).titles.length, 16);
});

test("the overall discovery deadline returns a timeout response instead of an invalid-request error", async () => {
  Object.assign(process.env, { MEDIA_TRUSTED_NETWORK: "true", MEDIA_ALLOWED_ORIGINS: "http://discovery.test", MEDIA_SESSION_SECRET: secret, TMDB_READ_ACCESS_TOKEN: secret });
  delete process.env.MONGODB_URI;
  const nativeTimeout = AbortSignal.timeout;
  AbortSignal.timeout = milliseconds => nativeTimeout(milliseconds === 120000 ? 25 : milliseconds);
  // Native AbortSignal timers do not keep Node alive by themselves.
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    const api = createMediaApi(async (_url, init) => new Promise((_resolve, reject) => {
      if (init.signal.aborted) reject(init.signal.reason);
      else init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
    }));
    const status = await api(new Request("http://discovery.test/api/media/status"));
    const response = await api(new Request("http://discovery.test/api/media/discovery", { method: "POST", body: "{}", headers: { cookie: status.headers.get("set-cookie").split(";")[0], Origin: "http://discovery.test", "Content-Type": "application/json", "X-Media-Request": "1" } }));
    assert.equal(response.status, 504);
    assert.equal((await response.json()).code, "discovery_timeout");
  } finally { AbortSignal.timeout = nativeTimeout; clearTimeout(keepAlive); }
});
