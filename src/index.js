/**
 * index.js — 浏览器网址接管插件的入口。
 *
 * 两件事：
 *   1. `web_open` 工具：在已经带着调试端口（且登录过）的浏览器里打开地址、按可见文字点一个入口。
 *      只走页面，不播放、不碰账号密码。
 *   2. 设置页 + 两条 HTTP 路由：维护"要登录的网址"清单、查每个站点的登录状态、打开登录页。
 *
 * 端口配置优先读 `~/.dsh/browser.json`，也接受 `~/.dsh/video.json`。
 *
 * 契约要点（对着 @deepseek-ai/dsh-tools 的类型定义核对的）：
 *  - `apply` 返回 disposer（把所有 ctx.tools.register() / 路由 / 监听的返回值串起来）
 *  - `execute` 返回过 output.schema 的规范值
 *  - 插件的异常不能拖垮宿主：apply 里一律吞掉并记日志（DSH_BROWSER_DEBUG=1 时才抛出）
 */

import { configuredPort } from './browser-time.js';
import { webOpenToolSpec } from './tool-spec.js';
import { webOpen } from './web-nav.js';
import { registerSettingsApi } from './settings-api.js';

export const name = 'dsh-browser-takeover';
export const inject = ['tools'];

/**
 * 解析宿主的 dsh-tools。正常安装时裸包名就能解析；本地开发/测试时
 * 用 DSH_TOOLS_PATH 指向安装里的 lib/index.js。
 */
async function loadDefineTool() {
  try {
    const mod = await import('@deepseek-ai/dsh-tools');
    if (mod?.defineTool) return mod.defineTool;
  } catch {
    /* 落到环境变量 */
  }
  const override = process.env.DSH_TOOLS_PATH;
  if (override) {
    const { pathToFileURL } = await import('node:url');
    const mod = await import(pathToFileURL(override).href);
    if (mod?.defineTool) return mod.defineTool;
  }
  throw new Error('cannot resolve @deepseek-ai/dsh-tools (set DSH_TOOLS_PATH for local dev)');
}

export async function apply(ctx) {
  try {
    return await registerAll(ctx);
  } catch (e) {
    // 最坏的情况是插件不能用，不是应用起不来。
    try {
      ctx?.logger?.error?.(`[dsh-browser-takeover] failed to load: ${e?.stack ?? e}`);
    } catch { /* 连日志都写不了就算了 */ }
    if (process.env.DSH_BROWSER_DEBUG) throw e;
    return () => {};
  }
}

async function registerAll(ctx) {
  const defineTool = await loadDefineTool();

  // 导航：在带调试端口的浏览器里打开地址、按可见文字点一个入口（只走页面，不播放）
  const webOpenTool = defineTool({
    ...webOpenToolSpec(),
    async execute(args) {
      const port = Number(args?.browserPort) > 0
        ? Number(args.browserPort)
        : (configuredPort() ?? 9333);
      const result = await webOpen({
        port,
        url: typeof args?.url === 'string' && args.url ? args.url : null,
        match: typeof args?.match === 'string' && args.match ? args.match : null,
        index: Number.isInteger(args?.index) ? args.index : 0,
        waitMs: Number.isFinite(args?.waitMs) ? Number(args.waitMs) : 2500,
        listOnly: args?.listOnly === true,
      });
      return { text: JSON.stringify(result, null, 1) };
    },
  });

  const disposers = [ctx.tools.register(webOpenTool)];

  // 设置页的两条 HTTP 路由（登录状态 / 打开登录页）。
  //
  // **不能直接 ctx.get('webServer') 了事**：插件可能比 web-runtime 先 apply，那时服务还没注册，
  // 拿到的 undefined 会被当成"宿主没有 web 载体"，路由就永远挂不上（实测：重启后
  // /dsh-browser-takeover/status 直接 404，而设置页照常注册——两边表现不一致，很难查）。
  // 所以这里按 cordis 的方式等一下：已经有就直接挂，没有就 ctx.inject 等它出现。
  const mountSettingsApi = (scope) => {
    try {
      disposers.push(registerSettingsApi(scope));
    } catch (e) {
      try {
        ctx?.logger?.warn?.(`[dsh-browser-takeover] settings api not registered: ${e?.message ?? e}`);
      } catch { /* 日志都没有就只能算了 */ }
    }
  };
  try {
    const webServer = typeof ctx.get === 'function' ? ctx.get('webServer') : undefined;
    if (webServer) {
      mountSettingsApi(ctx);
    } else if (typeof ctx.inject === 'function') {
      ctx.inject(['webServer'], (scope) => mountSettingsApi(scope ?? ctx));
    }
  } catch (e) {
    try {
      ctx?.logger?.warn?.(`[dsh-browser-takeover] settings api deferred: ${e?.message ?? e}`);
    } catch { /* 同上 */ }
  }

  return () => {
    for (const dispose of disposers.reverse()) dispose?.();
  };
}
