/**
 * sites.js — 设置页里那份"要登录的网址"清单，落在插件自己的一个 JSON 文件里。
 *
 * 为什么不用插件的 Config：Config 是 `cordis.patch.yml` 里的行配置，改它要重载插件；
 * 而这份清单是**用户边用边加**的运行期数据（今天加学习通，明天加 B 站），
 * 写成一个小文件最直接，也不需要重启。
 *
 * 文件位置：`$DSH_HOME/browser-takeover-sites.json`（没有 DSH_HOME 就是 ~/.dsh/…）。
 * 只存 URL 和时间戳 —— **不存任何账号、密码、cookie 值**。
 *
 * 旧文件名 `video-storyboard-sites.json` 仍然读得到，
 * 第一次保存时自动搬到新文件，用户不用手动迁。
 */
import { mkdirSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const FILE_NAME = 'browser-takeover-sites.json';
const LEGACY_FILE_NAME = 'video-storyboard-sites.json';
/** 第一次打开设置页时给的默认项：只放入口页，登录与否现查 */
const DEFAULTS = [
  'https://hdu.fanya.chaoxing.com/portal',
];

function dshHome(env = process.env) {
  return env.DSH_HOME || join(env.USERPROFILE || env.HOME || homedir(), '.dsh');
}

export function sitesFile(env = process.env) {
  return join(dshHome(env), FILE_NAME);
}

export function legacySitesFile(env = process.env) {
  return join(dshHome(env), LEGACY_FILE_NAME);
}

function readRaw(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (Array.isArray(parsed?.sites)) return parsed.sites;
  } catch { /* 没有就返回空 */ }
  return null;
}

/** 只接受 http(s)，去掉多余空白；同一 URL 不重复。 */
export function normalizeSite(raw) {
  const text = String(raw ?? '').trim();
  if (!/^https?:\/\//i.test(text)) return null;
  try {
    const url = new URL(text);
    return url.toString();
  } catch {
    return null;
  }
}

export function loadSites(env = process.env) {
  const file = sitesFile(env);
  const raw = readRaw(file) ?? (existsSync(file) ? null : readRaw(legacySitesFile(env)));
  if (raw === null) {
    return DEFAULTS.map((url) => ({ url, addedAt: null }));
  }
  return raw
    .map((item) => {
      const url = normalizeSite(item?.url);
      return url ? { url, addedAt: item?.addedAt ?? null } : null;
    })
    .filter(Boolean);
}

export function saveSites(sites, env = process.env) {
  const file = sitesFile(env);
  mkdirSync(dirname(file), { recursive: true });
  const body = JSON.stringify({ sites, updatedAt: new Date().toISOString() }, null, 2) + '\n';
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, body, 'utf8');
  renameSync(tmp, file);   // 原子替换：写一半断电也不会留下坏 JSON
  return file;
}

/** 加一条；重复（规范化后完全相同）返回 {added:false}。 */
export function addSite(raw, env = process.env) {
  const url = normalizeSite(raw);
  if (!url) return { ok: false, reason: 'not-http' };
  const sites = loadSites(env);
  if (sites.some((s) => s.url === url)) return { ok: true, added: false, sites };
  const next = [...sites, { url, addedAt: new Date().toISOString() }];
  saveSites(next, env);
  return { ok: true, added: true, sites: next };
}

export function removeSite(raw, env = process.env) {
  const url = normalizeSite(raw);
  if (!url) return { ok: false, reason: 'not-http' };
  const before = loadSites(env);
  const next = before.filter((s) => s.url !== url);
  saveSites(next, env);
  return { ok: true, removed: before.length - next.length, sites: next };
}
