/**
 * session.js — 「那个浏览器此刻在每个站点的登录状态」，工具与设置页共用一份实现。
 *
 * 判定表在 session-cookies.js（身份型 / 框架通用型 / 匿名噪音 三层）；
 * 这里只负责：按 host 过滤 cookie、把命中结果折成两档结论、以及那个浏览器到底开没开。
 *
 * 判定规则：
 *   - 端口没开 → `conclusive:false`（"无法判断"），绝不冒充"未登录"；
 *   - 命中身份 cookie → `signedIn:true, confidence:'certain'`；
 *   - 只命中框架会话或通用票据规则 → `signedIn:true, confidence:'likely'`（"可能已登录"）；
 *   - 一条都没命中 → `signedIn:false`。
 *
 * 隐私边界：只回显 cookie 的**名字**。值唯一被读的地方是 `logged_in` 的 yes/no 判断，
 * 而且只用于判定，不外传、不落盘。
 */
import { listTargets, probeBrowser, readBrowserCookies } from './cdp.js';
import { loadSites } from './sites.js';
import { sessionSignalOf } from './session-cookies.js';

export { sessionSignalOf };

/** cookie 的 domain（`.chaoxing.com`）是否覆盖页面 host（`hdu.fanya.chaoxing.com`） */
export function covers(cookieDomain, host) {
  if (!cookieDomain || !host) return false;
  const d = String(cookieDomain).replace(/^\./, '').toLowerCase();
  const h = String(host).toLowerCase();
  return h === d || h.endsWith(`.${d}`);
}

export function hostOf(rawUrl) {
  try {
    return new URL(rawUrl).host;
  } catch {
    return '';
  }
}

/**
 * 该站点命中的登录 cookie 名字，分成"确定"和"可能"两档。
 * 同一个名字只出现在一档里（确定优先）。
 */
export function sessionSignal(cookies, host) {
  const definite = new Set();
  const likely = new Set();
  for (const cookie of cookies ?? []) {
    if (!covers(cookie?.domain, host)) continue;
    const tier = sessionSignalOf(cookie);
    const name = String(cookie?.name ?? '');
    if (!name) continue;
    if (tier === 'definite') definite.add(name);
    else if (tier === 'likely') likely.add(name);
  }
  for (const name of definite) likely.delete(name);
  return {
    definite: [...definite].sort(),
    likely: [...likely].sort(),
    names: [...new Set([...definite, ...likely])].sort(),
  };
}

/** 会话 cookie 名字（按站点过滤）；值一律不读出来 */
export function sessionNamesFor(cookies, host) {
  return sessionSignal(cookies, host).names;
}

/** 读一份 cookie 快照；读不到就是 null（不抛、不重试） */
export async function cookiesSnapshot(port) {
  try {
    return (await readBrowserCookies({ port })) ?? null;
  } catch {
    return null;
  }
}

/**
 * 单个站点的登录状态。
 * `conclusive` 为 false 时 `signedIn` 是 `null` 而不是 false —— 说不准就说不准。
 * 命中身份 cookie 才是 `confidence:'certain'`；只命中通用规则是 `'likely'`。
 */
export function signInFrom(cookies, host, conclusive) {
  if (!conclusive || !Array.isArray(cookies) || !host) {
    return { conclusive: false, signedIn: null, confidence: null, sessionCookieNames: [] };
  }
  const signal = sessionSignal(cookies, host);
  if (signal.names.length === 0) {
    return { conclusive: true, signedIn: false, confidence: 'certain', sessionCookieNames: [] };
  }
  return {
    conclusive: true,
    signedIn: true,
    confidence: signal.definite.length > 0 ? 'certain' : 'likely',
    sessionCookieNames: signal.names,
  };
}

/** 单站点登录状态（自己去读 cookie，用于"刚打开一个网址"之后） */
export async function signInStatus(port, rawUrl) {
  const host = hostOf(rawUrl);
  if (!host) return { conclusive: false, signedIn: null, confidence: null, sessionCookieNames: [] };
  const targets = await listTargets({ port, timeoutMs: 900 }).catch(() => null);
  const conclusive = Array.isArray(targets);
  const cookies = conclusive ? await cookiesSnapshot(port) : null;
  return signInFrom(cookies, host, conclusive && Array.isArray(cookies));
}

/**
 * 整个清单的状态快照：浏览器状态 + 打开的页面 + 每个站点的登录状态。
 * 一次调用只读一遍 cookie（10 个站点不该读 10 次）。
 *
 * @returns {Promise<{port:number, browser:object, pages:Array<{url:string,title:string}>,
 *   conclusive:boolean, sites:Array<object>}>}
 */
export async function describeSites(port, sites = loadSites()) {
  const browser = await probeBrowser({ port }).catch(() => ({ state: 'error', port, pages: 0 }));
  const targets = (await listTargets({ port }).catch(() => null)) ?? [];
  const conclusive = browser.state === 'open';
  const cookies = conclusive ? await cookiesSnapshot(port) : null;
  const pages = targets
    .filter((t) => t.type === 'page')
    .map((t) => ({ url: t.url ?? '', title: t.title ?? '' }));

  const rows = (sites ?? []).map((site) => {
    const host = hostOf(site.url);
    return { url: site.url, host, addedAt: site.addedAt ?? null, ...signInFrom(cookies, host, conclusive) };
  });

  return { port, browser, pages, conclusive, sites: rows };
}
