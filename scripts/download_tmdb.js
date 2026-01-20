#!/usr/bin/env node

const fs = require('fs/promises');
const path = require('path');

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

const args = process.argv.slice(2);
const argMap = args.reduce((acc, arg) => {
  const [key, value] = arg.split('=');
  if (key.startsWith('--')) {
    acc[key.slice(2)] = value ?? true;
  }
  return acc;
}, {});

const apiKey = process.env.TMDB_API_KEY;
const accessToken = process.env.TMDB_ACCESS_TOKEN;
if (!apiKey && !accessToken) {
  console.error('Missing TMDB_API_KEY or TMDB_ACCESS_TOKEN environment variable.');
  process.exit(1);
}

const pages = Number(argMap.pages ?? 1);
const outputPath = argMap.output ?? 'data/movies.json';

const buildUrl = (url) => {
  if (accessToken) {
    return url;
  }
  const apiUrl = new URL(url);
  apiUrl.searchParams.set('api_key', apiKey);
  return apiUrl.toString();
};

const fetchJson = async (url) => {
  const response = await fetch(buildUrl(url), {
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

const getDiscoverPage = async (page) => {
  const url = new URL(`${TMDB_BASE_URL}/discover/movie`);
  url.searchParams.set('include_adult', 'false');
  url.searchParams.set('include_video', 'false');
  url.searchParams.set('language', 'en-US');
  url.searchParams.set('page', String(page));
  url.searchParams.set('sort_by', 'popularity.desc');
  return fetchJson(url.toString());
};

const getMovieDetails = async (movieId) => {
  const detailsUrl = `${TMDB_BASE_URL}/movie/${movieId}?language=en-US`;
  const creditsUrl = `${TMDB_BASE_URL}/movie/${movieId}/credits?language=en-US`;
  const keywordsUrl = `${TMDB_BASE_URL}/movie/${movieId}/keywords`;

  const [details, credits, keywords] = await Promise.all([
    fetchJson(detailsUrl),
    fetchJson(creditsUrl),
    fetchJson(keywordsUrl),
  ]);

  return {
    id: details.id,
    title: details.title,
    release_date: details.release_date,
    runtime: details.runtime,
    genres: details.genres?.map((genre) => ({ id: genre.id, name: genre.name })) ?? [],
    keywords: keywords.keywords?.map((keyword) => ({
      id: keyword.id,
      name: keyword.name,
    })) ?? [],
    cast: credits.cast?.slice(0, 10).map((person) => ({
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

const run = async () => {
  const movies = [];
  const totalPages = Number.isNaN(pages) || pages < 1 ? 1 : pages;

  for (let page = 1; page <= totalPages; page += 1) {
    console.log(`Fetching page ${page}/${totalPages}...`);
    const discover = await getDiscoverPage(page);

    for (const movie of discover.results ?? []) {
      console.log(`Fetching details for ${movie.title} (${movie.id})`);
      const details = await getMovieDetails(movie.id);
      movies.push(details);
    }
  }

  const output = {
    fetched_at: new Date().toISOString(),
    source: 'TMDB',
    movies,
  };

  const resolvedPath = path.resolve(outputPath);
  await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
  await fs.writeFile(resolvedPath, JSON.stringify(output, null, 2), 'utf8');
  console.log(`Saved ${movies.length} movies to ${resolvedPath}`);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
