/**
 * lookup.js — 「用户让你打开的这条网址，插件清单里存过吗？」
 *
 * 为什么单独一层：Agent 每次要访问网址时都会先问一次，这个判断必须
 *   - 纯函数、不碰浏览器、不抛异常（问一次是零成本的，不能因此卡住对话）；
 *   - 规则固定且能被测试：完全一样 > 同一主机 > 同注册域名；
 *   - 输得明白：`saved` 只表示"这条地址确实存过"，同一站点但路径不同时另给
 *     `hostSite` / `domainSite`，让调用方自己决定，而不是替它拍板。
 *
 * 匹配刻意忽略 `www.`、末尾斜杠、query 和 hash：
 * 用户记的常常是 `https://www.bilibili.com/`，而他要去的是 `/video/BV…`；
 * 反过来，`/search?q=a` 和 `/search?q=b` 也算同一个站点入口。差异原样回显
 * （`asked` 与命中的 `site.url`），不藏着。
 */

/** 能否当作 http(s) 地址用；`bilibili.com` 这种裸域名补上 https:// 再试 */
export function parseUrl(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  let url = null;
  try {
    url = new URL(text);
  } catch {
    // 没有 scheme 的裸域名：补 https:// 再试一次。
    // 已经有 scheme 的一律按原样判（`file:` / `javascript:` 要落空，不能被补成 https）。
    try {
      url = new URL(`https://${text}`);
    } catch {
      return null;
    }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  return url;
}

/** 比较用的主机名：小写、去掉 `www.` */
export function comparableHost(host) {
  return String(host ?? '').toLowerCase().replace(/^www\./, '');
}

/**
 * 比较用的键：主机 + 路径（末尾斜杠归一），忽略 query / hash / 默认端口。
 * 解析不出来时返回 null —— 调用方据此回 `saved:false`，而不是猜一个。
 */
export function urlKey(raw) {
  const url = parseUrl(raw);
  if (!url) return null;
  const host = comparableHost(url.host);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  return `${host}${path}`;
}

/**
 * 注册域名（`hdu.fanya.chaoxing.com` → `chaoxing.com`）。
 * 只做提示级判断：`com.cn` / `co.uk` 这类二级后缀多留一段，够用且不引入公共后缀表。
 */
export function registrableDomain(host) {
  const labels = comparableHost(host).split('.').filter(Boolean);
  if (labels.length <= 2) return labels.join('.');
  const tld2 = labels.slice(-2).join('.');
  const isSecondLevelTld = /^(com|net|org|gov|edu|ac|co)\.[a-z]{2}$/.test(tld2);
  return labels.slice(isSecondLevelTld ? -3 : -2).join('.');
}

/**
 * 查一条网址在清单里的位置。
 *
 * @param {Array<{url:string, addedAt?:string|null}>} sites 清单
 * @param {string} rawUrl 要访问的地址
 * @returns {null | {
 *   asked: string, host: string, key: string, saved: boolean,
 *   match: 'exact'|'host'|'domain'|null,
 *   site: {url:string, addedAt?:string|null}|null,
 *   hostSite: {url:string, addedAt?:string|null}|null,
 *   domainSite: {url:string, addedAt?:string|null}|null,
 *   candidates: Array<{url:string, match:'exact'|'host'|'domain'}>,
 * }}
 */
export function lookupSite(sites, rawUrl) {
  const url = parseUrl(rawUrl);
  if (!url) return null;
  const key = urlKey(rawUrl);
  if (!key) return null;
  const host = url.host;
  const hostKey = comparableHost(host);
  const domain = registrableDomain(host);

  let site = null;
  let hostSite = null;
  let domainSite = null;
  const candidates = [];

  for (const entry of sites ?? []) {
    const entryUrl = parseUrl(entry?.url);
    if (!entryUrl) continue;
    const entryKey = urlKey(entry.url);
    const entryHost = comparableHost(entryUrl.host);
    const record = { url: String(entry.url), addedAt: entry?.addedAt ?? null };

    if (entryKey && entryKey === key) {
      if (!site) site = record;
      candidates.push({ url: record.url, match: 'exact' });
      continue;
    }
    if (entryHost === hostKey) {
      if (!hostSite) hostSite = record;
      candidates.push({ url: record.url, match: 'host' });
      continue;
    }
    if (domain && registrableDomain(entryHost) === domain) {
      if (!domainSite) domainSite = record;
      candidates.push({ url: record.url, match: 'domain' });
    }
  }

  const match = site ? 'exact' : (hostSite ? 'host' : (domainSite ? 'domain' : null));
  return {
    asked: url.toString(),
    host,
    key,
    saved: Boolean(site),
    match,
    site,
    hostSite,
    domainSite,
    candidates: candidates.slice(0, 6),
  };
}

/**
 * 「算不算已知站点」——启动浏览器这种有副作用的决定用得上：
 * 同一主机也算（它的登录态对这条地址同样有效），同域名不算（那是另一个应用）。
 */
export function isKnownSite(lookup) {
  return Boolean(lookup && (lookup.saved || lookup.hostSite));
}

/** 给模型看的一句话结论，避免它自己从字段里二次推断 */
export function describeLookup(lookup) {
  if (!lookup) return '这条地址不是 http(s) 网址，插件清单判断不了。';
  if (lookup.saved) {
    return `清单里有这条网址（${lookup.site?.url ?? lookup.asked}）——用 web_open 在插件浏览器里打开，那里是用户已登录的会话。`;
  }
  if (lookup.hostSite) {
    return `这条具体地址没存过，但同一站点已登记（${lookup.hostSite.url}）——登录态同样适用，建议直接用 web_open。`;
  }
  if (lookup.domainSite) {
    return `同一域名下登记过别的地址（${lookup.domainSite.url}），但主机不同，登录态不一定通用；可以用 web_open，必要时先让用户在浏览器里登录。`;
  }
  return '清单里没有这个站点。仍可用 web_open 打开；需要登录的站点先让用户在浏览器里登录一次，再用 remember:true 记进清单。';
}
