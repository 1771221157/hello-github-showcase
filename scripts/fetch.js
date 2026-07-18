/**
 * fetch.js — 从 HelloGitHub GitHub 仓库拉取 Markdown 内容
 *
 * 支持增量拉取：对比 data/issues.json 已知期刊列表，只拉取新期刊
 * 首次运行时拉取全部历史期刊
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_DIR = join(ROOT, 'data');
const ISSUES_FILE = join(DATA_DIR, 'issues.json');

const RAW_BASE = 'https://raw.githubusercontent.com/521xueweihan/HelloGitHub/master/content';
const API_BASE = 'https://api.github.com/repos/521xueweihan/HelloGitHub/contents/content';

// 确保 data 目录存在
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * 获取文件名格式（处理前 9 期的补零格式）
 */
function getFileName(issueNum) {
  if (issueNum < 10) {
    return `HelloGitHub0${issueNum}.md`;
  }
  return `HelloGitHub${issueNum}.md`;
}

/**
 * 从 GitHub API 获取 content/ 目录下的所有期刊文件列表
 */
async function getIssueList() {
  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'HelloGitHub-Showcase/1.0'
  };
  if (process.env.GITHUB_TOKEN) {
    headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
  }

  const res = await fetch(API_BASE, { headers });
  if (!res.ok) {
    throw new Error(`Failed to fetch issue list: ${res.status} ${res.statusText}`);
  }

  const files = await res.json();
  const issueNumbers = [];

  for (const file of files) {
    const match = file.name.match(/HelloGitHub(\d+)\.md/);
    if (match) {
      issueNumbers.push(parseInt(match[1], 10));
    }
  }

  return issueNumbers.sort((a, b) => a - b);
}

/**
 * 拉取单期 markdown 内容，带重试
 */
async function fetchIssue(issueNum, retries = 3) {
  const fileName = getFileName(issueNum);
  const url = `${RAW_BASE}/${fileName}`;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 404) {
        console.warn(`  ⚠ Issue #${issueNum} not found (404), skipping`);
        return null;
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const content = await res.text();
      console.log(`  ✓ Fetched issue #${issueNum} (${content.length} bytes)`);
      return { issueNum, content, fileName };
    } catch (err) {
      if (attempt < retries - 1) {
        const wait = Math.pow(2, attempt) * 1000;
        console.warn(`  ↻ Retry #${issueNum} in ${wait}ms (attempt ${attempt + 1}/${retries})`);
        await new Promise(r => setTimeout(r, wait));
      } else {
        console.error(`  ✗ Failed to fetch issue #${issueNum}: ${err.message}`);
        return null;
      }
    }
  }
}

/**
 * 加载已知期刊列表（增量构建用）
 */
function loadKnownIssues() {
  if (existsSync(ISSUES_FILE)) {
    try {
      const data = JSON.parse(readFileSync(ISSUES_FILE, 'utf-8'));
      return data.issues || [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * 主函数：拉取所有新期刊
 */
export async function fetchAllIssues() {
  console.log('🚀 Fetching HelloGitHub content...\n');

  // 1. 获取远程期刊列表
  console.log('📡 Fetching issue list from GitHub API...');
  const remoteIssues = await getIssueList();
  console.log(`  Found ${remoteIssues.length} issues (latest: #${remoteIssues[remoteIssues.length - 1]})\n`);

  // 2. 对比已知列表
  const knownIssues = loadKnownIssues();
  const knownNums = new Set(knownIssues.map(i => i.number));
  const newNums = remoteIssues.filter(n => !knownNums.has(n));

  if (newNums.length === 0) {
    console.log('✅ All issues already fetched, nothing new.\n');
    return knownIssues.map(i => ({
      issueNum: i.number,
      content: readFileSync(join(DATA_DIR, 'issues', getFileName(i.number)), 'utf-8'),
      fileName: getFileName(i.number)
    })).filter(Boolean);
  }

  console.log(`📥 Fetching ${newNums.length} new issues: #${newNums.join(', #')}\n`);

  // 3. 并发拉取（最多 5 个同时进行）
  const results = [];
  const BATCH = 5;

  // 先加载已知内容
  for (const issue of knownIssues) {
    const fileName = getFileName(issue.number);
    const filePath = join(DATA_DIR, 'issues', fileName);
    if (existsSync(filePath)) {
      results.push({
        issueNum: issue.number,
        content: readFileSync(filePath, 'utf-8'),
        fileName
      });
    }
  }

  // 拉取新期刊
  for (let i = 0; i < newNums.length; i += BATCH) {
    const batch = newNums.slice(i, i + BATCH);
    const batchResults = await Promise.all(batch.map(n => fetchIssue(n)));
    for (const result of batchResults) {
      if (result) {
        // 缓存到本地
        const issuesDir = join(DATA_DIR, 'issues');
        if (!existsSync(issuesDir)) {
          mkdirSync(issuesDir, { recursive: true });
        }
        writeFileSync(join(issuesDir, result.fileName), result.content, 'utf-8');
        results.push(result);
      }
    }
    // 批次间短暂延迟，避免触发限速
    if (i + BATCH < newNums.length) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  console.log(`\n✅ Fetched ${results.length} issues total\n`);
  return results;
}

// 直接运行
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fetchAllIssues().then(results => {
    console.log(`Done. ${results.length} issues available.`);
  }).catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
