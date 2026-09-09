// Test-process injection only. Production adapters always use TMDB's official origin.
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.origin === 'https://api.themoviedb.org') {
    return nativeFetch(new URL(url.pathname + url.search, process.env.TV_TEST_UPSTREAM), init);
  }
  return nativeFetch(input, init);
};
