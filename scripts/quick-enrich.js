/**
 * quick-enrich.js — Standalone script to fetch star+forks for projects
 * Uses GitHub API (no token = 60 req/hr, with token = 5000 req/hr)
 * Fetches repos in batches and saves progress incrementally.
 *
 * Usage: node scripts/quick-enrich.js [--all] [--top=N]
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_DIR = join(ROOT, 'data');
const PROJECTS_FILE = join(DATA_DIR, 'projects.json');
const STARS_FILE = join(DATA_DIR, 'stars.json');

const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;

function loadCache() {
  if (existsSync(STARS_FILE)) {
    try { return JSON.parse(readFileSync(STARS_FILE, 'utf-8')); }
    catch { return {}; }
  }
  return {};
}

function saveCache(cache) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(STARS_FILE, JSON.stringify(cache, null, 2), 'utf-8');
}

async function fetchRepoStats(owner, repo) {
  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'HelloGitHub-Showcase/1.0'
  };

  const url = `https://api.github.com/repos/${owner}/${repo}`;
  try {
    const res = await fetch(url, { headers });

    if (res.status === 404) return null;
    if (res.status === 403) {
      const remaining = res.headers.get('X-RateLimit-Remaining');
      const resetTime = res.headers.get('X-RateLimit-Reset');
      console.warn(`  ⚠ Rate limit hit. Remaining: ${remaining}, resets in ${resetTime ? Math.max(0, parseInt(resetTime) - Math.floor(Date.now()/1000)) : '?'}s`);
      return -1;
    }
    if (!res.ok) return null;

    const data = await res.json();
    return {
      stars: data.stargazers_count || 0,
      forks: data.forks_count || 0
    };
  } catch (e) {
    console.warn(`  ⚠ Network error for ${owner}/${repo}: ${e.message}`);
    return null;
  }
}

function extractRepoId(url) {
  const m = url.match(/github\.com\/([^/]+)\/([^/]+?)(?:\/|$)/);
  return m ? { owner: m[1], repo: m[2], key: `${m[1]}/${m[2]}` } : null;
}

async function main() {
  const args = process.argv.slice(2);
  const doAll = args.includes('--all');
  const topArg = args.find(a => a.startsWith('--top='));
  const limit = topArg ? parseInt(topArg.split('=')[1]) : (doAll ? Infinity : 100);

  console.log('🔍 Loading projects...');
  const data = JSON.parse(readFileSync(PROJECTS_FILE, 'utf-8'));
  const cache = loadCache();
  const now = Date.now();

  // Collect unique repos
  const uniqueRepos = new Map();
  for (const issue of data.issues) {
    for (const cat of Object.values(issue.categories)) {
      for (const p of cat) {
        if (!p.githubUrl) continue;
        const info = extractRepoId(p.githubUrl);
        if (!info || uniqueRepos.has(info.key)) continue;

        // Skip cached
        if (cache[info.key] && (now - cache[info.key].ts < CACHE_TTL)) continue;
        uniqueRepos.set(info.key, info);
      }
    }
  }

  const reposToFetch = [...uniqueRepos.values()].slice(0, limit);
  console.log(`📊 ${uniqueRepos.size} unique repos total, ${reposToFetch.length} to fetch (limit: ${limit === Infinity ? 'all' : limit})`);
  console.log(`📦 ${Object.keys(cache).length} cached entries\n`);

  if (reposToFetch.length === 0) {
    console.log('✅ All repos already cached!');
    applyCacheToData(data, cache);
    return;
  }

  let enriched = 0, failed = 0, rateLimited = false;
  const BATCH = 3;
  const BATCH_DELAY = 300; // ms between batches

  for (let i = 0; i < reposToFetch.length && !rateLimited; i += BATCH) {
    const batch = reposToFetch.slice(i, i + BATCH);

    const results = await Promise.all(
      batch.map(async (info) => {
        const stats = await fetchRepoStats(info.owner, info.repo);
        return { key: info.key, stats };
      })
    );

    for (const { key, stats } of results) {
      if (stats === -1) {
        rateLimited = true;
        break;
      }
      if (stats !== null) {
        cache[key] = { stars: stats.stars, forks: stats.forks, ts: now };
        enriched++;
      } else {
        failed++;
      }
    }

    // Progress
    const done = i + batch.length;
    const pct = Math.round(done / reposToFetch.length * 100);
    process.stdout.write(`\r  ⏳ ${done}/${reposToFetch.length} (${pct}%) | ✅ ${enriched} ❌ ${failed}  `);

    // Save cache periodically
    if (done % 30 === 0 || done >= reposToFetch.length) {
      saveCache(cache);
    }

    if (i + BATCH < reposToFetch.length && !rateLimited) {
      await new Promise(r => setTimeout(r, BATCH_DELAY));
    }
  }

  console.log('\n💾 Saving cache...');
  saveCache(cache);

  // Apply to data
  console.log('📝 Applying stats to projects...');
  applyCacheToData(data, cache);

  console.log(`\n✅ Done! Enriched: ${enriched}, Failed: ${failed}, Total cached: ${Object.keys(cache).length}`);
}

function applyCacheToData(data, cache) {
  let applied = 0;
  for (const issue of data.issues) {
    for (const cat of Object.values(issue.categories)) {
      for (const p of cat) {
        if (!p.githubUrl) continue;
        const info = extractRepoId(p.githubUrl);
        if (!info) continue;
        const cached = cache[info.key];
        if (cached && cached.stars !== undefined) {
          p.stars = cached.stars;
          p.forks = cached.forks;
          applied++;
        }
      }
    }
  }

  writeFileSync(PROJECTS_FILE, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`  Applied stats to ${applied} projects, saved projects.json`);
}

main().catch(err => {
  console.error('\n❌ Error:', err.message);
  process.exit(1);
});
