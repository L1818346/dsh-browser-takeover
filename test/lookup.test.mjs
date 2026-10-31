/**
 * lookup.test.mjs — 「这条网址插件存过没有」的规则测试。
 *
 * 跑：node --test（或 npm test）。这一层是纯函数，规则一旦漂移，
 * Agent 就会在"该走插件"的时候去抓 HTML，所以值得钉死。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  describeLookup,
  isKnownSite,
  lookupSite,
  parseUrl,
  registrableDomain,
  urlKey,
} from '../src/lookup.js';

const SITES = [
  { url: 'https://hdu.fanya.chaoxing.com/portal', addedAt: 'a' },
  { url: 'https://www.bilibili.com/', addedAt: 'b' },
  { url: 'https://github.com/dashboard', addedAt: 'c' },
];

test('parseUrl 接受裸域名，拒绝非 http(s)', () => {
  assert.equal(parseUrl('bilibili.com')?.host, 'bilibili.com');
  assert.equal(parseUrl('https://x.com/a')?.host, 'x.com');
  assert.equal(parseUrl('file:///D:/a.mp4'), null);
  assert.equal(parseUrl('javascript:alert(1)'), null);
  assert.equal(parseUrl('   '), null);
});

test('urlKey 忽略 www、末尾斜杠、query 与 hash', () => {
  const base = urlKey('https://hdu.fanya.chaoxing.com/portal');
  assert.equal(urlKey('https://hdu.fanya.chaoxing.com/portal/'), base);
  assert.equal(urlKey('https://hdu.fanya.chaoxing.com/portal?x=1#top'), base);
  assert.equal(urlKey('https://www.bilibili.com'), urlKey('https://bilibili.com/'));
});

test('registrableDomain 处理 com.cn 这类二级后缀', () => {
  assert.equal(registrableDomain('hdu.fanya.chaoxing.com'), 'chaoxing.com');
  assert.equal(registrableDomain('www.bilibili.com'), 'bilibili.com');
  assert.equal(registrableDomain('mail.163.com'), '163.com');
  assert.equal(registrableDomain('a.b.com.cn'), 'b.com.cn');
  assert.equal(registrableDomain('localhost'), 'localhost');
});

test('完全相同的地址 → saved:true / match:exact', () => {
  const hit = lookupSite(SITES, 'https://hdu.fanya.chaoxing.com/portal');
  assert.equal(hit?.saved, true);
  assert.equal(hit?.match, 'exact');
  assert.equal(hit?.site?.url, SITES[0].url);
  assert.equal(isKnownSite(hit), true);
});

test('www / 末尾斜杠差异仍算同一条', () => {
  const hit = lookupSite(SITES, 'https://bilibili.com');
  assert.equal(hit?.saved, true);
  assert.equal(hit?.site?.url, 'https://www.bilibili.com/');
});

test('同一主机不同路径 → saved:false，但给出 hostSite', () => {
  const hit = lookupSite(SITES, 'https://hdu.fanya.chaoxing.com/course/123');
  assert.equal(hit?.saved, false);
  assert.equal(hit?.match, 'host');
  assert.equal(hit?.hostSite?.url, SITES[0].url);
  // 登录态对同一主机同样有效 → 视为"已知站点"
  assert.equal(isKnownSite(hit), true);
});

test('同注册域名不同主机 → 只作提示，不算已知站点', () => {
  const hit = lookupSite(SITES, 'https://i.chaoxing.com/base');
  assert.equal(hit?.saved, false);
  assert.equal(hit?.match, 'domain');
  assert.equal(hit?.domainSite?.url, SITES[0].url);
  assert.equal(isKnownSite(hit), false);
});

test('清单里没有 → saved:false / match:null，且不假装已知', () => {
  const hit = lookupSite(SITES, 'https://example.com/hello');
  assert.equal(hit?.saved, false);
  assert.equal(hit?.match, null);
  assert.equal(hit?.candidates.length, 0);
  assert.equal(isKnownSite(hit), false);
});

test('坏地址返回 null，不抛异常', () => {
  assert.equal(lookupSite(SITES, 'not a url'), null);
  assert.equal(lookupSite(SITES, ''), null);
  // 清单缺失时仍然回答"没存过"，而不是干脆不回答
  assert.equal(lookupSite(null, 'https://x.com')?.saved, false);
});

test('describeLookup 对四种情况都说人话', () => {
  assert.match(describeLookup(lookupSite(SITES, SITES[0].url)) ?? '', /清单里有/);
  assert.match(describeLookup(lookupSite(SITES, 'https://hdu.fanya.chaoxing.com/x')) ?? '', /同一站点/);
  assert.match(describeLookup(lookupSite(SITES, 'https://i.chaoxing.com/x')) ?? '', /同一域名/);
  assert.match(describeLookup(lookupSite(SITES, 'https://example.com/x')) ?? '', /清单里没有/);
  assert.match(describeLookup(null) ?? '', /判断不了/);
});
