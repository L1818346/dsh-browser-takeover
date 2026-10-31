/**
 * settings-api.js — 设置页和宿主之间的 HTTP 路由（同源 fetch，不走 RPC）。
 *
 * 为什么用路由而不是 host.call：设置页是同一个 origin 下的 React 页面，
 * `fetch('/dsh-browser-takeover/sites')` 比再引一层 RPC 简单，浏览器 Network 面板也直接能看。
 *
 * 路由：
 *   GET  /sites                → 清单里每个网址的登录状态
 *   POST /sites/add  {url}     → 往清单里加一条
 *   POST /sites/remove {url}   → 删一条
 *   POST /open-login {url}     → 在调试浏览器里打开登录页（不填表、不读输入框）
 *   GET  /status?host=…        → 单站点查询（给工具/排障用，设置页已改用 /sites）
 *
 * **绝不返回 cookie 的值**，只返回命中会话 cookie 的**名字**。名字泄露没有意义，值才是事故。
 *
 * 登录态本身由 session.js 统一回答（`web_sites` 工具走同一份实现）：这里只做 HTTP 包装。
 */
import {
  configuredPort, evaluate, launchBrowser, listTargets, waitForPort,
} from './browser-time.js';
import { addSite, loadSites, removeSite } from './sites.js';
import { describeSites, hostOf, signInStatus } from './session.js';

const BASE = '/dsh-browser-takeover';

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(text);
}

function readBody(req, limit = 8 * 1024) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size <= limit) chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(''));
  });
}

function sitesHandler(port) {
  return async (req, res) => {
    try {
      const snapshot = await describeSites(port);
      sendJson(res, 200, {
        ok: true,
        port,
        browser: snapshot.browser,
        pages: snapshot.pages,
        sites: snapshot.sites,
      });
    } catch (error) {
      sendJson(res, 200, { ok: false, where: 'sites', error: String(error?.message ?? error) });
    }
  };
}

function addHandler() {
  return async (req, res) => {
    try {
      const raw = await readBody(req);
      let url = '';
      try { url = String(JSON.parse(raw || '{}')?.url ?? ''); } catch { url = ''; }
      const result = addSite(url);
      sendJson(res, result.ok ? 200 : 400, result);
    } catch (error) {
      sendJson(res, 200, { ok: false, where: 'sites/add', error: String(error?.message ?? error) });
    }
  };
}

function removeHandler() {
  return async (req, res) => {
    try {
      const raw = await readBody(req);
      let url = '';
      try { url = String(JSON.parse(raw || '{}')?.url ?? ''); } catch { url = ''; }
      const result = removeSite(url);
      sendJson(res, result.ok ? 200 : 400, result);
    } catch (error) {
      sendJson(res, 200, { ok: false, where: 'sites/remove', error: String(error?.message ?? error) });
    }
  };
}

async function statusHandler(req, res) {
  try {
    const port = configuredPort() ?? 9333;
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    const wantHost = url.searchParams.get('host') || '';
    const snapshot = await describeSites(port);
    const signIn = wantHost
      ? await signInStatus(port, `https://${wantHost}/`)
      : { conclusive: false, signedIn: null, sessionCookieNames: [] };
    sendJson(res, 200, {
      ok: true,
      port,
      host: wantHost || null,
      browser: snapshot.browser,
      pages: snapshot.pages,
      signedIn: signIn.signedIn,
      sessionCookieNames: signIn.sessionCookieNames,
      conclusive: wantHost ? signIn.conclusive : snapshot.conclusive,
      addedCount: snapshot.sites.length,
      clientHalfInGraph: clientHalfInGraph(),
    });
  } catch (error) {
    sendJson(res, 200, { ok: false, where: 'status', error: String(error?.message ?? error) });
  }
}

async function openLoginHandler(req, res) {
  try {
    const raw = await readBody(req);
    let url = '';
    try { url = String(JSON.parse(raw || '{}')?.url ?? ''); } catch { url = ''; }
    if (!/^https?:\/\//i.test(url)) {
      sendJson(res, 400, { ok: false, error: 'url must be an http(s) address' });
      return;
    }
    const port = configuredPort() ?? 9333;
    const existing = await listTargets({ port });
    if (existing) {
      // 端口已经开着：**开一个新标签**，不劫持用户正在看的那一页
      try {
        const r = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
        if (r.ok) {
          sendJson(res, 200, { ok: true, via: 'new-tab', port, url });
          return;
        }
      } catch { /* 落到导航当前页 */ }
      const page = existing.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) {
        await evaluate(page.webSocketDebuggerUrl, `location.href=${JSON.stringify(url)}`, { timeoutMs: 3000 });
        sendJson(res, 200, { ok: true, via: 'navigate', port, url });
        return;
      }
    }
    const launched = launchBrowser({ port, url });
    let via = launched.via ?? 'launch';
    // 计划任务的旧定义可能仍带着上一次的网址。等端口起来后核对一遍：
    // 目标站没出现在任何标签页上，就补开一个正确的标签（不改用户已有的页面）。
    if (launched.ok === true) {
      const up = await waitForPort(port, { timeoutMs: 12_000 });
      if (up) {
        const targets = (await listTargets({ port }).catch(() => null)) ?? [];
        const wantHost = hostOf(url);
        const hit = targets.some((t) => t.type === 'page' && wantHost
          && hostOf(t.url ?? '') === wantHost);
        if (!hit) {
          try {
            const r = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
            if (r.ok) via = `${via}+new-tab`;
          } catch { /* 补不开就只能报告原样 */ }
        }
      }
    }
    sendJson(res, 200, { ok: launched.ok === true, via, port, url, detail: launched });
  } catch (error) {
    sendJson(res, 200, { ok: false, where: 'open-login', error: String(error?.message ?? error) });
  }
}

/** 挂路由时留一份 ctx，供诊断字段（client 模块图）用 */
let registeredCtx = null;

/**
 * 把路由挂到宿主 webServer 上。没有 webServer（比如纯 CLI 宿主）就静默跳过：
 * 设置页只是可选入口，不该让插件在别的宿主里加载失败。
 */
export function registerSettingsApi(ctx) {
  registeredCtx = ctx;
  const webServer = typeof ctx?.get === 'function' ? ctx.get('webServer') : undefined;
  if (!webServer || typeof webServer.register !== 'function') return () => {};
  const port = () => configuredPort() ?? 9333;
  const routes = [
    [`${BASE}/sites`, sitesHandler(port())],
    [`${BASE}/sites/add`, addHandler()],
    [`${BASE}/sites/remove`, removeHandler()],
    [`${BASE}/status`, statusHandler],
    [`${BASE}/open-login`, openLoginHandler],
  ];
  const disposers = routes.map(([path, handler]) => webServer.register({ kind: 'exact', path, handler }));
  return () => {
    for (const dispose of disposers.reverse()) {
      try { dispose?.(); } catch { /* 已经卸了 */ }
    }
  };
}

/** 只在有这个服务时探测；任何异常都吞掉——它只是诊断字段 */
function clientHalfInGraph() {
  try {
    const cm = registeredCtx?.get?.('clientModules');
    if (!cm || typeof cm.graph !== 'function') return null;
    const graph = cm.graph();
    const ids = [];
    if (graph instanceof Map) {
      for (const key of graph.keys()) ids.push(String(key));
    } else if (Array.isArray(graph)) {
      for (const item of graph) ids.push(String(item?.id ?? item?.name ?? ''));
    } else if (graph && typeof graph === 'object') {
      ids.push(...Object.keys(graph));
    }
    const flat = JSON.stringify(graph, (k, v) => (v instanceof Map ? [...v.keys()] : v)) ?? '';
    return {
      type: Object.prototype.toString.call(graph),
      count: ids.length,
      sample: ids.slice(0, 8),
      has: ids.some((id) => id.includes('dsh-browser-takeover')) || flat.includes('dsh-browser-takeover'),
    };
  } catch (error) {
    return { error: String(error?.message ?? error) };
  }
}

export { BASE as SETTINGS_API_BASE, hostOf };
