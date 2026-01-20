const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveConfig, buildUrl, buildDataset } = require('./download_tmdb');

const createFetchMock = () => {
  const calls = [];
  const fetchFn = async (url) => {
    calls.push(url);

    if (url.includes('/keywords')) {
      throw new Error('Unexpected keywords fetch');
    }

    if (url.includes('/discover/movie')) {
      const page = Number(new URL(url).searchParams.get('page'));
      const results = Array.from({ length: 60 }, (_, index) => {
        const id = page * 1000 + index;
        return { id, title: `Movie ${id}` };
      });
      return { ok: true, json: async () => ({ results }) };
    }

    if (url.includes('/credits')) {
      const id = Number(url.match(/movie\/(\d+)/)?.[1]);
      return {
        ok: true,
        json: async () => ({
          cast: [
            { id: id + 1, name: `Actor ${id}`, character: 'Lead' },
            { id: id + 2, name: 'Extra', character: 'Extra' },
          ],
          crew: [
            { id: 10, name: 'Director', job: 'Director' },
            { id: 11, name: 'Writer', job: 'Writer' },
          ],
        }),
      };
    }

    if (url.includes('/movie/')) {
      const id = Number(url.match(/movie\/(\d+)/)?.[1]);
      return {
        ok: true,
        json: async () => ({
          id,
          title: `Movie ${id}`,
          release_date: '2020-01-01',
          runtime: 120,
          genres: [{ id: 1, name: 'Drama' }],
        }),
      };
    }

    return {
      ok: false,
      status: 404,
      text: async () => 'Not found',
    };
  };

  return { fetchFn, calls };
};

test('resolveConfig throws without auth', () => {
  assert.throws(
    () => resolveConfig([], {}),
    /Missing TMDB_API_KEY or TMDB_ACCESS_TOKEN/,
  );
});

test('buildUrl adds api key when no access token is present', () => {
  const url = buildUrl('https://api.themoviedb.org/3/discover/movie', 'abc', null);
  assert.ok(url.includes('api_key=abc'));
});

test('buildDataset caps movies and skips keywords', async () => {
  const { fetchFn, calls } = createFetchMock();
  const dataset = await buildDataset({
    pages: 3,
    maxMovies: 100,
    apiKey: 'key',
    accessToken: null,
    fetchFn,
  });

  assert.equal(dataset.movies.length, 100);
  assert.ok(dataset.movies.every((movie) => movie.cast.length === 1));
  assert.ok(dataset.movies.every((movie) => !('keywords' in movie)));
  assert.ok(calls.every((url) => !url.includes('/keywords')));
});
