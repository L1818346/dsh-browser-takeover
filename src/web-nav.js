/**
 * web-nav.js — 在**已登录的调试浏览器**里做两件事：打开一个地址、按可见文字点一个链接。
 *
 * 为什么需要：学习通这类站点的入口在网页里（首页 → 学习空间 → 课程），
 * 而插件原本只能"读"页面，不能"走"页面。补上这一层，才能按一句指令走到课程页。
 *
 * 边界（写死在实现里，不靠自觉）：
 *   - 只做导航与点击，**不碰播放**：没有 play() / 没有 seek / 没有"等到播完"。
 *   - 不读也不存任何账号密码：浏览器自己的登录态就是全部凭据。
 *   - 一次调用最多点一个元素；不做循环点击。
 *
 * 为什么按文字点而不是按选择器：课程名、入口名是用户给的（"学习空间"、"国家安全教育"），
 * 选择器一改版就废；文字匹配 + 可见性过滤更耐改版，而且匹配不到时会**把候选列出来**，
 * 不让调用方猜。
 */

import { evaluate, evaluateAllContexts, listTargets } from './cdp.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function usable(t) {
  const u = t?.url ?? '';
  return t?.type === 'page' && t.webSocketDebuggerUrl
    && !u.startsWith('devtools:') && !u.includes('app.asar');
}

/** 页面的基本信息：地址、标题、iframe 地址（定位"内容在哪一层"用） */
export function pageInfoExpr() {
  return `(() => ({
    url: location.href,
    title: document.title,
    ready: document.readyState,
    frames: [...document.querySelectorAll('iframe')].map((f) => f.src).filter(Boolean).slice(0, 8),
  }))()`;
}

/**
 * 找到"可见且文字对得上"的元素。分档：完全相同 3 分 > 以它开头 2 分 > 包含 1 分；
 * `<a href>` 加 0.5，因为可点击性更确定。只认看得见的东西（display:none 的菜单项不算）。
 */
function scanExpr(match) {
  return `(() => {
    const want = ${JSON.stringify(match)};
    const out = [];
    const all = document.querySelectorAll('a,button,li,h3,h4,span,div');
    for (const e of all) {
      const text = (e.textContent || '').replace(/\\s+/g, ' ').trim();
      if (!text || text.length > 80) continue;
      let score = 0;
      if (text === want) score = 3;
      else if (text.startsWith(want)) score = 2;
      else if (text.includes(want)) score = 1;
      else continue;
      const r = e.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const style = getComputedStyle(e);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) < 0.05) continue;
      if (e.tagName === 'A' && e.href) score += 0.5;
      out.push({ text, tag: e.tagName, href: e.href || '', score, top: Math.round(r.top), left: Math.round(r.left) });
    }
    out.sort((a, b) => (b.score - a.score) || (a.text.length - b.text.length));
    return out.slice(0, 12);
  })()`;
}

/** 在指定上下文里点"和刚才选中的那个完全一致"的元素；不一致就不点（防止页面刚刷新换了顺序） */
function clickExpr(pick) {
  return `(() => {
    const want = ${JSON.stringify(pick.text)};
    const wantHref = ${JSON.stringify(pick.href || '')};
    const all = document.querySelectorAll('a,button,li,h3,h4,span,div');
    for (const e of all) {
      const text = (e.textContent || '').replace(/\\s+/g, ' ').trim();
      if (text !== want) continue;
      if (wantHref && e.tagName === 'A' && e.href !== wantHref) continue;
      const r = e.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      e.scrollIntoView({ block: 'center' });
      e.click();
      return { clicked: true, text, tag: e.tagName, href: e.href || '' };
    }
    return { clicked: false, text: want };
  })()`;
}

/**
 * 打开地址 + 按文字点一个入口。
 *
 * @param {{port:number, url?:string, match?:string, index?:number, waitMs?:number,
 *          listOnly?:boolean, navigateWaitMs?:number}} opts
 */
export async function webOpen({
  port, url = null, match = null, index = 0, waitMs = 2500, listOnly = false, navigateWaitMs = 6000,
} = {}) {
  const targets = await listTargets({ port });
  if (!targets) return { ok: false, reason: 'no-debug-port', port, hint: 'start the browser with --remote-debugging-port' };
  let page = targets.filter(usable)[0];
  if (!page) return { ok: false, reason: 'no-page', port };

  let navigated = null;
  if (url) {
    await evaluate(page.webSocketDebuggerUrl, `location.href=${JSON.stringify(url)}`, { timeoutMs: 4000 });
    await sleep(navigateWaitMs);
    const after = (await listTargets({ port }))?.filter(usable) ?? [];
    let host = '';
    try { host = new URL(url).host; } catch { /* 交给默认 */ }
    page = after.find((t) => host && String(t.url || '').includes(host)) ?? after[0] ?? page;
    navigated = { url: page.url, title: page.title };
  }

  const info = await evaluate(page.webSocketDebuggerUrl, pageInfoExpr(), { timeoutMs: 3000 });

  if (!match) {
    return { ok: true, navigated, page: info, pages: (await listTargets({ port }))?.filter(usable).map((t) => t.url) ?? [] };
  }

  const scans = await evaluateAllContexts(page.webSocketDebuggerUrl, scanExpr(match), { timeoutMs: 4500 });
  const candidates = [];
  for (const s of scans) {
    for (const hit of (Array.isArray(s.value) ? s.value : [])) {
      candidates.push({ ...hit, origin: s.origin, contextId: s.contextId });
    }
  }
  candidates.sort((a, b) => (b.score - a.score) || (a.text.length - b.text.length));
  if (candidates.length === 0) {
    return {
      ok: false,
      reason: 'no-match',
      match,
      navigated,
      page: info,
      frames: scans.map((s) => s.origin).filter(Boolean),
      hint: 'Nothing visible carried that text. Pass listOnly:true to see what the page calls things.',
    };
  }

  const pick = candidates[Math.min(Math.max(0, index), candidates.length - 1)];
  if (listOnly) {
    return { ok: true, listOnly: true, match, navigated, page: info, candidates: candidates.slice(0, 12) };
  }

  /*
   * 两条路，按元素类型选：
   *   - `<a href="http…">`：**直接导航到 href**。`element.click()` 没有用户手势，
   *     站点用 window.open 打开的入口会被弹窗拦截器挡掉（实测：点了没反应，页面不动）。
   *     直接走 href 既保留同一标签页，也保留登录态（同站 cookie）。
   *   - 其它（button / li / javascript: 链接 / 前端路由）：真的点它。
   */
  let clicked;
  if (pick.tag === 'A' && /^https?:/i.test(pick.href)) {
    await evaluate(page.webSocketDebuggerUrl, `location.href=${JSON.stringify(pick.href)}`, { timeoutMs: 4000 });
    clicked = { clicked: true, via: 'href', text: pick.text, tag: pick.tag, href: pick.href };
  } else {
    const r = await evaluate(page.webSocketDebuggerUrl, clickExpr(pick), {
      timeoutMs: 4500, contextId: pick.contextId,
    });
    clicked = { ...(r ?? { clicked: false }), via: 'click' };
  }
  await sleep(waitMs);

  const pages = (await listTargets({ port }))?.filter(usable) ?? [];
  const afterInfo = pages[0]
    ? await evaluate(pages[0].webSocketDebuggerUrl, pageInfoExpr(), { timeoutMs: 3000 })
    : null;

  return {
    ok: clicked?.clicked === true,
    match,
    pickedFrom: pick.origin,
    clicked: clicked ?? null,
    otherCandidates: candidates.length - 1,
    page: afterInfo ?? info,
    pages: pages.map((t) => t.url),
  };
}
