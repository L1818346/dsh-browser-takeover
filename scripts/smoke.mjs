#!/usr/bin/env node
/**
 * smoke — 用一份假的 @deepseek-ai/dsh-tools 把插件 apply() 跑一遍。
 *
 * 验证四件事：
 *   1. 两个工具的定义都能被宿主编译（有 name / parameters / output.render）；
 *   2. 注册出来的工具名、设置页路由、系统提示段跟预期一致；
 *   3. `web_sites` 真的能回答"这条网址存过没有"（读的是临时 DSH_HOME 里的清单）；
 *   4. `web_open` 在端口没开时，仍然把"这条网址在清单里"带回来（不启动浏览器）。
 */
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const EXPECT_TOOLS = ['web_open', 'web_sites'];
const EXPECT_ROUTES = [
  '/dsh-browser-takeover/sites',
  '/dsh-browser-takeover/sites/add',
  '/dsh-browser-takeover/sites/remove',
  '/dsh-browser-takeover/status',
  '/dsh-browser-takeover/open-login',
];
const EXPECT_SECTION = 'dsh-browser-takeover.routing';

const SAVED = 'https://hdu.fanya.chaoxing.com/portal';
const SIBLING = 'https://hdu.fanya.chaoxing.com/course/123';
const UNSAVED = 'https://example.com/hello';

const dir = await mkdtemp(join(tmpdir(), 'dsh-smoke-'));
process.env.DSH_HOME = join(dir, 'home');
await mkdir(process.env.DSH_HOME, { recursive: true });
await writeFile(join(process.env.DSH_HOME, 'browser-takeover-sites.json'), JSON.stringify({
  sites: [
    { url: SAVED, addedAt: '2026-01-01T00:00:00.000Z' },
    { url: 'https://www.bilibili.com/', addedAt: '2026-01-02T00:00:00.000Z' },
  ],
}, null, 2), 'utf8');

const fake = join(dir, 'tools.mjs');
await writeFile(fake, `
export function defineTool(spec) {
  if (!spec || typeof spec.name !== 'string' || !spec.name) throw new Error('defineTool: missing name');
  if (!spec.parameters || typeof spec.parameters !== 'object') throw new Error('defineTool: missing parameters');
  const out = spec.output;
  if (!out || !out.schema || typeof out.render !== 'function') throw new Error('defineTool: bad output');
  if (typeof spec.execute !== 'function') throw new Error('defineTool: missing execute');
  return spec;
}
`, 'utf8');
process.env.DSH_TOOLS_PATH = fake;

const plugin = await import(pathToFileURL(join(process.cwd(), 'src', 'index.js')).href);
if (typeof plugin.apply !== 'function') throw new Error('plugin has no apply()');

const tools = new Map();
const routes = [];
const sections = [];
const systemPrompt = {
  section(section) { sections.push(section); return () => {}; },
};
const ctx = {
  tools: { register: (tool) => { tools.set(tool.name, tool); return () => {}; } },
  systemPrompt,
  get: (name) => {
    if (name === 'webServer') return { register: ({ path }) => { routes.push(path); return () => {}; } };
    if (name === 'systemPrompt') return systemPrompt;
    return undefined;
  },
  inject: () => {},
  on: () => () => {},
  logger: { info() {}, warn() {}, error() {} },
};

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

let dispose;
try {
  dispose = await plugin.apply(ctx);

  const missingTools = EXPECT_TOOLS.filter((n) => !tools.has(n));
  const extraTools = [...tools.keys()].filter((n) => !EXPECT_TOOLS.includes(n));
  const missingRoutes = EXPECT_ROUTES.filter((p) => !routes.includes(p));
  if (missingTools.length || extraTools.length || missingRoutes.length) {
    fail(`unexpected surface (missing tools: ${missingTools.join(',') || '-'}; ` +
      `extra tools: ${extraTools.join(',') || '-'}; missing routes: ${missingRoutes.join(',') || '-'})`);
  }
  if (!sections.some((s) => s.name === EXPECT_SECTION)) {
    fail(`prompt section missing: ${sections.map((s) => s.name).join(',') || '(none)'}`);
  }

  // ── web_sites：访问网址前的"查清单" ────────────────────────────────────────
  const webSites = tools.get('web_sites');
  if (!webSites) throw new Error('web_sites not registered');

  const exact = JSON.parse((await webSites.execute({ url: SAVED })).text);
  if (exact.lookup?.saved !== true || exact.lookup?.match !== 'exact') {
    fail(`web_sites(exact): expected saved:true, got ${JSON.stringify(exact.lookup)}`);
  }
  if (!exact.note || typeof exact.note !== 'string') fail('web_sites(exact): missing note');

  const sibling = JSON.parse((await webSites.execute({ url: SIBLING })).text);
  if (sibling.lookup?.saved !== false || sibling.lookup?.match !== 'host') {
    fail(`web_sites(sibling): expected saved:false/match:host, got ${JSON.stringify(sibling.lookup)}`);
  }

  const unknown = JSON.parse((await webSites.execute({ url: UNSAVED })).text);
  if (unknown.lookup?.saved !== false || unknown.lookup?.match !== null) {
    fail(`web_sites(unknown): expected saved:false/match:null, got ${JSON.stringify(unknown.lookup)}`);
  }

  const all = JSON.parse((await webSites.execute({})).text);
  if (all.count !== 2 || !Array.isArray(all.savedSites) || all.savedSites.length !== 2) {
    fail(`web_sites(list): expected 2 saved sites, got ${JSON.stringify({ count: all.count })}`);
  }

  // ── web_open：端口没开时也要说清"这条在清单里" ──────────────────────────────
  const webOpen = tools.get('web_open');
  if (!webOpen) throw new Error('web_open not registered');
  const opened = JSON.parse((await webOpen.execute({ url: SAVED, browserPort: 6555 })).text);
  if (opened.ok !== false || opened.reason !== 'no-debug-port') {
    fail(`web_open: expected no-debug-port, got ${JSON.stringify({ ok: opened.ok, reason: opened.reason })}`);
  }
  if (opened.site?.saved !== true) fail('web_open: expected site.saved:true alongside the failure');
  if (!opened.next) fail('web_open: expected a next-step hint');

  if (process.exitCode !== 1) {
    console.log(`smoke ok: ${plugin.name} → ${tools.size} tool(s), ${routes.length} route(s), ${sections.length} prompt section(s)`);
    console.log(`  tools   : ${[...tools.keys()].join(', ')}`);
    console.log(`  routes  : ${routes.join(', ')}`);
    console.log(`  sections: ${sections.map((s) => s.name).join(', ')}`);
  }
} finally {
  if (typeof dispose === 'function') dispose();
  await rm(dir, { recursive: true, force: true });
}
