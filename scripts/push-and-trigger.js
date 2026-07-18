/**
 * push-and-trigger.js — Push code to GitHub + trigger workflow dispatch
 *
 * Usage: node scripts/push-and-trigger.js
 *
 * Uses GitHub API to update files and trigger workflow_dispatch.
 * Requires: rate limit not exhausted
 */

import { readFileSync } from 'fs';

const REPO = '1771221157/hello-github-showcase';
const BASE = 'https://api.github.com';

function b64(f) { return readFileSync(f).toString('base64'); }

async function api(path, opts = {}) {
  const url = `${BASE}${path}`;
  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'HelloGitHub-Showcase/1.0'
  };
  if (opts.method && opts.method !== 'GET') {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(url, {
    method: opts.method || 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });

  if (res.status === 403) {
    const remaining = res.headers.get('X-RateLimit-Remaining');
    const resetTime = res.headers.get('X-RateLimit-Reset');
    throw new Error(`Rate limited. Remaining: ${remaining}, resets in ${resetTime ? Math.max(0, parseInt(resetTime) - Math.floor(Date.now()/1000)) : '?'}s`);
  }

  const text = await res.text();
  try { return JSON.parse(text); }
  catch { return text; }
}

async function getFileSha(path) {
  try {
    const data = await api(`/repos/${REPO}/contents/${path}`);
    return data.sha;
  } catch (e) {
    console.log(`  ⚠ Could not get SHA for ${path}: ${e.message}`);
    return null;
  }
}

async function updateFile(path, contentBase64, sha) {
  const body = {
    message: `Update ${path} — fix description display + add stars/forks`,
    content: contentBase64,
    branch: 'main'
  };
  if (sha) body.sha = sha;

  try {
    const result = await api(`/repos/${REPO}/contents/${path}`, {
      method: 'PUT',
      body
    });
    console.log(`  ✅ ${path} updated`);
    return result;
  } catch (e) {
    console.error(`  ❌ Failed to update ${path}: ${e.message}`);
    return null;
  }
}

async function triggerWorkflow() {
  try {
    await api(`/repos/${REPO}/actions/workflows/deploy.yml/dispatches`, {
      method: 'POST',
      body: { ref: 'main' }
    });
    console.log('  ✅ Workflow triggered!');
  } catch (e) {
    console.error(`  ❌ Failed to trigger workflow: ${e.message}`);
  }
}

async function main() {
  console.log('🚀 Pushing code changes to GitHub + triggering workflow...\n');

  const files = [
    'public/css/style.css',
    'templates/partials/project-card.html',
    'scripts/enrich.js',
    'scripts/build.js',
    'scripts/quick-enrich.js',
    'data/stars.json',
    'data/projects.json'
  ];

  // Check rate limit
  const rateLimit = await api('/rate_limit');
  const core = rateLimit.resources?.core || rateLimit.rate || {};
  console.log(`📊 Rate limit: ${core.remaining}/${core.limit} remaining, resets at ${new Date((core.reset || 0) * 1000).toLocaleTimeString()}\n`);

  if ((core.remaining || 0) < files.length + 2) {
    console.log(`⚠ Not enough rate limit. Need ${files.length + 2} requests (${files.length} files + checkout + dispatch).`);
    console.log(`Please wait for rate limit reset (${Math.max(0, core.reset - Math.floor(Date.now()/1000))}s) and try again.`);
    process.exit(1);
  }

  for (const file of files) {
    try {
      const content = b64(file);
      if (file === 'data/projects.json' && content.length > 1000000) {
        console.log(`  ⚠ ${file} is too large for Contents API (>1MB), skipping`);
        continue;
      }
      const sha = await getFileSha(file);
      await updateFile(file, content, sha);
    } catch (e) {
      console.error(`  ❌ Error processing ${file}: ${e.message}`);
    }
  }

  console.log('\n🔔 Triggering workflow dispatch...');
  await triggerWorkflow();

  console.log('\n✅ Done!');
}

main().catch(err => {
  console.error('\n❌ Fatal error:', err.message);
  process.exit(1);
});
