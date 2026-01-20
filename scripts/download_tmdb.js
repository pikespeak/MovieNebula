#!/usr/bin/env node

const fs = require('fs/promises');
const path = require('path');

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const DEFAULT_MAX_MOVIES = 100;

const parseArgs = (argv) =>
  argv.reduce((acc, arg) => {
    const [key, value] = arg.split('=');
    if (key.startsWith('--')) {
      acc[key.slice(2)] = value ?? true;
    }
    return acc;
  }, {});

const resolveConfig = (argv = process.argv.slice(2), env = process.env) => {
  const argMap = parseArgs(argv);
  const apiKey = env.TMDB_API_KEY;
  const accessToken = env.TMDB_ACCESS_TOKEN;
  if (!apiKey && !accessToken) {
    throw new Error('Missing TMDB_API_KEY or TMDB_ACCESS_TOKEN environment variable.');
  }

  const pagesRaw = Number(argMap.pages ?? 1);
  const pages = Number.isNaN(pagesRaw) || pagesRaw < 1 ? 1 : pagesRaw;
  const outputPath = argMap.output ?? 'data/movies.json';

  return {
    apiKey,
    accessToken,
    pages,
    outputPath,
    maxMovies: DEFAULT_MAX_MOVIES,
  };
};

const buildUrl = (url, apiKey, accessToken) => {
  if (accessToken) {
    return url;
  }
  const apiUrl = new URL(url);
  apiUrl.searchParams.set('api_key', apiKey);
  return apiUrl.toString();
};

const fetchJson = async (url, { apiKey, accessToken, fetchFn = fetch }) => {
  const response = await fetchFn(buildUrl(url, apiKey, accessToken), {
    headers: {
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      'Content-Type': 'application/json;charset=utf-8',
    },
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`TMDB request failed (${response.status}): ${message}`);
  }

  return response.json();
};

const getDiscoverPage = async (page, options) => {
  const url = new URL(`${TMDB_BASE_URL}/discover/movie`);
  url.searchParams.set('include_adult', 'false');
  url.searchParams.set('include_video', 'false');
  url.searchParams.set('language', 'en-US');
  url.searchParams.set('page', String(page));
  url.searchParams.set('sort_by', 'popularity.desc');
  return fetchJson(url.toString(), options);
};

const getMovieDetails = async (movieId, options) => {
  const detailsUrl = `${TMDB_BASE_URL}/movie/${movieId}?language=en-US`;
  const creditsUrl = `${TMDB_BASE_URL}/movie/${movieId}/credits?language=en-US`;

  const [details, credits] = await Promise.all([
    fetchJson(detailsUrl, options),
    fetchJson(creditsUrl, options),
  ]);

  return {
    id: details.id,
    title: details.title,
    release_date: details.release_date,
    runtime: details.runtime,
    genres: details.genres?.map((genre) => ({ id: genre.id, name: genre.name })) ?? [],
    cast: credits.cast?.slice(0, 1).map((person) => ({
      id: person.id,
      name: person.name,
      character: person.character,
    })) ?? [],
    crew: credits.crew?.filter((person) => person.job === 'Director').map((person) => ({
      id: person.id,
      name: person.name,
      job: person.job,
    })) ?? [],
  };
};

const buildDataset = async ({ pages, maxMovies, apiKey, accessToken, fetchFn }) => {
  const options = { apiKey, accessToken, fetchFn };
  const movies = [];
  const seenMovieIds = new Set();

  for (let page = 1; page <= pages; page += 1) {
    console.log(`Fetching page ${page}/${pages}...`);
    const discover = await getDiscoverPage(page, options);

    for (const movie of discover.results ?? []) {
      if (movies.length >= maxMovies) break;
      if (seenMovieIds.has(movie.id)) continue;
      seenMovieIds.add(movie.id);
      console.log(`Fetching details for ${movie.title} (${movie.id})`);
      const details = await getMovieDetails(movie.id, options);
      movies.push(details);
    }

    if (movies.length >= maxMovies) break;
  }

  return {
    fetched_at: new Date().toISOString(),
    source: 'TMDB',
    movies,
  };
};

const writeDataset = async ({ outputPath, dataset, fsPromises = fs }) => {
  const resolvedPath = path.resolve(outputPath);
  await fsPromises.mkdir(path.dirname(resolvedPath), { recursive: true });
  await fsPromises.writeFile(resolvedPath, JSON.stringify(dataset, null, 2), 'utf8');
  return resolvedPath;
};

const runDownloader = async ({ argv, env, fetchFn, fsPromises } = {}) => {
  const config = resolveConfig(argv, env);
  const dataset = await buildDataset({ ...config, fetchFn });
  const resolvedPath = await writeDataset({
    outputPath: config.outputPath,
    dataset,
    fsPromises,
  });
  console.log(`Saved ${dataset.movies.length} movies to ${resolvedPath}`);
  return { resolvedPath, movies: dataset.movies.length };
};

const runCli = async () => {
  try {
    await runDownloader();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
};

if (require.main === module) {
  runCli();
}

module.exports = {
  parseArgs,
  resolveConfig,
  buildUrl,
  fetchJson,
  getDiscoverPage,
  getMovieDetails,
  buildDataset,
  writeDataset,
  runDownloader,
};
