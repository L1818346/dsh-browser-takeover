/**
 * session.js — 「那个浏览器此刻在每个站点的登录状态」，工具与设置页共用一份实现。
 *
 * 为什么要把这段从 settings-api.js 里搬出来：现在有两个入口问同一个问题——
 * 设置页的界面，以及 Agent 调 `web_sites` 时的查询。两边各写一遍必然漂移，
 * 而这里正是**隐私边界**所在：只回显会话 cookie 的**名字**，值不离开宿主进程。
 *
 * 判定规则不变：
 *   - 端口没开 → `conclusive:false`（"无法判断"），绝不冒充"未登录"；
 *   - 端口开了 → 该站点的会话 cookie 存在即视为已登录。
 */
import { listTargets, probeBrowser, readBrowserCookies } from './cdp.js';
import { loadSites } from './sites.js';

/** 这些 cookie 一旦出现，基本可以认定"这个浏览器在该站点是登录状态"。 */
export const SESSION_COOKIE = /^(SESSDATA|bili_jct|DedeUserID|_uid|UID|DSID|fid|JSESSIONID|JSESSIONID_WEB|_d|EDU-SSO|ssoToken|token)$/i;

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

/** 会话 cookie 名字（按站点过滤）；值一律不读出来 */
export function sessionNamesFor(cookies, host) {
  return [...new Set(
    (cookies ?? [])
      .filter((c) => SESSION_COOKIE.test(String(c?.name ?? '')) && covers(c?.domain, host))
      .map((c) => String(c.name)),
  )].sort();
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
 */
export function signInFrom(cookies, host, conclusive) {
  if (!conclusive || !Array.isArray(cookies) || !host) {
    return { conclusive: false, signedIn: null, sessionCookieNames: [] };
  }
  const names = sessionNamesFor(cookies, host);
  return { conclusive: true, signedIn: names.length > 0, sessionCookieNames: names };
}

/** 单站点登录状态（自己去读 cookie，用于"刚打开一个网址"之后） */
export async function signInStatus(port, rawUrl) {
  const host = hostOf(rawUrl);
  if (!host) return { conclusive: false, signedIn: null, sessionCookieNames: [] };
  const targets = await listTargets({ port, timeoutMs: 900 }).catch(() => null);
  const conclusive = Array.isArray(targets);
  const cookies = conclusive ? await cookiesSnapshot(port) : null;
  return signInFrom(cookies, host, conclusive && Array.isArray(cookies));
}

/**
 * 整个清单的状态快照：浏览器状态 + 打开的页面 + 每个站点的登录状态。
 * 一次调用只读一遍 cookie（4 个站点不该读 4 次）。
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
