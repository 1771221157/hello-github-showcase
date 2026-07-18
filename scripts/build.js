/**
 * build.js — 主控脚本：串联 fetch → parse → enrich → generate
 *
 * 用法: node scripts/build.js
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync, mkdirSync } from 'fs';
import { copyFileSync, cpSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_DIR = join(ROOT, 'data');
const DIST_DIR = join(ROOT, 'dist');
const PUBLIC_DIR = join(ROOT, 'public');
const PROJECTS_FILE = join(DATA_DIR, 'projects.json');

async function main() {
  const startTime = Date.now();
  const skipFetch = process.argv.includes('--skip-fetch') || process.argv.includes('--local');
  console.log('╔══════════════════════════════════════╗');
  console.log('║   🚀 HelloGitHub Showcase Builder   ║');
  console.log('╚══════════════════════════════════════╝\n');

  let parsedIssues;
  let enriched = false;

  if (skipFetch && existsSync(PROJECTS_FILE)) {
    // ── Skip fetch, use cached data directly ──────────
    console.log('┌─ Stage 1-2: Load cached data ────────┐');
    console.log('  📦 Loading existing projects.json...');
    const cached = JSON.parse(readFileSync(PROJECTS_FILE, 'utf-8'));
    parsedIssues = cached.issues;
    console.log(`  ✓ Loaded ${cached.totalProjects} projects across ${cached.totalIssues} issues`);
    console.log('└──────────────────────────────────────┘\n');
  } else {
    // ── Stage 1: Fetch ────────────────────────────────
    console.log('┌─ Stage 1/4: Fetch ───────────────────┐');
    const { fetchAllIssues } = await import('./fetch.js');
    const issues = await fetchAllIssues();
    console.log('└──────────────────────────────────────┘\n');

    // ── Stage 2: Parse ────────────────────────────────
    console.log('┌─ Stage 2/4: Parse ───────────────────┐');
    const { parseAllIssues, saveProjects } = await import('./parse.js');
    parsedIssues = parseAllIssues(issues);
    const projectData = saveProjects(parsedIssues);
    console.log('└──────────────────────────────────────┘\n');
  }

  // ── Stage 3: Enrich (optional) ────────────────────
  console.log('┌─ Stage 3/4: Enrich ──────────────────┐');
  const token = process.env.GITHUB_TOKEN || null;

  if (token) {
    console.log('  🔑 GitHub token detected, enriching stars...');
    const allProjects = parsedIssues.flatMap(i =>
      Object.values(i.categories).flat()
    );
    const { enrichProjects } = await import('./enrich.js');
    await enrichProjects(allProjects, token);
    // 重新保存带 stars 的数据
    const { saveProjects } = await import('./parse.js');
    saveProjects(parsedIssues);
    enriched = true;
  } else {
    // Check if quick-enrich cache has data
    const starsFile = join(DATA_DIR, 'stars.json');
    if (existsSync(starsFile)) {
      const starsCache = JSON.parse(readFileSync(starsFile, 'utf-8'));
      const cacheSize = Object.keys(starsCache).length;
      if (cacheSize > 0) {
        // Apply cached stars to parsed issues
        let applied = 0;
        for (const issue of parsedIssues) {
          for (const cat of Object.values(issue.categories)) {
            for (const p of cat) {
              if (!p.githubUrl) continue;
              const m = p.githubUrl.match(/github\.com\/([^/]+)\/([^/]+?)(?:\/|$)/);
              if (!m) continue;
              const key = `${m[1]}/${m[2]}`;
              if (starsCache[key] && starsCache[key].stars !== undefined) {
                p.stars = starsCache[key].stars;
                p.forks = starsCache[key].forks;
                applied++;
              }
            }
          }
        }
        console.log(`  ⭐ Applied cached stats to ${applied} projects (${cacheSize} repos in cache)`);
      }
    }
    console.log('  ℹ️  No GitHub token, skipping API enrichment');
  }
  console.log('└──────────────────────────────────────┘\n');

  // ── Stage 4: Generate ─────────────────────────────
  console.log('┌─ Stage 4/4: Generate ────────────────┐');

  // 确保 dist 目录存在且为空
  if (existsSync(DIST_DIR)) {
    const { rmSync } = await import('fs');
    rmSync(DIST_DIR, { recursive: true, force: true });
  }
  mkdirSync(DIST_DIR, { recursive: true });

  // 复制 public/ 静态资源到 dist/
  if (existsSync(PUBLIC_DIR)) {
    cpSync(PUBLIC_DIR, DIST_DIR, { recursive: true });
    console.log('  ✓ Copied static assets');
  }

  // 重新加载完整的 projects.json
  const fullData = JSON.parse(readFileSync(PROJECTS_FILE, 'utf-8'));
  const { buildAll } = await import('./templates.js');
  await buildAll(fullData, DIST_DIR);

  console.log('└──────────────────────────────────────┘\n');

  // ── Done ──────────────────────────────────────────
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`✨ Build complete in ${elapsed}s!`);
  console.log(`📁 Output: ${DIST_DIR}`);
  console.log(`📊 ${fullData.totalProjects} projects across ${fullData.totalIssues} issues`);
  if (enriched) {
    const withStars = Object.values(fullData.issues)
      .flatMap(i => Object.values(i.categories).flat())
      .filter(p => p.stars !== null).length;
    console.log(`⭐ ${withStars} projects enriched with star counts`);
  }
  console.log('');
}

main().catch(err => {
  console.error('\n❌ Build failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
