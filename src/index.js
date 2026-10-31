/**
 * index.js — 浏览器网址接管插件的入口。
 *
 * 三件事：
 *   1. `web_sites` 工具：这条网址在用户的「要登录的网址」清单里吗？那个浏览器此刻登录着没有？
 *      零副作用——不启动浏览器、不打开页面。
 *   2. `web_open` 工具：在已经带着调试端口（且登录过）的浏览器里打开地址、按可见文字点一个入口。
 *      打开的同时回报"这条网址是否在清单里、登录着没有"，所以 Agent 先查后开都有据可依。
 *   3. 系统提示里的一段约定：访问网址先查清单，清单里有就优先走这个插件（见 prompt.js）。
 *
 * 端口配置优先读 `~/.dsh/browser.json`，也接受 `~/.dsh/video.json`。
 *
 * 契约要点（对着 @deepseek-ai/dsh-tools 的类型定义核对的）：
 *  - `apply` 返回 disposer（把所有 ctx.tools.register() / 路由 / 监听 / 提示词段的返回值串起来）
 *  - `execute` 返回过 output.schema 的规范值
 *  - 插件的异常不能拖垮宿主：apply 里一律吞掉并记日志（DSH_BROWSER_DEBUG=1 时才抛出）
 */

import { configuredLaunch, configuredPort, launchBrowser, waitForPort } from './browser-time.js';
import { addSite, loadSites } from './sites.js';
import { describeLookup, isKnownSite, lookupSite } from './lookup.js';
import { describeSites, reachable, signInStatus } from './session.js';
import { registerRoutingSection } from './prompt.js';
import { webOpenToolSpec, webSitesToolSpec } from './tool-spec.js';
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

/** 端口只该有一个说法：显式参数 > browser.json / video.json > 9333 */
function resolvePort(args) {
  const explicit = Number(args?.browserPort);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  return configuredPort() ?? 9333;
}

function textArg(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** launchBrowser 自己会兜异常，这里只防它抛到工具调用里 */
function safeLaunch(port, url) {
  try {
    return launchBrowser({ port, url: url ?? '' }) ?? null;
  } catch (e) {
    return { ok: false, reason: String(e?.message ?? e).slice(0, 160) };
  }
}

async function registerAll(ctx) {
  const defineTool = await loadDefineTool();
  const disposers = [];

  // ── 1. 查清单：访问网址前先问一次 ────────────────────────────────────────────
  const webSitesTool = defineTool({
    ...webSitesToolSpec(),
    async execute(args) {
      const port = resolvePort(args);
      const url = textArg(args?.url);
      const browser = await reachable(port).catch(() => ({ state: 'unknown', pages: 0 }));

      if (!url) {
        const snapshot = await describeSites(port).catch(() => ({
          port, browser, pages: [], conclusive: false, sites: [],
        }));
        return {
          text: JSON.stringify({
            ok: true,
            port,
            browser: { ...snapshot.browser, state: snapshot.browser?.state ?? browser.state },
            conclusive: snapshot.conclusive,
            count: snapshot.sites.length,
            savedSites: snapshot.sites,
            note: snapshot.sites.length
              ? '这是插件清单里的全部网址；saved 恒为 true，signedIn 是那个浏览器此刻的登录状态。'
              : '清单是空的：用户还没登记过任何网址。',
          }, null, 1),
        };
      }

      const lookup = lookupSite(loadSites(), url);
      const signIn = await signInStatus(port, url).catch(() => null);
      return {
        text: JSON.stringify({
          ok: true,
          port,
          browser,
          lookup,
          signIn,
          note: describeLookup(lookup),
          next: '用 web_open 打开它（saved 或 hostSite 命中时优先用 web_open，而不是 web_fetch）。',
        }, null, 1),
      };
    },
  });

  // ── 2. 走页面：打开地址、按可见文字点一个入口 ─────────────────────────────────
  const webOpenTool = defineTool({
    ...webOpenToolSpec(),
    async execute(args) {
      const port = resolvePort(args);
      const url = textArg(args?.url);
      let lookup = url ? lookupSite(loadSites(), url) : null;

      // remember: 先把网址记进清单，再打开——这样返回里的 saved 就是"下一次访问时的答案"
      let rememberResult = null;
      if (url && args?.remember === true) {
        if (lookup?.saved) {
          rememberResult = { ok: true, added: false, alreadySaved: true, url };
        } else {
          const added = addSite(url);
          rememberResult = { ok: added.ok === true, added: added.added === true, url };
          if (added.ok) lookup = lookupSite(loadSites(), url);
        }
      }

      const call = () => webOpen({
        port,
        url,
        match: textArg(args?.match),
        index: Number.isInteger(args?.index) ? Math.max(0, args.index) : 0,
        waitMs: Number.isFinite(args?.waitMs) ? Number(args.waitMs) : 2500,
        listOnly: args?.listOnly === true,
      });

      let result = await call();
      let launched = null;

      // 端口没开，而这是"已知站点"（或调用方明确要拉浏览器）→ 拉起一次再重试
      const shouldLaunch = args?.launch === true || (isKnownSite(lookup) && configuredLaunch());
      if (!result.ok && result.reason === 'no-debug-port' && shouldLaunch) {
        launched = safeLaunch(port, url);
        const up = launched?.ok === true
          && await waitForPort(port, { timeoutMs: 12_000 }).catch(() => false);
        if (up) {
          result = await call();
          launched = { ...launched, ready: true };
        } else {
          launched = { ...(launched ?? {}), ready: false };
        }
      }

      const signIn = url ? await signInStatus(port, url).catch(() => null) : null;
      const payload = {
        ...result,
        ...(lookup ? {
          site: {
            asked: lookup.asked,
            saved: lookup.saved,
            match: lookup.match,
            hostSite: lookup.hostSite,
            domainSite: lookup.domainSite,
            note: describeLookup(lookup),
          },
        } : {}),
        ...(signIn ? { signIn } : {}),
        ...(rememberResult ? { remembered: rememberResult } : {}),
        ...(launched ? { launch: launched } : {}),
      };
      if (!result.ok && result.reason === 'no-debug-port') {
        payload.next = launched
          ? '浏览器没起来。让用户运行 scripts\\start-edge-debug.cmd，或检查 browser.json 里的 browserPort。'
          : '调试浏览器没开。让用户启动它，或调用 web_open({ url, launch: true }) 让插件自己拉起。';
      }
      return { text: JSON.stringify(payload, null, 1) };
    },
  });

  disposers.push(ctx.tools.register(webOpenTool));
  disposers.push(ctx.tools.register(webSitesTool));

  // ── 3. 系统提示：访问网址先查清单，清单里有就优先走这个插件 ────────────────────
  //
  // `systemPrompt` 是可选服务（纯 CLI 宿主可能没有），所以按 cordis 的方式等它出现；
  // 注册不出来只影响"模型更自觉"，不影响工具本身可用。
  const mountPrompt = (scope) => {
    try {
      disposers.push(registerRoutingSection(scope ?? ctx));
    } catch (e) {
      try {
        ctx?.logger?.warn?.(`[dsh-browser-takeover] prompt section not registered: ${e?.message ?? e}`);
      } catch { /* 日志都没有就只能算了 */ }
    }
  };
  try {
    const systemPrompt = typeof ctx.get === 'function' ? ctx.get('systemPrompt') : undefined;
    if (systemPrompt && typeof systemPrompt.section === 'function') {
      mountPrompt(ctx);
    } else if (typeof ctx.inject === 'function') {
      ctx.inject(['systemPrompt'], (scope) => mountPrompt(scope));
    }
  } catch (e) {
    try {
      ctx?.logger?.warn?.(`[dsh-browser-takeover] prompt section deferred: ${e?.message ?? e}`);
    } catch { /* 同上 */ }
  }

  // ── 4. 设置页的两条 HTTP 路由（登录状态 / 打开登录页） ──────────────────────────
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
