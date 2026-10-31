/**
 * client.js — 设置页的浏览器半边（普通 JS，由 Client 模块表懒加载）。
 *
 * 中文界面。三件事：
 *   1. 往清单里加"要登录的网址"（存在宿主侧的一个 JSON 文件里，只存 URL）
 *   2. 看每个网址在这个插件专用浏览器里**是否已登录**——依据是会话 cookie 的名字，
 *      值不会离开宿主进程
 *   3. 一个「打开登录页」按钮：在新标签里打开，登录由你完成，插件不碰输入框
 */
window.__ModuleLoader__.load({
  id: 'dsh-browser-takeover',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useCallback } = React;

    const API = '/dsh-browser-takeover';

    const CSS = `
.dvs-page { display: flex; flex-direction: column; gap: 18px; padding: 4px 2px 24px; color: var(--dsw-alias-label-primary); }
.dvs-page h2 { margin: 0; font-size: 18px; font-weight: 600; }
.dvs-intro { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 1.7; }
.dvs-card { border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; }
.dvs-card-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.dvs-card h3 { margin: 0; font-size: 14px; font-weight: 600; }
.dvs-meta { display: flex; flex-wrap: wrap; gap: 6px 18px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dvs-meta b { color: var(--dsw-alias-label-primary); font-weight: 600; }
.dvs-add { display: flex; gap: 8px; flex-wrap: wrap; }
.dvs-input { flex: 1 1 320px; min-width: 220px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); border-radius: 8px; padding: 7px 10px; font-size: 13px; }
.dvs-input:focus { outline: none; border-color: var(--dsw-alias-brand-primary); }
.dvs-btn { border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); border-radius: 8px; padding: 6px 12px; font-size: 13px; cursor: pointer; white-space: nowrap; }
.dvs-btn:hover { border-color: var(--dsw-alias-brand-primary); }
.dvs-btn[disabled] { opacity: .55; cursor: default; }
.dvs-btn-mini { padding: 3px 9px; font-size: 12px; }
.dvs-btn-danger:hover { border-color: var(--dsw-alias-state-error-primary); color: var(--dsw-alias-state-error-primary); }
.dvs-list { display: flex; flex-direction: column; gap: 8px; }
.dvs-item { display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 9px; background: var(--dsw-alias-bg-layer-2); }
.dvs-item-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.dvs-url { font-size: 13px; word-break: break-all; }
.dvs-sub { font-size: 12px; color: var(--dsw-alias-label-secondary); word-break: break-all; }
.dvs-badge { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; white-space: nowrap; }
.dvs-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; background: currentColor; }
.dvs-ok { color: var(--dsw-alias-state-success-primary); }
.dvs-warn { color: var(--dsw-alias-state-warn-primary); }
.dvs-idle { color: var(--dsw-alias-state-idle-primary); }
.dvs-actions { display: flex; gap: 6px; flex: none; flex-wrap: wrap; justify-content: flex-end; }
.dvs-note { font-size: 12px; color: var(--dsw-alias-label-secondary); line-height: 1.6; }
.dvs-error { font-size: 12px; color: var(--dsw-alias-state-error-primary); line-height: 1.6; }
.dvs-empty { font-size: 13px; color: var(--dsw-alias-label-secondary); padding: 6px 0; }
`;

    /** 浏览器状态 → 中文（宿主给的是 open / closed / unconfigured / error） */
    function browserStateText(state) {
      switch (state) {
        case 'open': return '端口已开，可以走过去';
        case 'closed': return '端口未开（浏览器没带调试端口启动）';
        case 'unconfigured': return '没有配置调试端口';
        case 'error': return '探测失败';
        // 旧版本的状态词：万一宿主还没重启，别显示成空白
        case 'watching': return '端口已开，可以走过去';
        case 'no-video': return '端口已开，可以走过去';
        default: return state ? String(state) : '—';
      }
    }

    function Badge({ row }) {
      if (!row.conclusive) {
        return h('span', { className: 'dvs-badge dvs-idle' }, h('span', { className: 'dvs-dot' }), '无法判断');
      }
      return row.signedIn
        ? h('span', { className: 'dvs-badge dvs-ok' }, h('span', { className: 'dvs-dot' }), '已登录')
        : h('span', { className: 'dvs-badge dvs-warn' }, h('span', { className: 'dvs-dot' }), '未登录');
    }

    function SettingsSection() {
      const [data, setData] = useState(null);
      const [error, setError] = useState(null);
      const [busy, setBusy] = useState(false);
      const [draft, setDraft] = useState('');
      const [adding, setAdding] = useState(false);
      const [notice, setNotice] = useState(null);

      const load = useCallback(async () => {
        setBusy(true);
        setError(null);
        try {
          const res = await fetch(`${API}/sites`, { cache: 'no-store' });
          const body = await res.json();
          if (!body?.ok) throw new Error(body?.error ?? '读取失败');
          setData(body);
        } catch (e) {
          setError(String(e?.message ?? e));
          setData(null);
        } finally {
          setBusy(false);
        }
      }, []);

      useEffect(() => { void load() }, []);

      const post = useCallback(async (path, payload) => {
        const res = await fetch(`${API}${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        return res.json();
      }, []);

      const add = useCallback(async () => {
        const url = draft.trim();
        // 空输入也要有反馈：之前是直接 return，表现就是"点添加没反应"
        if (!url) { setNotice('请先输入网址，再点确定'); return; }
        setNotice(null);
        try {
          const body = await post('/sites/add', { url });
          if (!body?.ok) throw new Error(body?.reason === 'not-http' ? '地址要以 http:// 或 https:// 开头' : (body?.error ?? '添加失败'));
          setDraft('');
          setAdding(false);
          setNotice(body.added ? '已添加到清单' : '这条已经在清单里了');
          await load();
        } catch (e) {
          setNotice(`添加失败：${String(e?.message ?? e)}`);
        }
      }, [draft, post, load]);

      const remove = useCallback(async (url) => {
        setNotice(null);
        try {
          const body = await post('/sites/remove', { url });
          if (!body?.ok) throw new Error(body?.error ?? '删除失败');
          await load();
        } catch (e) {
          setNotice(`删除失败：${String(e?.message ?? e)}`);
        }
      }, [post, load]);

      const openLogin = useCallback(async (url) => {
        setNotice(null);
        try {
          const body = await post('/open-login', { url });
          if (!body?.ok) throw new Error(body?.error ?? '打开失败');
          const via = body.via === 'new-tab' ? '新标签' : (body.via === 'navigate' ? '当前标签' : '新启动的浏览器');
          setNotice(`已在${via}里打开：${url}`);
        } catch (e) {
          setNotice(`打开失败：${String(e?.message ?? e)}`);
        }
      }, [post]);

      const sites = data?.sites ?? [];
      const browser = data?.browser ?? {};

      return h('div', { className: 'dvs-page' },
        h('style', null, CSS),
        h('h2', null, '浏览器登录'),
        h('p', { className: 'dvs-intro' },
          '这里维护一份"需要登录的网址"清单，并检查这个插件专用浏览器在各自站点上的登录状态。',
          '账号密码由你在浏览器里输入；插件只读会话 cookie 的名字，不读它的值，也不保存任何凭据。'),
        h('p', { className: 'dvs-intro' },
          '你让 Agent 去访问一个网址时，它会先用 web_sites 查这份清单：',
          '清单里的（或同一站点的）优先用 web_open 在这个浏览器里打开——那里的会话是你已经登录的那个；',
          '清单里没有的，也可以让它用 remember 记进来。'),

        h('section', { className: 'dvs-card' },
          h('div', { className: 'dvs-card-head' },
            h('h3', null, '添加网址'),
            h('div', { className: 'dvs-actions' },
              adding
                ? null
                : h('button', {
                  type: 'button', className: 'dvs-btn', onClick: () => { setNotice(null); setAdding(true); },
                }, '添加'),
              h('button', {
                type: 'button', className: 'dvs-btn dvs-btn-mini', disabled: busy, onClick: () => void load(),
              }, busy ? '检查中…' : '刷新状态'))),
          // 两步式：点「添加」才出现输入框（直接摆一个空输入框时，用户点"添加"没有任何反应，
          // 看起来就像按钮坏了——这是实测到的困惑点）。
          adding
            ? h('div', { className: 'dvs-add' },
              h('input', {
                className: 'dvs-input',
                placeholder: '粘贴网址，例如 https://hdu.fanya.chaoxing.com/portal',
                value: draft,
                spellCheck: false,
                autoFocus: true,
                onChange: (e) => setDraft(e.target.value),
                onKeyDown: (e) => {
                  if (e.key === 'Enter') void add();
                  if (e.key === 'Escape') { setAdding(false); setDraft(''); }
                },
              }),
              h('button', {
                type: 'button', className: 'dvs-btn', disabled: !draft.trim(), onClick: () => void add(),
              }, '确定'),
              h('button', {
                type: 'button', className: 'dvs-btn', onClick: () => { setAdding(false); setDraft(''); setNotice(null); },
              }, '取消'))
            : h('div', { className: 'dvs-note' }, '点「添加」，出现输入框后粘贴网址，回车或点「确定」。'),
          notice ? h('div', { className: 'dvs-note' }, notice) : null,
          error ? h('div', { className: 'dvs-error' }, error) : null,
          h('div', { className: 'dvs-meta' },
            h('span', null, '调试端口 ', h('b', null, String(data?.port ?? '—'))),
            h('span', null, '浏览器 ', h('b', null, browserStateText(browser.state))),
            h('span', null, '当前页面 ', h('b', null, data?.pages?.[0]?.url ?? '无')))),

        h('section', { className: 'dvs-card' },
          h('div', { className: 'dvs-card-head' },
            h('h3', null, `已添加的网址（${sites.length}）`)),
          sites.length === 0
            ? h('div', { className: 'dvs-empty' }, '还没有添加网址。把课程入口、B 站首页这类地址加到上面。')
            : h('div', { className: 'dvs-list' }, sites.map((row) => h('div', { className: 'dvs-item', key: row.url },
              h('div', { className: 'dvs-item-main' },
                h('div', { className: 'dvs-url' }, row.url),
                h('div', { className: 'dvs-sub' },
                  h(Badge, { row }),
                  ' · ',
                  row.sessionCookieNames?.length ? `会话 cookie：${row.sessionCookieNames.join(', ')}` : '没有发现会话 cookie')),
              h('div', { className: 'dvs-actions' },
                h('button', {
                  type: 'button', className: 'dvs-btn dvs-btn-mini', onClick: () => void openLogin(row.url),
                }, '打开登录页'),
                h('button', {
                  type: 'button', className: 'dvs-btn dvs-btn-mini dvs-btn-danger', onClick: () => void remove(row.url),
                }, '删除')))))),

        h('div', { className: 'dvs-note' },
          '判定规则：该站点的会话 cookie（SESSDATA / _uid / UID / JSESSIONID 等）存在即视为已登录；',
          '端口没开时显示"无法判断"，而不是冒充"未登录"。'),
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'dsh-browser-takeover',
          order: 40,
          label: '浏览器网址接管',
        }, SettingsSection), 'dsh-browser-takeover: 设置页');
      },
    };
  },
});
