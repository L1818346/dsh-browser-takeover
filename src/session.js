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

/**
 * 登录 cookie 的**已知名字**：命中即认定已登录（`confidence: 'certain'`）。
 *
 * 为什么不能只靠这一张表：每个站的会话 cookie 叫什么完全是站点自己定的。
 * 这张表原来只有学习通/B 站那一套（`SESSDATA`、`JSESSIONID`、`UID`…），于是
 * 在 GitHub 上登录成功、状态页却显示"未登录"——GitHub 用的是
 * `user_session` / `logged_in` / `dotcom_user`。所以下面还有一条通用规则。
 */
export const SESSION_COOKIE = /^(SESSDATA|bili_jct|DedeUserID|_uid|UID|DSID|fid|_d|EDU-SSO|ssoToken|token|JSESSIONID|JSESSIONID_WEB|PHPSESSID|user_session|__Host-user_session_same_site|dotcom_user|logged_in|SID|SAPISID|HSID|SSID|__Secure-1PSID|__Secure-3PSID|ESTSAUTH|ESTSAUTHPERSISTENT|z_c0|SUB)$/i;

/**
 * 通用规则：名字里带会话/单点/令牌字样，且值不像空壳（长度 ≥ 8）。
 *
 * 为什么需要：真正的登录票据几乎都长这样（`user_session`、`session_token`、`ssoTicket`…），
 * 而纯统计/偏好类 cookie（`_dd_s_v2`、`color_mode`、`cpu_bucket`）不会命中。
 * 只命中这条时**不敢说死**，回 `confidence:'likely'`，界面上显示"可能已登录"。
 *
 * 刻意不收 `sess`：GitHub 的 `_gh_sess` 在**未登录**时也有（加密的匿名会话），
 * 收了它就会把没登录的 GitHub 说成"可能已登录"。`session` 这个完整词则没有这个问题。
 */
export const SESSION_LIKE = /(?:^|[^a-z])(session|sso|auth|token|ticket|login|logged|uid)(?:[^a-z]|$)/i;

/** `logged_in` 这类开关型 cookie：值必须是 yes 才算数（`logged_in=no` 是"没登录"） */
const VALUE_YES = /^(yes|true|1)$/i;

/**
 * 一条 cookie 算不算"登录信号"。
 * @returns {'definite'|'likely'|null}
 */
export function sessionSignalOf(cookie) {
  const name = String(cookie?.name ?? '');
  if (!name) return null;
  const value = String(cookie?.value ?? '');

  // 开关型：名字在表里，但值说"没登录"
  if (/^logged_in$/i.test(name)) return VALUE_YES.test(value) ? 'definite' : null;
  if (SESSION_COOKIE.test(name)) return 'definite';
  if (value.length >= 8 && SESSION_LIKE.test(name)) return 'likely';
  return null;
}

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
 * 该站点命中的登录 cookie 名字，分成"确定"和"像"两档。
 * **只回名字，值不参与任何返回**（唯一读值的地方是 `logged_in` 的 yes/no 判断）。
 */
export function sessionSignal(cookies, host) {
  const definite = new Set();
  const likely = new Set();
  for (const cookie of cookies ?? []) {
    if (!covers(cookie?.domain, host)) continue;
    const tier = sessionSignalOf(cookie);
    if (tier === 'definite') definite.add(String(cookie.name));
    else if (tier === 'likely') likely.add(String(cookie.name));
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
 * 命中已知名字才是 `confidence:'certain'`；只靠通用规则是 `'likely'`。
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
