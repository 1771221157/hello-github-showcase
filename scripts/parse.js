/**
 * parse.js — 解析 HelloGitHub Markdown 内容为结构化数据
 *
 * HelloGitHub 格式:
 *   # 《HelloGitHub》第 XX 期
 *   ## 目录
 *   - [Python 项目](#Python-项目)
 *   ...
 *   ### Python 项目
 *   1、[project-name](https://github.com/owner/repo)：描述
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_DIR = join(ROOT, 'data');
const PROJECTS_FILE = join(DATA_DIR, 'projects.json');

/**
 * 从 markdown 内容中提取期刊号
 */
function extractIssueNumber(content) {
  const match = content.match(/^#\s*《?HelloGitHub》?\s*第\s*(\d+)\s*期/m);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * 推断期刊日期（HelloGitHub 每月 28 号发布）
 * Issue 1 = 2016-05-28
 *
 * 注意：上游内容可能提前提交到仓库（在正式发布日期之前），
 * 因此如果推断日期落在未来，自动回退到上一个月，
 * 避免网站展示尚未到来的日期。
 */
function inferIssueDate(issueNum) {
  const BASE_YEAR = 2016;
  const BASE_MONTH = 5; // 第1期 = 2016年5月

  const totalMonths = (BASE_YEAR * 12 + BASE_MONTH - 1) + (issueNum - 1);
  let year = Math.floor(totalMonths / 12);
  let month = (totalMonths % 12) + 1;

  // 如果推断日期在未来，回退到上一个有效月份
  const today = new Date();
  const inferredDate = new Date(year, month - 1, 28);
  if (inferredDate > today) {
    month -= 1;
    if (month < 1) {
      month = 12;
      year -= 1;
    }
  }

  return `${year}-${String(month).padStart(2, '0')}-28`;
}

/**
 * 定位所有分类标题（### 开头）
 * 返回 [{ title: "Python", startIndex: 123 }, ...]
 */
function findCategorySections(content) {
  const headingRegex = /^###\s+(.+?)(?:\s*项目)?\s*$/gm;
  const sections = [];
  let match;

  while ((match = headingRegex.exec(content)) !== null) {
    sections.push({
      title: match[1].trim(),
      startIndex: match.index + match[0].length
    });
  }

  return sections;
}

/**
 * 在分类区块内解析项目条目
 *
 * 主模式: 1、[name](url)：description
 * 备用模式: * [name](url) - description
 */
function parseProjectsInSection(content, startIndex, nextStartIndex) {
  const sectionContent = nextStartIndex
    ? content.slice(startIndex, nextStartIndex)
    : content.slice(startIndex);

  const projects = [];
  const lines = sectionContent.split('\n');

  // 主正则: 匹配编号 + 链接 + 描述
  const mainRegex = /^(\d+)[、,.]\s*\[([^\]]+)\]\(([^)]+)\)[：:]\s*(.+)$/;
  // 备用: Markdown 列表格式
  const altRegex = /^\*\s*\[([^\]]+)\]\(([^)]+)\)\s*[-–—:：]\s*(.+)$/;

  let currentProject = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // 跳过子标题和图片行
    if (/^#{1,4}\s/.test(trimmed)) break;
    if (/^!\[/.test(trimmed)) continue;
    if (/^<p\s/.test(trimmed)) continue;

    let mainMatch = trimmed.match(mainRegex);
    let altMatch = trimmed.match(altRegex);

    if (mainMatch) {
      // 保存上一个项目
      if (currentProject) {
        projects.push(currentProject);
      }

      const [, , name, url, desc] = mainMatch;
      currentProject = {
        name: name.trim(),
        githubUrl: normalizeUrl(url.trim()),
        description: desc.trim(),
        fullDescription: desc.trim()
      };
    } else if (altMatch) {
      if (currentProject) {
        projects.push(currentProject);
      }

      const [, name, url, desc] = altMatch;
      currentProject = {
        name: name.trim(),
        githubUrl: normalizeUrl(url.trim()),
        description: desc.trim(),
        fullDescription: desc.trim()
      };
    } else if (currentProject && trimmed.length > 0) {
      // 多行描述：追加到上一个项目
      currentProject.fullDescription += ' ' + trimmed;
    }
  }

  // 保存最后一个项目
  if (currentProject) {
    projects.push(currentProject);
  }

  return projects;
}

/**
 * 解析 HelloGitHub 跟踪链接，提取真实的 GitHub URL
 * 格式: https://hellogithub.com/periodical/statistics/click?target=https://github.com/owner/repo
 */
function resolveRedirectUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'hellogithub.com' && parsed.searchParams.has('target')) {
      return parsed.searchParams.get('target');
    }
  } catch {
    // URL 解析失败，返回原始值
  }
  return url;
}

/**
 * 规范化 GitHub URL
 */
function normalizeUrl(url) {
  return resolveRedirectUrl(url)
    .replace(/\/$/, '')           // 去掉尾部斜杠
    .replace(/\.git$/, '')        // 去掉 .git 后缀
    .replace(/^git\+/, '')        // 去掉 git+ 前缀
    .trim();
}

/**
 * 从 GitHub URL 提取 owner/repo
 */
function extractRepoId(url) {
  // 先解析跟踪链接，获取真实 GitHub URL
  const realUrl = resolveRedirectUrl(url);
  const match = realUrl.match(/github\.com\/([^/]+\/[^/]+?)(?:\/|$)/);
  return match ? match[1] : null;
}

/**
 * 主解析函数
 */
export function parseIssue(content, issueNum) {
  const number = issueNum || extractIssueNumber(content);
  if (!number) {
    console.warn('⚠ Could not extract issue number, skipping');
    return null;
  }

  const date = inferIssueDate(number);
  const sections = findCategorySections(content);

  if (sections.length === 0) {
    console.warn(`⚠ Issue #${number}: no category sections found`);
    return null;
  }

  const categories = {};
  let totalProjects = 0;

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const nextStartIndex = i < sections.length - 1 ? sections[i + 1].startIndex : null;
    const projects = parseProjectsInSection(content, section.startIndex, nextStartIndex);

    if (projects.length > 0) {
      // 丰富每个项目
      const enriched = projects.map(p => ({
        id: extractRepoId(p.githubUrl) || p.name.toLowerCase().replace(/\s+/g, '-'),
        name: p.name,
        fullName: extractRepoId(p.githubUrl) || p.name,
        githubUrl: p.githubUrl,
        description: p.description,
        fullDescription: p.fullDescription,
        language: section.title,
        issueNumber: number,
        issueDate: date,
        stars: null
      }));

      categories[section.title] = enriched;
      totalProjects += enriched.length;
    }
  }

  const issue = {
    number,
    date,
    title: `《HelloGitHub》第 ${number} 期`,
    categoryCount: Object.fromEntries(
      Object.entries(categories).map(([k, v]) => [k, v.length])
    ),
    totalProjects,
    categories
  };

  return issue;
}

/**
 * 批量解析所有已拉取的期刊
 */
export function parseAllIssues(issues) {
  const allIssues = [];

  for (const { issueNum, content } of issues) {
    console.log(`📝 Parsing issue #${issueNum}...`);
    const parsed = parseIssue(content, issueNum);
    if (parsed) {
      allIssues.push(parsed);
      console.log(`  ✓ ${parsed.totalProjects} projects in ${Object.keys(parsed.categories).length} categories`);
    }
  }

  // 按期刊号排序
  allIssues.sort((a, b) => a.number - b.number);
  return allIssues;
}

/**
 * 保存解析结果
 */
export function saveProjects(issues) {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  // 构建完整的 projects.json
  const data = {
    lastUpdated: new Date().toISOString(),
    totalIssues: issues.length,
    totalProjects: issues.reduce((sum, i) => sum + i.totalProjects, 0),
    issues
  };

  writeFileSync(PROJECTS_FILE, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`\n💾 Saved ${data.totalProjects} projects across ${data.totalIssues} issues to data/projects.json`);

  // 同时更新 issues.json（用于增量构建）
  const issuesMeta = issues.map(i => ({
    number: i.number,
    date: i.date,
    title: i.title,
    categoryCount: i.categoryCount,
    totalProjects: i.totalProjects
  }));

  const issuesFile = join(DATA_DIR, 'issues.json');
  const existing = existsSync(issuesFile)
    ? JSON.parse(readFileSync(issuesFile, 'utf-8'))
    : { issues: [] };

  // 合并去重
  const existingNums = new Set(existing.issues.map(i => i.number));
  for (const meta of issuesMeta) {
    if (!existingNums.has(meta.number)) {
      existing.issues.push(meta);
    }
  }
  existing.issues.sort((a, b) => a.number - b.number);
  existing.lastUpdated = new Date().toISOString();

  writeFileSync(issuesFile, JSON.stringify(existing, null, 2), 'utf-8');

  return data;
}

// 直接运行：从 data/issues/ 目录解析所有已缓存文件
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const issuesDir = join(DATA_DIR, 'issues');
  if (!existsSync(issuesDir)) {
    console.error('No data/issues/ directory found. Run fetch.js first.');
    process.exit(1);
  }

  const { readdirSync } = await import('fs');
  const files = readdirSync(issuesDir).filter(f => f.endsWith('.md'));

  const issues = files.map(f => {
    const match = f.match(/HelloGitHub(\d+)\.md/);
    return {
      issueNum: match ? parseInt(match[1], 10) : 0,
      content: readFileSync(join(issuesDir, f), 'utf-8')
    };
  }).filter(i => i.issueNum > 0);

  console.log(`Found ${issues.length} cached issues\n`);
  const parsed = parseAllIssues(issues);
  saveProjects(parsed);
  console.log('\n✅ Parsing complete!');
}
