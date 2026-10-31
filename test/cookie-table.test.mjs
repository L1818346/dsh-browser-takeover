/**
 * cookie-table.test.mjs — 判定表（session-cookies.js）的覆盖与误报测试。
 *
 * 目标有两个，缺一不可：
 *   1. 主流平台的登录 cookie 名字都要认得（不能"登录了却说未登录"）；
 *   2. 匿名访客也会拿到的 cookie 不能算登录（不能"没登录却说已登录"）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { signInFrom, sessionSignalOf } from '../src/session.js';

const c = (name, value = 'v'.repeat(32), domain = 'example.com') => ({ name, value, domain });

/** 只带这些 cookie 的站点，应当被判成「已登录」（certain） */
const CERTAIN_CASES = [
  ['GitHub', [c('user_session'), c('logged_in', 'yes'), c('dotcom_user')]],
  ['Google', [c('SID'), c('HSID'), c('SSID'), c('SAPISID'), c('__Secure-1PSID')]],
  ['Microsoft', [c('ESTSAUTH'), c('ESTSAUTHPERSISTENT')]],
  ['Facebook', [c('c_user'), c('xs')]],
  ['LinkedIn', [c('li_at')]],
  ['Amazon', [c('at-main'), c('session-token')]],
  ['Netflix', [c('NetflixId')]],
  ['Baidu', [c('BDUSS'), c('STOKEN')]],
  ['Taobao', [c('_tb_token_'), c('cookie2')]],
  ['JD', [c('thor'), c('pt_key')]],
  ['Weibo', [c('SUB'), c('SUBP'), c('SUE'), c('ALF')]],
  ['Zhihu', [c('z_c0')]],
  ['Douban', [c('dbcl2')]],
  ['Bilibili', [c('SESSDATA'), c('bili_jct'), c('DedeUserID')]],
  ['Chaoxing', [c('_uid'), c('fid'), c('_d')]],
  ['Keycloak', [c('KEYCLOAK_IDENTITY'), c('KEYCLOAK_SESSION')]],
  ['Shibboleth', [c('_shibsession_656e73696d706c65')]],
  ['Supabase', [c('sb-abcdefghijklmnop-auth-token')]],
  ['Laravel remember', [c('remember_web_59ba36addc2b2f9401580f014c7f58ea4e30989d')]],
  ['NextAuth', [c('__Secure-next-auth.session-token')]],
  ['Django/Instagram', [c('ds_user_id')]],
  ['QQ', [c('uin'), c('skey')]],
];

for (const [name, cookies] of CERTAIN_CASES) {
  test(`已登录：${name}`, () => {
    const r = signInFrom(cookies, 'example.com', true);
    assert.equal(r.signedIn, true, `${name} 应判为已登录`);
    assert.equal(r.confidence, 'certain', `${name} 应是确定级`);
    assert.ok(r.sessionCookieNames.length > 0);
  });
}

test('框架会话 cookie 只算「可能已登录」', () => {
  for (const name of ['PHPSESSID', 'JSESSIONID', 'ASP.NET_SessionId', 'laravel_session', 'connect.sid', 'MoodleSession', 'sid']) {
    const r = signInFrom([c(name, 'a'.repeat(26))], 'example.com', true);
    assert.equal(r.signedIn, true, `${name} 应至少为可能已登录`);
    assert.equal(r.confidence, 'likely', `${name} 不该说死`);
  }
});

test('匿名 cookie 一律不算登录（含名字很像票据的）', () => {
  const NOISE = [
    // GitHub 未登录也有
    ['_gh_sess', 'z'.repeat(670)],
    ['saved_user_sessions', 'x'.repeat(60)],
    // CSRF / 一次性令牌
    ['csrftoken', 'a'.repeat(64)],
    ['XSRF-TOKEN', 'b'.repeat(64)],
    ['passport_csrf_token', 'c'.repeat(32)],
    // 埋点 / 统计
    ['_hjSessionUser_1234567', 'd'.repeat(36)],
    ['_ga', 'GA1.2.123'],
    ['_gid', 'GA1.2.456'],
    ['_dd_s_v2', 'e'.repeat(86)],
    ['msToken', 'f'.repeat(100)],
    ['ttwid', 'g'.repeat(60)],
    // Google/Meta 的匿名 cookie
    ['NID', 'h'.repeat(100)],
    ['1P_JAR', '2026-10-31'],
    ['SIDCC', 'i'.repeat(40)],
    ['DSID', 'j'.repeat(30)],
    ['datr', 'k'.repeat(24)],
    ['fr', 'l'.repeat(40)],
    // 设备 / 负载均衡 / 反爬
    ['api_uid', 'm'.repeat(20)],
    ['d_c0', 'n'.repeat(32)],
    ['AWSALB', 'o'.repeat(200)],
    ['__cf_bm', 'p'.repeat(40)],
    ['BIGipServer_pool', 'q'.repeat(40)],
    // 界面偏好
    ['color_mode', 'dark'],
    ['tz', 'Asia/Shanghai'],
  ];
  for (const [name, value] of NOISE) {
    const r = signInFrom([c(name, value)], 'example.com', true);
    assert.equal(r.signedIn, false, `${name} 不该被当成登录`);
  }
});

test('logged_in 是开关：yes 才算，no 不算', () => {
  assert.equal(sessionSignalOf(c('logged_in', 'yes')), 'definite');
  assert.equal(sessionSignalOf(c('logged_in', 'no')), null);
  assert.equal(sessionSignalOf(c('logged_in', '0')), null);
});

test('名字大小写不敏感', () => {
  assert.equal(sessionSignalOf(c('BDUSS')), 'definite');
  assert.equal(sessionSignalOf(c('bduss')), 'definite');
  assert.equal(sessionSignalOf(c('User_Session')), 'definite');
  assert.equal(sessionSignalOf(c('PHPSESSID')), 'likely');
});

test('短值不算通用票据（避免空壳 cookie 误报）', () => {
  assert.equal(sessionSignalOf(c('my_session', '')), null);
  assert.equal(sessionSignalOf(c('my_session', 'ab')), null);
  assert.equal(sessionSignalOf(c('my_session', 'abcdefgh')), 'likely');
});

test('裸 uid 只算可能（很多站点拿它做访客 ID）', () => {
  assert.equal(sessionSignalOf(c('uid')), 'likely');
});

test('确定与可能两档不重复', () => {
  const r = signInFrom([c('SESSDATA'), c('PHPSESSID')], 'example.com', true);
  assert.equal(r.confidence, 'certain');
  assert.equal(new Set(r.sessionCookieNames).size, r.sessionCookieNames.length);
});

test('端口没开时保持"无法判断"', () => {
  const r = signInFrom([c('SESSDATA')], 'example.com', false);
  assert.equal(r.conclusive, false);
  assert.equal(r.signedIn, null);
});
