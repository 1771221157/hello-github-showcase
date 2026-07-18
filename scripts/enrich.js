/**
 * enrich.js — 调用 GitHub API 补充项目的 Star 数等元数据
 *
 * 缓存策略: stars.json 缓存 7 天，减少 API 调用
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_DIR = join(ROOT, 'data');
const STARS_FILE = join(DATA_DIR, 'stars.json');

const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 天

function loadStarCache() {
  if (existsSync(STARS_FILE)) {
    try {
      return JSON.parse(readFileSync(STARS_FILE, 'utf-8'));
    } catch {
      return {};
    }
  }
  return {};
}

function saveStarCache(cache) {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
  writeFileSync(STARS_FILE, JSON.stringify(cache, null, 2), 'utf-8');
}

/**
 * 为单个仓库获取 star 数
 */
async function fetchRepoStars(owner, repo, token) {
  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'HelloGitHub-Showcase/1.0'
  };
  if (token) {
    headers['Authorization'] = `token ${token}`;
  }

  const url = `https://api.github.com/repos/${owner}/${repo}`;
  const res = await fetch(url, { headers });

  if (res.status === 404) return null;
  if (res.status === 403) {
    // 速率限制
    const resetTime = res.headers.get('X-RateLimit-Reset');
    if (resetTime) {
      const waitSec = Math.max(0, parseInt(resetTime) - Math.floor(Date.now() / 1000));
      console.warn(`  ⚠ Rate limited, would need to wait ${waitSec}s`);
    }
    return -1; // 特殊标记：被限速
  }
  if (!res.ok) return null;

  const data = await res.json();
  return data.stargazers_count || 0;
}

/**
 * 从 GitHub URL 提取 owner 和 repo
 */
function parseRepoFromUrl(url) {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+?)(?:\/|\.git|$)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2].replace(/\.git$/, '') };
}

/**
 * 批量获取 star 数（主入口）
 */
export async function enrichProjects(projects, token) {
  const cache = loadStarCache();
  const now = Date.now();
  let enriched = 0;
  let cached = 0;
  let failed = 0;
  let rateLimited = false;

  // 收集所有需要查询的唯一仓库
  const toFetch = [];
  const seen = new Set();

  for (const project of projects) {
    if (!project.githubUrl) continue;
    const repoInfo = parseRepoFromUrl(project.githubUrl);
    if (!repoInfo) continue;

    const key = `${repoInfo.owner}/${repoInfo.repo}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // 检查缓存
    if (cache[key] && (now - cache[key].ts < CACHE_TTL)) {
      project.stars = cache[key].stars;
      project.owner = repoInfo.owner;
      project.repo = repoInfo.repo;
      cached++;
      continue;
    }

    toFetch.push({ project, key, repoInfo });
  }

  console.log(`  📊 ${cached} from cache, ${toFetch.length} to fetch`);

  // 并发获取（最多 3 个同时）
  const BATCH = 3;
  for (let i = 0; i < toFetch.length && !rateLimited; i += BATCH) {
    const batch = toFetch.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map(({ key, repoInfo }) =>
        fetchRepoStars(repoInfo.owner, repoInfo.repo, token).then(stars => ({ key, stars }))
      )
    );

    for (const { key, stars } of results) {
      if (stars === -1) {
        rateLimited = true;
        failed += batch.length - results.indexOf({ key, stars });
        break;
      }
      if (stars !== null && stars !== undefined) {
        cache[key] = { stars, ts: now };
        enriched++;
      } else {
        failed++;
      }
    }

    // 更新对应 project 的 stars
    for (const { project, key } of batch) {
      if (cache[key]) {
        project.stars = cache[key].stars;
      }
    }

    if (i + BATCH < toFetch.length && !rateLimited) {
      await new Promise(r => setTimeout(r, 300));
    }
  }

  saveStarCache(cache);
  console.log(`  ✅ Enriched ${enriched}, cached ${cached}, failed ${failed}`);
  return projects;
}
