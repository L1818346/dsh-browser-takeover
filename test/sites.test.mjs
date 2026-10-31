/**
 * sites.test.mjs — 「清单」的初始状态与增删规则。
 *
 * 这里有一条硬要求：**从仓库下载下来的插件不能带任何网址**。
 * 所以除了"没有文件 = 空清单"，还要钉住"存在旧文件名也不读"——
 * 否则用户装了别的插件留下的清单，会以为这是本插件预置的。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { addSite, loadSites, removeSite, sitesFile } from '../src/sites.js';

async function freshHome() {
  const home = await mkdtemp(join(tmpdir(), 'dsh-sites-'));
  return { home, env: { DSH_HOME: home } };
}

test('没有任何文件时清单为空（插件不预置网址）', async () => {
  const { home, env } = await freshHome();
  try {
    assert.deepEqual(loadSites(env), []);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('旧文件名 video-storyboard-sites.json 不会被读进来', async () => {
  const { home, env } = await freshHome();
  try {
    await mkdir(home, { recursive: true });
    await writeFile(join(home, 'video-storyboard-sites.json'), JSON.stringify({
      sites: [{ url: 'https://hdu.fanya.chaoxing.com/portal', addedAt: null }],
    }), 'utf8');
    assert.deepEqual(loadSites(env), []);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('add / load / 重复 add / remove', async () => {
  const { home, env } = await freshHome();
  try {
    const first = addSite('https://example.com/app', env);
    assert.equal(first.ok, true);
    assert.equal(first.added, true);
    assert.equal(loadSites(env).length, 1);

    const again = addSite('https://example.com/app', env);
    assert.equal(again.ok, true);
    assert.equal(again.added, false, '同一条不该重复加入');
    assert.equal(loadSites(env).length, 1);

    const second = addSite('  https://www.bilibili.com/  ', env);
    assert.equal(second.added, true);
    assert.equal(loadSites(env).length, 2);

    const removed = removeSite('https://example.com/app', env);
    assert.equal(removed.ok, true);
    assert.equal(removed.removed, 1);
    assert.deepEqual(loadSites(env).map((s) => s.url), ['https://www.bilibili.com/']);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('非 http(s) 不接受，且不写文件', async () => {
  const { home, env } = await freshHome();
  try {
    assert.deepEqual(addSite('file:///D:/a.mp4', env), { ok: false, reason: 'not-http' });
    assert.deepEqual(addSite('not a url', env), { ok: false, reason: 'not-http' });
    await assert.rejects(readFile(sitesFile(env), 'utf8'));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('文件里坏掉的条目被丢掉，好的留下', async () => {
  const { home, env } = await freshHome();
  try {
    await mkdir(home, { recursive: true });
    await writeFile(sitesFile(env), JSON.stringify({
      sites: [{ url: 'https://ok.example/a' }, { url: 'nope' }, { url: null }, {}],
    }), 'utf8');
    assert.deepEqual(loadSites(env).map((s) => s.url), ['https://ok.example/a']);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
