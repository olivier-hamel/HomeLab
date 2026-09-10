import test from "node:test";
import assert from "node:assert/strict";
import { completedPlayback, mongoUri } from "../src/lib/media/progress-store.ts";

test("MongoDB credential placeholders are encoded without exposing raw credentials", () => {
  const previous = { uri: process.env.MONGODB_URI, username: process.env.MONGODB_USERNAME, password: process.env.MONGODB_PASSWORD };
  try {
    process.env.MONGODB_URI = "mongodb+srv://<db_username>:<db_password>@example.invalid/?appName=HomeLab";
    process.env.MONGODB_USERNAME = "home user";
    process.env.MONGODB_PASSWORD = "p@ss/word";
    assert.equal(mongoUri(), "mongodb+srv://home%20user:p%40ss%2Fword@example.invalid/?appName=HomeLab");
  } finally {
    if (previous.uri === undefined) delete process.env.MONGODB_URI; else process.env.MONGODB_URI = previous.uri;
    if (previous.username === undefined) delete process.env.MONGODB_USERNAME; else process.env.MONGODB_USERNAME = previous.username;
    if (previous.password === undefined) delete process.env.MONGODB_PASSWORD; else process.env.MONGODB_PASSWORD = previous.password;
  }
});

test("movies leave Continue Watching near the end", () => {
  assert.equal(completedPlayback(100, 7200), false);
  assert.equal(completedPlayback(6840, 7200), true);
  assert.equal(completedPlayback(7081, 7200), true);
});
