#!/usr/bin/env node
/**
 * smoke — 用一份假的 @deepseek-ai/dsh-tools 把插件 apply() 跑一遍。
 *
 * 只验证两件事：工具定义能被宿主编译（有 name / parameters / output.render），
 * 注册出来的工具名和设置页路由跟预期一致。**不执行任何工具**，不碰浏览器。
 */
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const EXPECT_TOOLS = ['web_open'];
const EXPECT_ROUTES = [
  '/dsh-browser-takeover/sites',
  '/dsh-browser-takeover/sites/add',
  '/dsh-browser-takeover/sites/remove',
  '/dsh-browser-takeover/status',
  '/dsh-browser-takeover/open-login',
];

const dir = await mkdtemp(join(tmpdir(), 'dsh-smoke-'));
const fake = join(dir, 'tools.mjs');
await writeFile(fake, `
export function defineTool(spec) {
  if (!spec || typeof spec.name !== 'string' || !spec.name) throw new Error('defineTool: missing name');
  if (!spec.parameters || typeof spec.parameters !== 'object') throw new Error('defineTool: missing parameters');
  const out = spec.output;
  if (!out || !out.schema || typeof out.render !== 'function') throw new Error('defineTool: bad output');
  return spec;
}
`, 'utf8');
process.env.DSH_TOOLS_PATH = fake;

const plugin = await import(pathToFileURL(join(process.cwd(), 'src', 'index.js')).href);
if (typeof plugin.apply !== 'function') throw new Error('plugin has no apply()');

const tools = [];
const routes = [];
const disposers = [];
const ctx = {
  tools: { register: (tool) => { tools.push(tool.name); return () => {}; } },
  get: (name) => (name === 'webServer'
    ? { register: ({ path }) => { routes.push(path); return () => {}; } }
    : undefined),
  inject: () => {},
  on: () => () => {},
  logger: { info() {}, warn() {}, error() {} },
};

let dispose;
try {
  dispose = await plugin.apply(ctx);
  const missing = EXPECT_TOOLS.filter((n) => !tools.includes(n));
  const extra = tools.filter((n) => !EXPECT_TOOLS.includes(n));
  const missingRoutes = EXPECT_ROUTES.filter((p) => !routes.includes(p));
  if (missing.length || extra.length || missingRoutes.length) {
    console.error('tools   :', tools);
    console.error('routes  :', routes);
    throw new Error(`unexpected surface (missing tools: ${missing.join(',') || '-'}; ` +
      `extra tools: ${extra.join(',') || '-'}; missing routes: ${missingRoutes.join(',') || '-'})`);
  }
  console.log(`smoke ok: ${plugin.name} → ${tools.length} tool(s), ${routes.length} route(s)`);
  console.log(`  tools : ${tools.join(', ')}`);
  console.log(`  routes: ${routes.join(', ')}`);
} finally {
  if (typeof dispose === 'function') dispose();
  for (const fn of disposers.reverse()) fn?.();
  await rm(dir, { recursive: true, force: true });
}
