/**
 * session.test.mjs — 「这个站点算不算已登录」的判定规则。
 *
 * 这一层出过真问题：GitHub 登录成功后，状态页仍显示"未登录"——原先的白名单只认得
 * 学习通/B 站那套名字（SESSDATA / JSESSIONID / UID），GitHub 的 `user_session`、
 * `logged_in`、`dotcom_user` 一个都不在里面。所以这里既钉住已知名字，也钉住
 * "没登录时不能被说成已登录"的反例（GitHub 未登录也有 `_gh_sess`）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { covers, sessionSignal, sessionSignalOf, signInFrom } from '../src/session.js';

const cookie = (name, value, domain = '.github.com') => ({ name, value, domain });

/** 登录后的 GitHub（2026-10-31 实测的那一组） */
const GITHUB_IN = [
  cookie('user_session', 'x'.repeat(48), 'github.com'),
  cookie('__Host-user_session_same_site', 'y'.repeat(48), 'github.com'),
  cookie('logged_in', 'yes'),
  cookie('dotcom_user', 'L1818346'),
  cookie('_gh_sess', 'z'.repeat(670), 'github.com'),
  cookie('_device_id', 'd'.repeat(32), 'github.com'),
  cookie('color_mode', 'dark'),
  cookie('cpu_bucket', 'high'),
];

/** 未登录的 GitHub：仍有 _gh_sess（匿名会话）与 logged_in=no */
const GITHUB_OUT = [
  cookie('_gh_sess', 'z'.repeat(670), 'github.com'),
  cookie('logged_in', 'no'),
  cookie('_device_id', 'd'.repeat(32), 'github.com'),
  cookie('preferred_color_mode', 'dark'),
];

/** 学习通：原来的白名单那套 */
const CHAOXING_IN = [
  cookie('JSESSIONID', 'a'.repeat(40), 'hdu.fanya.chaoxing.com'),
  cookie('_uid', 'b'.repeat(20), '.chaoxing.com'),
  cookie('fid', 'c'.repeat(20), '.chaoxing.com'),
];

test('GitHub 登录后 → 已登录，且确定', () => {
  const r = signInFrom(GITHUB_IN, 'github.com', true);
  assert.equal(r.signedIn, true);
  assert.equal(r.confidence, 'certain');
  assert.ok(r.sessionCookieNames.includes('user_session'));
  assert.ok(r.sessionCookieNames.includes('logged_in'));
  assert.ok(r.sessionCookieNames.includes('dotcom_user'));
});

test('GitHub 未登录（只有 _gh_sess 与 logged_in=no）→ 未登录', () => {
  const r = signInFrom(GITHUB_OUT, 'github.com', true);
  assert.equal(r.signedIn, false);
  assert.equal(r.confidence, 'certain');
  assert.deepEqual(r.sessionCookieNames, []);
});

test('logged_in 是开关型：值不是 yes 就不算登录信号', () => {
  assert.equal(sessionSignalOf(cookie('logged_in', 'yes')), 'definite');
  assert.equal(sessionSignalOf(cookie('logged_in', 'no')), null);
  assert.equal(sessionSignalOf(cookie('logged_in', '')), null);
});

test('未知站点但名字像会话票据 → 可能已登录（likely）', () => {
  const cookies = [cookie('myapp_session_token', 't'.repeat(40), 'app.example')];
  const r = signInFrom(cookies, 'app.example', true);
  assert.equal(r.signedIn, true);
  assert.equal(r.confidence, 'likely');
  assert.deepEqual(r.sessionCookieNames, ['myapp_session_token']);
});

test('只有统计/偏好类 cookie → 未登录', () => {
  const cookies = [
    cookie('_dd_s_v2', 'a'.repeat(86), 'github.com'),
    cookie('color_mode', 'dark'),
    cookie('tz', 'Asia/Shanghai'),
    cookie('ui_eligible', 'true'),
  ];
  assert.equal(signInFrom(cookies, 'github.com', true).signedIn, false);
});

test('空值的长名字cookie不算（值长度 < 8）', () => {
  assert.equal(sessionSignalOf(cookie('session_token', '')), null);
  assert.equal(sessionSignalOf(cookie('session_token', 'abc')), null);
  assert.equal(sessionSignalOf(cookie('session_token', 'abcdefgh')), 'likely');
});

test('域名覆盖关系决定站点归属', () => {
  assert.equal(covers('.github.com', 'github.com'), true);
  assert.equal(covers('.github.com', 'api.github.com'), true);
  assert.equal(covers('.chaoxing.com', 'hdu.fanya.chaoxing.com'), true);
  assert.equal(covers('.chaoxing.com', 'github.com'), false);
  assert.equal(covers('', 'github.com'), false);
});

test('学习通的老名字仍然有效（原有站点不能退化）', () => {
  const r = signInFrom(CHAOXING_IN, 'hdu.fanya.chaoxing.com', true);
  assert.equal(r.signedIn, true);
  assert.equal(r.confidence, 'certain');
});

test('端口没开（conclusive:false）→ 无法判断，而不是未登录', () => {
  const r = signInFrom(GITHUB_IN, 'github.com', false);
  assert.equal(r.conclusive, false);
  assert.equal(r.signedIn, null);
  assert.equal(r.confidence, null);
});

test('sessionSignal 把确定与可能分开，且不重复', () => {
  const signal = sessionSignal(GITHUB_IN, 'github.com');
  assert.deepEqual(signal.definite.sort(), ['__Host-user_session_same_site', 'dotcom_user', 'logged_in', 'user_session']);
  assert.equal(signal.names.length, signal.definite.length + signal.likely.length);
});
