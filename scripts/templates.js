/**
 * templates.js — EJS 模板编译和渲染辅助函数
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import ejs from 'ejs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const TEMPLATES_DIR = join(ROOT, 'templates');
const PARTIALS_DIR = join(TEMPLATES_DIR, 'partials');

/**
 * 加载并编译所有模板
 */
function loadTemplates() {
  const readTemplate = (name) => {
    const path = join(TEMPLATES_DIR, name);
    if (!existsSync(path)) {
      console.warn(`⚠ Template not found: ${name}`);
      return '';
    }
    return readFileSync(path, 'utf-8');
  };

  const readPartial = (name) => {
    const path = join(PARTIALS_DIR, name);
    if (!existsSync(path)) {
      console.warn(`⚠ Partial not found: ${name}`);
      return '';
    }
    return readFileSync(path, 'utf-8');
  };

  // 加载所有 partials
  const partials = {
    head: readPartial('head.html'),
    header: readPartial('header.html'),
    footer: readPartial('footer.html'),
    'project-card': readPartial('project-card.html'),
    scripts: readPartial('scripts.html'),
  };

  // 加载页面模板
  const pages = {
    home: readTemplate('home.html'),
    language: readTemplate('language.html'),
    issue: readTemplate('issue.html'),
    about: readTemplate('about.html'),
  };

  return { partials, pages };
}

/**
 * 格式化 star 数为人类可读格式
 */
export function formatStars(num) {
  if (num === null || num === undefined) return null;
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
  return num.toString();
}

/**
 * 获取语言图标 emoji
 */
export function getLanguageEmoji(lang) {
  const map = {
    'Python': '🐍', 'JavaScript': '⚡', 'TypeScript': '🔷',
    'Go': '🔵', 'Java': '☕', 'Rust': '⚙️', 'C++': '🔧',
    'C': '⚡', 'Ruby': '💎', 'Swift': '🕊️', 'Kotlin': '🎯',
    'PHP': '🐘', 'R': '📊', 'Shell': '💻', 'CSS': '🎨',
    'HTML': '📄', 'Vue': '💚', 'React': '⚛️', 'Flutter': '🦋',
    'Dart': '🎯', 'Scala': '🔴', 'Lua': '🌙', 'Perl': '🐪',
    'Haskell': '🔮', 'Elixir': '💧', 'Clojure': '🟣',
    '其它': '📦', '开源书籍': '📚', '机器学习': '🤖',
  };
  return map[lang] || '📦';
}

/**
 * 渲染 EJS 模板字符串并写入输出文件
 */
function renderTemplate(templateContent, data, outputPath, templateName) {
  const dir = dirname(outputPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  try {
    const html = ejs.render(templateContent, {
      ...data,
      formatStars,
      getLanguageEmoji,
      filename: join(TEMPLATES_DIR, templateName),
    }, {
      views: [TEMPLATES_DIR],
    });

    writeFileSync(outputPath, html, 'utf-8');
    console.log(`  ✓ ${outputPath}`);
    return Promise.resolve();
  } catch (err) {
    console.error(`  ✗ Error rendering ${templateName}: ${err.message}`);
    return Promise.reject(err);
  }
}

/**
 * 构建所有页面
 */
export async function buildAll(data, distDir) {
  // 预加载所有 partials 用于内联
  const readPartial = (name) => {
    const path = join(PARTIALS_DIR, name);
    if (!existsSync(path)) return '';
    return readFileSync(path, 'utf-8');
  };

  // 读取并内联 partial 的模板加载器
  function loadTemplate(name) {
    let content = readFileSync(join(TEMPLATES_DIR, name), 'utf-8');
    // 替换 include 指令为实际内容（匹配带参数和不带参数的两种形式）
    content = content.replace(/<%- include\('partials\/([^']+)'[^)]*\) %>/g, (_, partialName) => {
      // include 有时不带 .html 扩展名（如 project-card），需要补上
      const fileName = partialName.endsWith('.html') ? partialName : partialName + '.html';
      return readPartial(fileName);
    });
    content = content.replace(/<%- include\("partials\/([^"]+)"[^)]*\) %>/g, (_, partialName) => {
      const fileName = partialName.endsWith('.html') ? partialName : partialName + '.html';
      return readPartial(fileName);
    });
    return content;
  }

  console.log('\n🏗️  Generating pages...\n');

  // 预处理模板（内联 partials）
  const tplHome = loadTemplate('home.html');
  const tplLanguage = loadTemplate('language.html');
  const tplIssue = loadTemplate('issue.html');
  const tplAbout = loadTemplate('about.html');

  const promises = [];

  // 首页
  const latestIssue = data.issues[data.issues.length - 1];
  const allLanguages = getAllLanguages(data.issues);
  const featuredProjects = getFeaturedProjects(latestIssue);

  promises.push(renderTemplate(tplHome, {
    title: '开源星海',
    description: 'HelloGitHub 月刊内容同步展示，按语言分类浏览',
    latestIssue,
    allLanguages,
    featuredProjects,
    recentIssues: data.issues.slice(-12).reverse(),
    totalIssues: data.totalIssues,
    totalProjects: data.totalProjects,
    page: 'home'
  }, join(distDir, 'index.html'), 'home.html'));

  // 语言总览页
  promises.push(renderTemplate(tplLanguage, {
    title: '语言分类',
    description: '按编程语言浏览开源项目',
    languages: allLanguages,
    isIndex: true,
    page: 'languages'
  }, join(distDir, 'languages', 'index.html'), 'language.html'));

  // 各语言详情页
  for (const lang of allLanguages) {
    const langProjects = getProjectsByLanguage(data.issues, lang.name);
    promises.push(renderTemplate(tplLanguage, {
      title: `${lang.name} 开源项目`,
      description: `共 ${lang.count} 个 ${lang.name} 开源项目`,
      language: lang,
      projects: langProjects,
      isIndex: false,
      page: 'languages'
    }, join(distDir, 'languages', `${lang.slug}.html`), 'language.html'));
  }

  // 期刊归档页
  const issuesByYear = groupIssuesByYear(data.issues);
  promises.push(renderTemplate(tplIssue, {
    title: '期刊归档',
    description: 'HelloGitHub 历史期刊归档',
    issuesByYear,
    isArchive: true,
    page: 'issues'
  }, join(distDir, 'issues', 'index.html'), 'issue.html'));

  // 各期详情页
  for (const issue of data.issues) {
    promises.push(renderTemplate(tplIssue, {
      title: `第 ${issue.number} 期 (${issue.date})`,
      description: `HelloGitHub 第 ${issue.number} 期，共 ${issue.totalProjects} 个项目`,
      issue,
      isArchive: false,
      page: 'issues'
    }, join(distDir, 'issues', `${issue.number}.html`), 'issue.html'));
  }

  // 关于页
  promises.push(renderTemplate(tplAbout, {
    title: '关于本站',
    description: '关于本站 — 数据来源、更新机制和许可说明',
    page: 'about'
  }, join(distDir, 'about.html'), 'about.html'));

  await Promise.all(promises);

  console.log(`\n✅ Generated ${3 + allLanguages.length + data.issues.length} pages`);
}

/**
 * 获取所有语言列表（按项目数排序）
 */
function getAllLanguages(issues) {
  const langMap = new Map();

  for (const issue of issues) {
    for (const [langName, projects] of Object.entries(issue.categories)) {
      if (!langMap.has(langName)) {
        langMap.set(langName, {
          name: langName,
          slug: langName.toLowerCase().replace(/\s+/g, '-').replace(/[+#]/g, ''),
          count: 0,
          emoji: getLanguageEmoji(langName),
          firstIssue: issue.number,
          lastIssue: issue.number
        });
      }
      const lang = langMap.get(langName);
      lang.count += projects.length;
      lang.lastIssue = issue.number;
    }
  }

  return Array.from(langMap.values())
    .sort((a, b) => b.count - a.count);
}

/**
 * 获取精选项目（最新一期每个语言前2个）
 */
function getFeaturedProjects(latestIssue) {
  if (!latestIssue) return [];
  const projects = [];
  for (const [, projs] of Object.entries(latestIssue.categories)) {
    projects.push(...projs.slice(0, 2));
  }
  return projects.slice(0, 12);
}

/**
 * 获取指定语言的所有项目
 */
function getProjectsByLanguage(issues, langName) {
  const projects = [];
  for (const issue of issues) {
    const catProjects = issue.categories[langName];
    if (catProjects) {
      projects.push(...catProjects);
    }
  }
  return projects.reverse(); // 最新的在前
}

/**
 * 按年份分组期刊
 */
function groupIssuesByYear(issues) {
  const grouped = {};
  for (const issue of [...issues].reverse()) {
    const year = issue.date.slice(0, 4);
    if (!grouped[year]) grouped[year] = [];
    grouped[year].push(issue);
  }
  return grouped;
}
