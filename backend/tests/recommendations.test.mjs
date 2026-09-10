import assert from "node:assert/strict";
import test from "node:test";
import { MediaRecommendations, RECOMMENDATION_COUNT, RECOMMENDATION_MODEL } from "../src/lib/media/recommendations.ts";

const secret = "test-only-recommendation-canary";
const signal = () => new AbortController().signal;
const history = Array.from({ length: 30 }, (_, index) => ({
  playbackId: `playback-${index}`,
  kind: index % 2 ? "tv" : "movie",
  tmdbId: 1000 + index,
  title: `Watched ${index}`,
  year: "2020",
  poster: null,
  query: `Watched ${index}`,
  filePath: `private/path/${index}.mkv`,
  ...(index % 2 ? { season: 1, episode: index + 1 } : {}),
}));
const suggestions = Array.from({ length: RECOMMENDATION_COUNT }, (_, index) => ({ kind: index % 2 ? "tv" : "movie", title: `Suggested ${index}`, year: "2024" }));
const answer = () => Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ recommendations: suggestions }) }] } }] });

test("Gemini receives only the latest 25 watch records and recommendations resolve through TMDB", async () => {
  const previous = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = secret;
  let calls = 0;
  const searches = [];
  const fetcher = async (url, init) => {
    calls++;
    assert.equal(url, `https://generativelanguage.googleapis.com/v1beta/models/${RECOMMENDATION_MODEL}:generateContent`);
    assert.equal(new Headers(init.headers).get("x-goog-api-key"), secret);
    assert.equal(init.redirect, "manual");
    const body = JSON.parse(init.body);
    assert.equal(body.generationConfig.thinkingConfig, undefined);
    assert.equal(body.generationConfig.responseJsonSchema.properties.recommendations.minItems, undefined);
    assert.equal(body.generationConfig.responseJsonSchema.properties.recommendations.maxItems, undefined);
    const input = JSON.parse(body.contents[0].parts[0].text).recentWatchHistory;
    assert.equal(input.length, 25);
    assert.deepEqual(input[0], { kind: "movie", tmdbId: 1000, title: "Watched 0", year: "2020" });
    assert.equal(init.body.includes("private/path"), false);
    assert.equal(init.body.includes(secret), false);
    return answer();
  };
  const tmdb = { browse: async (kind, query) => {
    searches.push([kind, query]);
    const index = Number(query.split(" ")[1]);
    // The first suggestion resolves to a watched title and the last duplicates another.
    const id = index === 0 ? 1000 : index === RECOMMENDATION_COUNT - 1 ? 2001 : 2000 + index;
    return { titles: [{ id, kind, title: index === RECOMMENDATION_COUNT - 1 ? "Suggested 1" : query, year: "2024", overview: "Resolved", poster: null }] };
  } };
  try {
    const service = new MediaRecommendations(fetcher, tmdb);
    const result = await service.get(history, signal());
    assert.equal(result.provider, "gemini");
    assert.equal(result.basedOn, 25);
    assert.equal(result.titles.length, RECOMMENDATION_COUNT - 2);
    assert.equal(result.titles.some(title => title.id === 1000), false);
    assert.equal(new Set(result.titles.map(title => `${title.kind}/${title.id}`)).size, RECOMMENDATION_COUNT - 2);
    assert.equal(searches.length, RECOMMENDATION_COUNT);
    await service.get(history, signal());
    assert.equal(calls, 1, "an unchanged history uses the cached recommendation set");
  } finally {
    if (previous === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previous;
  }
});

test("missing Gemini configuration or empty history avoids upstream calls", async () => {
  const previous = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const service = new MediaRecommendations(async () => assert.fail("Gemini should not be called"), { browse: async () => assert.fail("TMDB should not be called") });
    assert.deepEqual(await service.get(history, signal()), { provider: "gemini", basedOn: 25, titles: [] });
    process.env.GEMINI_API_KEY = secret;
    assert.deepEqual(await service.get([], signal()), { provider: "gemini", basedOn: 0, titles: [] });
  } finally {
    if (previous === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previous;
  }
});

test("a partial Gemini response still returns every recommendation that can be resolved", async () => {
  const previous = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = secret;
  const partial = [
    { kind: "movie", title: "Valid film", year: "2024" },
    { kind: "movie", title: "Missing year" },
    { kind: "tv", title: "Valid show", year: "2023" },
  ];
  const fetcher = async () => Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ recommendations: partial }) }] } }] });
  const tmdb = { browse: async (kind, query) => ({ titles: [{ id: query === "Valid film" ? 9001 : 9002, kind, title: query, year: query === "Valid film" ? "2024" : "2023", overview: "Resolved", poster: null }] }) };
  try {
    const result = await new MediaRecommendations(fetcher, tmdb).get(history, signal());
    assert.deepEqual(result.titles.map(title => title.title), ["Valid film", "Valid show"]);
  } finally {
    if (previous === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previous;
  }
});
