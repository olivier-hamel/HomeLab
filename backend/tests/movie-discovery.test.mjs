import assert from "node:assert/strict";
import test from "node:test";
import { MovieDiscovery } from "../src/lib/media/movie-discovery.ts";
import { createMediaApi } from "../src/lib/media/api.ts";
import { MediaError } from "../src/lib/media/core.ts";

const secret = "discovery-test-only-secret-not-for-production";
process.env.GEMINI_API_KEY = secret;
const signal = () => new AbortController().signal;
const history = async () => [{ kind: "movie", tmdbId: 999, title: "Watched film", year: "2001", filePath: "private/path.mkv" }];
const movie = id => ({ id, kind: "movie", title: "Film " + id, year: "2020", overview: "Movie description", poster: null });
const batchMovies = (offset = 0, length = 16) => Array.from({ length }, (_, i) => movie(offset + i + 1));
const answer = movies => Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ movies }) }] } }] });
const browse = async (_kind, query) => ({ titles: [movie(Number(query.split(" ")[1]))] });
const choose = batch => ({ sessionId: batch.sessionId, choices: batch.titles.filter((_, i) => i % 4 === 0).map(title => title.id) });
function requestInput(init) {
  const body = JSON.parse(init.body);
  assert.equal(new Headers(init.headers).get("x-goog-api-key"), secret);
  assert.equal(init.body.includes(secret), false);
  assert.equal(init.body.includes("private/path"), false);
  assert.equal(body.contents.length, 1, "one fresh request, without model/retry transcripts");
  assert.equal(body.contents[0].role, "user");
  assert.equal(body.contents[0].parts.length, 1);
  const input = JSON.parse(body.contents[0].parts[0].text);
  assert.deepEqual(Object.keys(input).sort(), ["alreadyProposed", "interested"]);
  return input;
}
function fixture() {
  const inputs = [];
  let failed = false;
  let batchNumber = 0;
  const service = new MovieDiscovery(async (_url, init) => {
    inputs.push(requestInput(init));
    if (failed) return new Response(secret, { status: 503 });
    return answer(batchMovies(batchNumber++ * 16));
  }, { browse });
  return { service, inputs, fail: value => { failed = value; } };
}

test("two lists retain watched interests, picks and all neutral alternatives across rounds", async () => {
  const { service, inputs } = fixture();
  const first = await service.next("owner", "oli", {}, history, signal());
  assert.equal(first.titles.length, 16);
  assert.deepEqual(inputs[0], { interested: [{ id: 999, title: "Watched film", year: "2001" }], alreadyProposed: [] });
  const second = await service.next("owner", "oli", choose(first), history, signal());
  assert.deepEqual(inputs[1].interested.map(movie => movie.id), [999, 1, 5, 9, 13]);
  assert.deepEqual(inputs[1].alreadyProposed.map(movie => movie.id), [2, 3, 4, 6, 7, 8, 10, 11, 12, 14, 15, 16]);
  assert.deepEqual(await service.next("owner", "oli", choose(first), history, signal()), second);
  assert.equal(inputs.length, 2, "successful resubmissions do not spend another request");
  await service.next("owner", "oli", choose(second), history, signal());
  assert.deepEqual(inputs[2].interested.map(movie => movie.id), [999, 1, 5, 9, 13, 17, 21, 25, 29]);
  assert.equal(inputs[2].alreadyProposed.length, 24);
});

test("skips add only neutral proposed movies and retain earlier interests", async () => {
  const { service, inputs } = fixture();
  const first = await service.next("owner", "oli", {}, history, signal());
  const second = await service.next("owner", "oli", { sessionId: first.sessionId, choices: [1, null, 9, null] }, history, signal());
  assert.deepEqual(inputs[1].interested.map(movie => movie.id), [999, 1, 9]);
  assert.deepEqual(inputs[1].alreadyProposed.map(movie => movie.id), [2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16]);
  await service.next("owner", "oli", { sessionId: second.sessionId, choices: [null, null, null, null] }, history, signal());
  assert.deepEqual(inputs[2].interested, inputs[1].interested);
  assert.equal(inputs[2].alreadyProposed.length, 30);
});

test("only the latest 25 watched movies seed interests, without TV or private metadata", async () => {
  const { service, inputs } = fixture();
  await service.next("owner", undefined, {}, async () => [
    { kind: "tv", tmdbId: 5000, title: "TV show", year: "2020" },
    ...Array.from({ length: 30 }, (_, i) => ({ kind: "movie", tmdbId: 1000 + i, title: "Watched " + i, year: "2020", filePath: "private/path.mkv" })),
  ], signal());
  assert.deepEqual(inputs[0].interested.map(movie => movie.id), Array.from({ length: 25 }, (_, i) => i + 1000));
  assert.deepEqual(inputs[0].alreadyProposed, []);
});

test("history outages leave two empty lists and do not prevent discovery", async () => {
  const { service, inputs } = fixture();
  const batch = await service.next("owner", undefined, {}, async () => { throw new Error("Database unavailable"); }, signal());
  assert.equal(batch.titles.length, 16);
  assert.deepEqual(inputs[0], { interested: [], alreadyProposed: [] });
});

test("both lists retain the complete session beyond the former history caps", async () => {
  const { service, inputs } = fixture();
  let batch = await service.next("owner", undefined, {}, history, signal());
  for (let round = 0; round < 33; round++) batch = await service.next("owner", undefined, choose(batch), history, signal());
  const latest = inputs.at(-1);
  assert.equal(latest.interested.length, 133);
  assert.equal(latest.alreadyProposed.length, 396);
  const ids = [...latest.interested, ...latest.alreadyProposed].map(movie => movie.id);
  assert.ok(Array.from({ length: 528 }, (_, i) => i + 1).every(id => ids.includes(id)));
  assert.equal(new Set(ids).size, 529);
});

test("a repeated suggestion picked later moves from proposed to interested", async () => {
  const inputs = [];
  const service = new MovieDiscovery(async (_url, init) => { inputs.push(requestInput(init)); return answer(batchMovies()); }, { browse });
  const first = await service.next("owner", undefined, {}, history, signal());
  const second = await service.next("owner", undefined, { sessionId: first.sessionId, choices: [null, null, null, null] }, history, signal());
  await service.next("owner", undefined, { sessionId: second.sessionId, choices: [1, null, null, null] }, history, signal());
  assert.deepEqual(inputs[2].interested.map(movie => movie.id), [999, 1]);
  assert.deepEqual(inputs[2].alreadyProposed.map(movie => movie.id), Array.from({ length: 15 }, (_, i) => i + 2));
});

test("provider failures make one call, preserve choices and allow a manual retry", async () => {
  const f = fixture();
  const first = await f.service.next("owner", undefined, {}, async () => [], signal());
  f.fail(true);
  await assert.rejects(f.service.next("owner", undefined, choose(first), history, signal()), error => error.code === "discovery_unavailable" && !error.message.includes(secret));
  assert.equal(f.inputs.length, 2);
  f.fail(false);
  assert.equal((await f.service.next("owner", undefined, choose(first), history, signal())).titles.length, 16);
  assert.equal(f.inputs.length, 3);
  assert.deepEqual(f.inputs[1], f.inputs[2]);
});

test("short responses and catalogue failures are never merged with manual retries", async () => {
  for (const failure of ["short", "catalogue"]) {
    const inputs = [];
    let calls = 0;
    const service = new MovieDiscovery(async (_url, init) => {
      inputs.push(requestInput(init));
      calls++;
      return answer(batchMovies((calls - 1) * 16, calls === 2 && failure === "short" ? 12 : 16));
    }, { browse: async (kind, query) => {
      assert.ok(query, "no random catalogue fillers");
      return failure === "catalogue" && query === "Film 32" ? { titles: [] } : browse(kind, query);
    } });
    const first = await service.next("owner", "oli", {}, history, signal());
    await assert.rejects(service.next("owner", "oli", choose(first), history, signal()), error => error.code === (failure === "short" ? "discovery_response" : "discovery_shortfall"));
    assert.equal(calls, 2, "no automatic replacement request");
    const second = await service.next("owner", "oli", choose(first), history, signal());
    assert.deepEqual(second.titles.map(movie => movie.id), batchMovies(32).map(movie => movie.id));
    assert.deepEqual(inputs[2], inputs[1], "unshown partial movies do not enter either list");
    assert.equal(calls, 3);
  }
});

test("duplicates and watched movies still pass as one complete model response", async () => {
  const inputs = [];
  const repeated = [movie(999), ...Array(15).fill(movie(1))];
  const service = new MovieDiscovery(async (_url, init) => { inputs.push(requestInput(init)); return answer(repeated); }, { browse });
  const first = await service.next("owner", undefined, {}, history, signal());
  assert.deepEqual(first.titles, repeated);
  const second = await service.next("owner", undefined, choose(first), history, signal());
  assert.deepEqual(second.titles, repeated);
  assert.equal(inputs.length, 2);
  assert.deepEqual(inputs[1].interested.map(movie => movie.id), [999, 1]);
  assert.deepEqual(inputs[1].alreadyProposed, []);
});

test("complete MAX_TOKENS output is usable and thought parts are ignored", async () => {
  const service = new MovieDiscovery(async () => Response.json({ candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ thought: true, text: secret }, { text: JSON.stringify({ movies: batchMovies() }) }] } }] }), { browse });
  assert.equal((await service.next("owner", undefined, {}, history, signal())).titles.length, 16);
});

test("wrong counts and invalid movie fields fail without a refill or catalogue request", async () => {
  for (const movies of [batchMovies(0, 15), batchMovies(0, 17), [...batchMovies(0, 15), { title: secret, year: "2020" }], [...batchMovies(0, 15), { title: "Film", year: "unknown" }]]) {
    let calls = 0;
    const service = new MovieDiscovery(async () => { calls++; return answer(movies); }, { browse: async () => assert.fail("Invalid responses must not reach TMDB") });
    await assert.rejects(service.next("owner", undefined, {}, history, signal()), error => error.code === "discovery_response");
    assert.equal(calls, 1);
  }
});

test("one-year release differences require an unambiguous match", async () => {
  for (const ambiguous of [false, true]) {
    const service = new MovieDiscovery(async () => answer(batchMovies()), { browse: async (kind, query) => query === "Film 1"
      ? { titles: [{ ...movie(1), year: "2021" }, ...(ambiguous ? [{ ...movie(2001), title: "Film 1", year: "2019" }] : [])] }
      : browse(kind, query) });
    if (ambiguous) await assert.rejects(service.next("owner", undefined, {}, history, signal()), error => error.code === "discovery_shortfall");
    else assert.equal((await service.next("owner", undefined, {}, history, signal())).titles[0].year, "2021");
  }
});

test("unrelated catalogue hits cannot stand in for the requested movie", async () => {
  const service = new MovieDiscovery(async () => answer(batchMovies()), {
    browse: async () => ({ titles: [movie(9998)] }),
    details: async () => ({ ...movie(9998), originalTitle: "Unrelated", alternativeTitles: [] }),
  });
  await assert.rejects(service.next("owner", undefined, {}, history, signal()), error => error.code === "discovery_shortfall");
});

test("cancellation and provider/catalogue failures keep their error categories", async () => {
  const controller = new AbortController();
  let calls = 0;
  const cancelled = new MovieDiscovery(async (_url, init) => { calls++; controller.abort(); init.signal.throwIfAborted(); });
  await assert.rejects(cancelled.next("owner", undefined, {}, history, controller.signal), error => error.name === "AbortError");
  assert.equal(calls, 1);
  const timeout = new MovieDiscovery(async () => { throw new MediaError("timeout", secret, 504); });
  await assert.rejects(timeout.next("owner", undefined, {}, history, signal()), error => error.code === "discovery_timeout" && error.status === 504);
  const catalogue = new MovieDiscovery(async () => answer(batchMovies()), { browse: async () => { throw new Error(secret); } });
  await assert.rejects(catalogue.next("owner", undefined, {}, history, signal()), error => error.code === "discovery_metadata" && !error.message.includes(secret));
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


test("quota and configuration failures have distinct safe messages and are not immediately retried", async () => {
  for (const [status, code] of [[429, "discovery_quota"], [400, "discovery_configuration"], [403, "discovery_configuration"], [404, "discovery_configuration"]]) {
    let calls = 0;
    const service = new MovieDiscovery(async () => { calls++; return new Response(secret, { status }); });
    await assert.rejects(service.next("owner", undefined, {}, history, signal()), error => error.code === code && !error.message.includes(secret));
    assert.equal(calls, 1);
  }
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
  const service = new MovieDiscovery(async () => answer([...batchMovies(0, 13), ...aliases.map(row => ({ title: row.query, year: row.year }))]), {
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
  assert.deepEqual(detailsCalls.sort((a, b) => a - b), [63, 637, 516729]);
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
