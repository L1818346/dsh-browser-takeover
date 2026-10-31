/**
 * cdp.js — 这个插件自己需要的那一小撮 Chrome DevTools Protocol。
 *
 * 只有五件事：
 *   1. 找页面目标（`GET /json/list`）；
 *   2. 在页面里求值一次 / 在页面的**每个 JS 上下文**里各求值一次（iframe 要搜到）；
 *   3. 读浏览器的 cookie（设置页只看名字，值不出宿主进程）；
 *   4. 回答"那个调试端口开着没有、开着几个页面"；
 *   5. 端口没开时按需把浏览器拉起来（Windows 上要绕开 Job Object 回收）。
 *
 * 浏览器的登录态就是全部凭据：这里不填表、不读输入框、不导出密码。
 */

import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * 默认 9333 而不是 9222：9222 是 DevTools 的惯例端口，容易被别的 Electron 应用占掉
 * （实测这台机器上 9222 被另一个应用占着，盲连会读到它的界面）。
 */
export const DEFAULT_PORT = 9333;

/** `~/.dsh/browser.json` 的位置（DSH_HOME 优先） */
function browserConfigPath(env = process.env) {
  const home = env.DSH_HOME || join(env.USERPROFILE || env.HOME || homedir(), '.dsh');
  return join(home, 'browser.json');
}

/**
 * 读 `browser.json`：
 *
 *   { "browserPort": 9333, "launchBrowser": false }
 *
 * 为什么用文件而不是环境变量：DSH 桌面版的宿主进程 env 由启动器决定，
 * 用户 `setx` 之后插件读不到；文件不依赖 env 传播。
 */
export function readBrowserConfig(env = process.env) {
  try {
    const parsed = JSON.parse(readFileSync(browserConfigPath(env), 'utf8'));
    if (parsed && typeof parsed === 'object') return parsed;
  } catch { /* 不存在或坏了就当作没配 */ }
  return {};
}

/** 端口：`browserPort` > 环境变量 `DSH_BROWSER_DEBUG_PORT` > null（调用方再落到 9333） */
export function configuredPort(env = process.env) {
  const cfg = readBrowserConfig(env);
  const n = Number(cfg?.browserPort);
  if (Number.isFinite(n) && n > 0) return n;
  if (cfg?.browserPort === false || cfg?.browser === false) return null;
  const fromEnv = Number(env.DSH_BROWSER_DEBUG_PORT);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : null;
}

/** `launchBrowser`（默认关：不替用户随便开程序） */
export function configuredLaunch(env = process.env) {
  return readBrowserConfig(env).launchBrowser === true;
}

/** 列出调试端口暴露的页面目标；端口不通返回 null */
export async function listTargets({ port = DEFAULT_PORT, timeoutMs = 1200 } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: ac.signal });
    if (!res.ok) return null;
    const list = await res.json();
    return Array.isArray(list) ? list : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 端口状态。只回答"开没开、几个页面、都是哪些"——不扫 DOM、不猜内容。
 * state: unconfigured（没配端口）/ closed（端口不通）/ open（端口通）/ error（探测本身失败）
 */
export async function probeBrowser({ port = DEFAULT_PORT, timeoutMs = 1200 } = {}) {
  if (!port) return { state: 'unconfigured', port: null, pages: 0 };
  try {
    const targets = await listTargets({ port, timeoutMs });
    if (!targets) return { state: 'closed', port, pages: 0 };
    const pages = targets.filter((t) => t.type === 'page');
    return {
      state: 'open',
      port,
      pages: pages.length,
      urls: pages.slice(0, 3).map((t) => String(t.url ?? '')).filter(Boolean),
    };
  } catch {
    return { state: 'error', port, pages: 0 };
  }
}

/**
 * 在某个页面里求值一次（一条 CDP 往返，约 10–30 ms）。
 * `contextId` 指定 iframe 的 JS 上下文；不传就是主框架。
 */
export function evaluate(wsUrl, expression, { timeoutMs = 1500, contextId = null } = {}) {
  return new Promise((resolve) => {
    let ws;
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      try { ws?.close(); } catch { /* 已关 */ }
      resolve(v);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    try {
      ws = new WebSocket(wsUrl);
    } catch {
      clearTimeout(timer);
      return resolve(null);
    }
    ws.onopen = () => {
      ws.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: {
          expression,
          returnByValue: true,
          awaitPromise: false,
          ...(contextId === null || contextId === undefined ? {} : { contextId }),
        },
      }));
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data));
        if (msg.id !== 1) return;
        clearTimeout(timer);
        finish(msg.result?.result?.value ?? null);
      } catch {
        clearTimeout(timer);
        finish(null);
      }
    };
    ws.onerror = () => { clearTimeout(timer); finish(null); };
    ws.onclose = () => { clearTimeout(timer); finish(null); };
  });
}

/**
 * 在一个 target 的**所有 JS 上下文**里求值（主框架 + 所有 iframe）。
 *
 * 为什么必须这样：`document.querySelector(...)` 只看得见**本框架**的 DOM。
 * 学习通这类站点把课程列表放在 iframe 里，主框架里根本没有；只问主框架会一直
 * 得到"页面上没有"，而用户明明看得见。所以 `Runtime.enable` 攒一小会儿上下文
 * （同站 iframe 会一起到达），再按 `contextId` 各求一次。
 *
 * 跨站（OOPIF）的 iframe 不在这个 target 里；那属于调用方按 target 再问一遍的事。
 *
 * @returns {Promise<Array<{contextId:number|null, origin?:string, frame?:string, value:any}>>}
 */
export function evaluateAllContexts(wsUrl, expression, { timeoutMs = 2500, settleMs = 120 } = {}) {
  return new Promise((resolve) => {
    let ws;
    let done = false;
    let fanout = false;
    let pendingCount = 0;
    let origins = new Map();
    const contexts = new Map();   // contextId -> {origin,name,auxData}
    const results = [];
    const finish = (v) => {
      if (done) return;
      done = true;
      try { ws?.close(); } catch { /* 已关 */ }
      resolve(v);
    };
    const timer = setTimeout(() => finish(results), timeoutMs);
    const send = (obj) => { try { ws.send(JSON.stringify(obj)); } catch { /* 已关 */ } };

    const fanOut = () => {
      if (fanout || done) return;
      fanout = true;
      clearTimeout(timer2);
      // 没有任何上下文事件（老浏览器 / 权限限制）→ 退回主框架一条
      const list = contexts.size > 0
        ? [...contexts.entries()].map(([id, meta]) => ({ id, meta }))
        : [{ id: undefined, meta: {} }];
      list.forEach((ctx, i) => send({
        id: 100 + i,
        method: 'Runtime.evaluate',
        params: {
          expression,
          returnByValue: true,
          ...(ctx.id === undefined ? {} : { contextId: ctx.id }),
        },
      }));
      pendingCount = list.length;
      origins = new Map(list.map((ctx, i) => [100 + i, { ...ctx.meta, contextId: ctx.id ?? null }]));
      if (list.length === 0) finish(results);
    };

    let timer2 = setTimeout(fanOut, 2000);

    try {
      ws = new WebSocket(wsUrl);
    } catch {
      clearTimeout(timer);
      clearTimeout(timer2);
      return resolve([]);
    }
    ws.onopen = () => send({ id: 1, method: 'Runtime.enable' });
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(String(ev.data)); } catch { return; }
      if (msg.method === 'Runtime.executionContextCreated') {
        const ctx = msg.params?.context;
        if (ctx && typeof ctx.id === 'number') {
          contexts.set(ctx.id, { origin: ctx.origin, name: ctx.name, auxData: ctx.auxData });
          // 上下文是流式到达的：最后一波到了再分发给所有人
          clearTimeout(timer2);
          timer2 = setTimeout(fanOut, settleMs);
        }
        return;
      }
      if (msg.id === 1 && !fanout) {
        clearTimeout(timer2);
        timer2 = setTimeout(fanOut, settleMs);
        return;
      }
      if (msg.id >= 100) {
        const meta = origins.get(msg.id) ?? {};
        results.push({
          contextId: meta.contextId ?? null,
          origin: meta.origin,
          frame: meta.auxData?.frameId ?? null,
          value: msg.result?.result?.value ?? null,
        });
        if (results.length >= pendingCount) finish(results);
      }
    };
    ws.onerror = () => { clearTimeout(timer); clearTimeout(timer2); finish(results); };
    ws.onclose = () => { clearTimeout(timer); clearTimeout(timer2); finish(results); };
  });
}

/**
 * 从浏览器里直接读全部 cookie（浏览器级端点，不受当前页面域限制）。
 *
 * 走 `/json/version` → `Storage.getCookies`。调用方只看 `name` / `domain`；
 * 值留在宿主进程里，不写文件、不出网。
 */
export async function readBrowserCookies({ port = DEFAULT_PORT, timeoutMs = 4000 } = {}) {
  let wsUrl;
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: ac.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const v = await res.json();
    wsUrl = v?.webSocketDebuggerUrl;
  } catch {
    return null;
  }
  if (!wsUrl) return null;

  return new Promise((resolve) => {
    let ws;
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      try { ws?.close(); } catch { /* 已关 */ }
      resolve(v);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    try { ws = new WebSocket(wsUrl); } catch { clearTimeout(timer); return resolve(null); }
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Storage.getCookies' }));
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data));
        if (msg.id !== 1) return;
        clearTimeout(timer);
        finish(msg.result?.cookies ?? null);
      } catch { clearTimeout(timer); finish(null); }
    };
    ws.onerror = () => { clearTimeout(timer); finish(null); };
    ws.onclose = () => { clearTimeout(timer); finish(null); };
  });
}

/** 等端口起来（最多等 timeoutMs），返回是否起来了 */
export async function waitForPort(port, { timeoutMs = 8000, stepMs = 400 } = {}) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    // eslint-disable-next-line no-await-in-loop
    if ((await listTargets({ port, timeoutMs: 600 })) !== null) return true;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return false;
}

/**
 * 由**插件自己**把浏览器拉起来。
 *
 * 为什么不能靠外部脚本代劳：工具进程跑在沙箱的 Job Object 里，它派生的子进程
 * （哪怕 detached + unref）会随 job 一起被回收——窗口开起来、几秒后就没了。
 * 插件是 DSH 里的长期进程，它 spawn 出去的浏览器才活得下来。
 */
export function launchBrowser({
  port = DEFAULT_PORT, url = '', profileDir = null, exe = null, taskScheduler = true,
} = {}) {
  // 不能只认 x86 那条：只装了 Chrome 的机器上，自动起浏览器这条路会直接死
  const CANDIDATES = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  ];
  const edge = exe
    ?? CANDIDATES.find((q) => { try { return existsSync(q); } catch { return false; } })
    ?? CANDIDATES[0];
  const profile = profileDir ?? join(homedir(), '.dsh', 'edge-watch');
  if (!existsSync(edge)) return { ok: false, reason: 'edge-not-found' };
  mkdirSync(profile, { recursive: true });
  // 清掉上次的会话：冷启动时浏览器会恢复上次的标签页，旧页面每启动一次就多一份。
  // 清的是 session 文件，不影响登录态（Cookie / Local Storage 在别处）。
  for (const sub of ['Sessions', join('Default', 'Sessions')]) {
    try { rmSync(join(profile, sub), { recursive: true, force: true }); } catch { /* 删不掉就算了 */ }
  }
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--no-restore-last-session',
    ...(url ? [url] : []),
  ];

  // **Windows 上走计划任务**：普通 spawn 出去的进程会留在调用者的 Job Object 里，
  // 调用方一退出就被回收。计划任务由 Task Scheduler 服务启动，不在那个 job 里。
  if (process.platform === 'win32' && taskScheduler !== false) {
    // 任务名**不带端口**：以前按端口命名，端口一改就多一个任务，用户不知道该删哪个。
    const task = 'DSH-Edge-Watch';

    // 顺手清掉历史上按端口命名的那些变体，别再长新的
    try {
      execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
        "$ErrorActionPreference='SilentlyContinue'; "
        + "Get-ScheduledTask -TaskName 'DSH-Edge-Watch-*' | Unregister-ScheduledTask -Confirm:$false"],
      { stdio: 'ignore', windowsHide: true, timeout: 15_000 });
    } catch { /* 清不掉也不影响启动 */ }

    const quoted = args.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ');
    const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

    // **顺序：PowerShell cmdlet 在前，schtasks.exe 在后。别调回去。**
    // schtasks.exe 在不少机器的"程序黑名单"里（安全策略直接拦），失败后只能退回 spawn。
    //
    // 还有一条：任务**已存在就只 Start，不要 Register**。
    // Register-ScheduledTask -Force 会重写任务定义，正在跑的实例会被一起终止。
    // 但任务里存的是上一次的启动参数，`Start-ScheduledTask` 只重放那份定义 ——
    // 所以"不管点哪个网址，第一次打开都落在旧网址"就是这么来的。启动前先比对，
    // 参数不一样才重写；调用方只在**端口没开**时才走到这里，此刻没有实例会被打断。
    try {
      const current = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
        `$ErrorActionPreference='SilentlyContinue'; (Get-ScheduledTask -TaskName ${q(task)}).Actions[0].Arguments`],
      { encoding: 'utf8', windowsHide: true, timeout: 15_000 }).trim();
      const stale = current !== '' && url !== '' && !current.includes(url);
      if (stale) {
        execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', [
          `$a = New-ScheduledTaskAction -Execute ${q(edge)} -Argument ${q(quoted)}`,
          '$s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)',
          `Register-ScheduledTask -TaskName ${q(task)} -Action $a -Settings $s -Force | Out-Null`,
        ].join('; ')], { stdio: 'ignore', windowsHide: true, timeout: 20_000 });
      }
    } catch { /* 读不到旧参数就按原样启动，下面的兜底会补一个正确的标签 */ }

    try {
      execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
        `$ErrorActionPreference='Stop'; Start-ScheduledTask -TaskName ${q(task)}`],
      { stdio: 'ignore', windowsHide: true, timeout: 20_000 });
      return { ok: true, via: 'scheduled-task', task, port, profile };
    } catch { /* 任务不存在 → 下面创建 */ }

    try {
      execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', [
        `$a = New-ScheduledTaskAction -Execute ${q(edge)} -Argument ${q(quoted)}`,
        '$s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)',
        `Register-ScheduledTask -TaskName ${q(task)} -Action $a -Settings $s -Force | Out-Null`,
        `Start-ScheduledTask -TaskName ${q(task)}`,
      ].join('; ')], { stdio: 'ignore', windowsHide: true, timeout: 20_000 });
      return { ok: true, via: 'scheduled-task-new', task, port, profile };
    } catch { /* 没有 PowerShell / 没有注册任务的权限，往下走 */ }

    try {
      execFileSync('schtasks', ['/create', '/tn', task, '/tr', `"${edge}" ${quoted}`,
        '/sc', 'once', '/st', '23:59', '/f'], { stdio: 'ignore', windowsHide: true, timeout: 15_000 });
      execFileSync('schtasks', ['/run', '/tn', task], { stdio: 'ignore', windowsHide: true, timeout: 15_000 });
      return { ok: true, via: 'schtasks', task, port, profile };
    } catch { /* 没权限就往下走 */ }
  }

  // 最后兜底：spawn。**它多半活不过调用方退出**（Job Object 会回收整棵子进程树），
  // 只适合"起完立刻读一次"的场景。看到 via:'spawn' 就知道浏览器随时会消失。
  try {
    const child = spawn(edge, args, { detached: true, stdio: 'ignore' });
    child.unref();
    return { ok: true, via: 'spawn', pid: child.pid, port, profile };
  } catch (e) {
    return { ok: false, reason: String(e?.message ?? e).slice(0, 120) };
  }
}
