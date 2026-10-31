/**
 * session-cookies.js — 「这条 cookie 算不算登录证据」的判定表。
 *
 * 为什么分三层而不是一张"大白名单"：每个站点的会话 cookie 名字完全是站点自己定的，
 * 同名的东西在不同站点的含义还可能相反。所以这里按**证据强度**分档：
 *
 *   identity   只有登录后才出现（或出现即代表某个已登录身份）        → 「已登录」
 *   generic    框架/平台的会话 cookie，匿名访客也会拿到（PHPSESSID）→ 「可能已登录」
 *   anonymous  明确与登录无关（统计、CSRF、负载均衡、界面偏好）      → 永不计数
 *
 * 再兜一条通用规则：名字里带会话/令牌字样、且值不短 → 「可能已登录」。
 * 表里没有的站点就靠它兜底，不至于一上来就报"未登录"（GitHub 当初就是这么漏的）。
 *
 * 名字一律按小写比较；新增站点时把名字加进 `IDENTITY_COOKIES` 即可。
 */

/** ① 身份 cookie —— 命中即「已登录」 */
const IDENTITY_COOKIES = [
  // GitHub（登录后才有 user_session / logged_in / dotcom_user）
  'user_session', '__host-user_session_same_site', 'dotcom_user', 'logged_in',
  // Google / YouTube（登录后这几条一起出现）
  'hsid', 'ssid', 'apisid', 'sapisid',
  '__secure-1psid', '__secure-3psid', '__secure-1papisid', '__secure-3papisid',
  '__secure-1psidts', '__secure-3psidts',
  // Microsoft / Office / Outlook / Teams
  'estsauth', 'estsauthpersistent', 'estsauth1', 'fedauth', 'fedauth1',
  '.aspxauth', '.aspxauth1', '.aspnet.cookies', '.aspnetcore.identity.application',
  // Meta / Instagram
  'c_user', 'xs', 'ds_user_id',
  // X / Twitter
  'auth_token', 'twid',
  // LinkedIn / Reddit / Stack Overflow
  'li_at', 'reddit_session', 'acct',
  // Amazon
  'at-main', 'sess-at-main', 'x-main', 'session-token',
  // 流媒体与订阅
  'netflixid', 'securenetflixid', 'sp_dc', 'sp_key',
  // 游戏与社群
  'auth-token', 'token', 'steamloginsecure', 'steamlogin',
  // 协作 / 笔记
  'token_v2', 'notion_user_id', 'cloud.session.token', 'tenant.session.token',
  // 单点登录 / 身份代理
  'cf_authorization', 'castgc', 'jaauthcookie',
  'keycloak_identity', 'keycloak_session', 'keycloak_auth',
  'keycloak_identity_legacy', 'keycloak_session_legacy',
  'spring_security_remember_me_cookie', 'remember-me',
  // 认证框架
  'next-auth.session-token', '__secure-next-auth.session-token', '__host-next-auth.session-token',
  '__session', 'remember_token', 'remember_user_token',
  // 通用票据类名字（多数框架的登录态就叫这些）
  'jwt', 'access_token', 'id_token', 'refresh_token', 'bearer', 'authorization',
  // 百度 / 微博（SUB 太泛，只留 Weibo 独有的三条）
  'bduss', 'bduss_bfess', 'stoken', 'ptoken', 'subp', 'sue', 'alf',
  // 阿里系（淘宝 / 天猫 / 闲鱼 / 阿里云）
  '_tb_token_', 'cookie2', '_l_g_', 'tracknick', 'lgc', 'uc1', 'uc3', 'uc4', 'unb',
  'sgcookie', 'thw', 'login_aliyunid_ticket', 'login_aliyunid',
  // 京东 / 拼多多
  'thor', 'pt_key', 'pt_pin', 'pddaccesstoken', 'pdd_user_id',
  // 抖音 / 小红书 / 知乎 / 豆瓣（dbcl2 是豆瓣的登录票据；裸 ck 太泛，不收）
  'sid_tt', 'sid_guard', 'sessionid_ss', 'web_session', 'z_c0', 'dbcl2',
  // B 站 / 学习通 / 网易 / 腾讯
  'sessdata', 'bili_jct', 'dedeuserid', 'dedeuserid__ckmd5', 'bili_ticket',
  '_uid', 'fid', '_d', 'cx_p_token', 'p_auth_token',
  'ntes_sess', 'uin', 'skey', 'p_skey', 'pt2gguin', 'ptui_loginuin',
  'wxuin', 'wxsid', 'webwx_data_ticket', 'webwx_auth_ticket',
  // CSDN / Coursera / edX
  'usertoken', 'username', 'cauth', 'edxloggedin',
];

/** ② 框架通用会话 cookie —— 匿名访客也会拿到，只能算「可能已登录」 */
const GENERIC_SESSION_COOKIES = [
  'phpsessid', 'jsessionid', 'jsessionid_web', 'asp.net_sessionid', 'aspsessionid',
  'laravel_session', 'connect.sid', '_gitlab_session', 'moodlesession', 'sakaiid',
  'bbrouter', '_normandy_session', 'playsession', '_session_id', 'asp.netcore.session',
  'sessionid', 'session', 'sessid', 'sid', 'authsession', 'uid',
];

/** ③ 与登录无关的常见 cookie —— 名字再像票据也不计数 */
const ANONYMOUS_COOKIES = [
  // Meta 的匿名追踪
  'datr', 'sb', 'fr', '_fbp', '_fbc',
  // Google 的广告/同意 cookie（SIDCC / DSID / NID 都不代表登录）
  'nid', 'anid', '1p_jar', 'sidcc', 'aec', 'consent', 'socs', 'search_samesite', 'dsid',
  // 设备 / 访客标识
  'd_c0', 'api_uid', 'uuid_tt_dd', 'dc_sid', 'ttwid', 'mstoken', 'odin_tt',
  'cna', '_cc_', 'xlly_s', 'tfstk', 'isg', 'bcookie', 'liap', 'muid', 'ct0',
  'a1', 'webid', 'mid', 'did', 'passport_csrf_token',
  // CSRF / 一次性令牌
  'csrftoken', 'csrf_token', 'xsrf-token', '_csrf', 'atlassian.xsrf.token',
  '__host-next-auth.csrf-token', 'authenticity_token',
  // 负载均衡 / 反爬
  'awselb', 'awsalb', 'awsalbcors', '__cf_bm', 'cf_clearance', '__cfruid',
  // 会话但"匿名也有"的
  '_gh_sess', '_octo', 'saved_user_sessions',
  // 界面偏好 / 埋点
  'color_mode', 'preferred_color_mode', 'cpu_bucket', 'tz', 'ui_eligible',
  '_device_id', 'last_write_ms', 'cookieconsent', 'theme', 'lang', 'locale',
];

/** 前缀/正则形式的身份 cookie（Shibboleth、Supabase、Laravel remember…） */
const IDENTITY_PATTERNS = [
  /^_shibsession_/i,                  // Shibboleth SSO
  /^_shibstate_/i,
  /^remember_web_/i,                  // Laravel「记住我」
  /^sb-[a-z0-9]{6,}-auth-token$/i,    // Supabase
  /^_oauth2_proxy/i,                  // oauth2-proxy 网关
];

/** 前缀/正则形式的框架会话 cookie（匿名也会有） */
const GENERIC_PATTERNS = [
  /^aspsessionid/i,                   // ASP 的 ASPSESSIONIDXXXX
];

/** 前缀/正则形式的匿名 cookie（统计、埋点、弹层） */
const ANONYMOUS_PATTERNS = [
  /^_ga/i, /^_gid$/i, /^_gat/i, /^_gcl/i,
  /^_hj/i,                            // Hotjar：_hjSessionUser_*、_hjAbsoluteSessionInProgress
  /^_dd_/i,                           // Datadog RUM
  /^_pin_/i, /^_clck$/i, /^_clsk$/i, /^_uet/i, /^_scid$/i,
  /^mp_/i, /^ajs_/i, /^amplitude/i, /^intercom-/i, /^_shopify_/i,
  /^__cf/i, /^awsalb/i, /^awsleb$/i, /^bigipserver/i, /^routeid$/i,
];

const IDENTITY_SET = new Set(IDENTITY_COOKIES.map((n) => n.toLowerCase()));
const GENERIC_SET = new Set(GENERIC_SESSION_COOKIES.map((n) => n.toLowerCase()));
const ANONYMOUS_SET = new Set(ANONYMOUS_COOKIES.map((n) => n.toLowerCase()));

/**
 * 通用兜底：名字里带会话/单点/令牌字样，且值不像空壳（长度 ≥ 8）。
 *
 * `sess` 也收（`_gh_sess` 之类已在 ANONYMOUS 里挡掉）：宁可说"可能已登录"，
 * 也不要在真的登录了的时候说"未登录"。
 */
const SESSION_LIKE = /(?:^|[^a-z])(session|sess|sso|auth|token|ticket|login|logon|logged|uid|jwt|bearer|passport|remember|credential|identity|principal|userid|user_id|username)(?:[^a-z]|$)/i;

/** `logged_in` 这类开关型 cookie：值必须是 yes 才算数（`logged_in=no` 是"没登录"） */
const VALUE_YES = /^(yes|true|1)$/i;

const matchesAny = (patterns, name) => patterns.some((p) => p.test(name));

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

  // 先排掉明确无关的，避免 _gh_sess / csrftoken / _hjSessionUser_* 这类误报
  if (ANONYMOUS_SET.has(name.toLowerCase()) || matchesAny(ANONYMOUS_PATTERNS, name)) return null;

  if (IDENTITY_SET.has(name.toLowerCase()) || matchesAny(IDENTITY_PATTERNS, name)) return 'definite';
  if (GENERIC_SET.has(name.toLowerCase()) || matchesAny(GENERIC_PATTERNS, name)) return 'likely';
  if (value.length >= 8 && SESSION_LIKE.test(name)) return 'likely';
  return null;
}
