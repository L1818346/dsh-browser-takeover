# 浏览器网址接管 · dsh-browser-takeover

> 让 DSH 里的模型在你**已经登录**的浏览器里走过去：打开网址、按页面上的可见文字点一个入口；
> 同时维护一份「要登录的网址」清单——**Agent 访问网址前先查这份清单，清单里的优先走这个插件**。

---

## 0.8.0 新增了什么

- **`web_sites`**：访问网址前先查一次清单——这条地址存过没有、那个浏览器此刻登录着没有。
  零副作用，不启动浏览器、不打开页面。
- **`web_open` 带上判断**：返回里始终有 `site`（清单命中：完全一致 / 同主机 / 同域名）
  与 `signIn`（登录态）；新参数 `remember` 先记进清单再打开，`launch` 端口没开就自己拉起浏览器。
- **系统提示里的约定**：Agent 访问网址时会先 `web_sites`，清单里的用 `web_open`，
  不用 `web_fetch` 抓 HTML 顶替（抓不到登录后的内容）。
- 清单匹配独立成 `src/lookup.js`（纯函数），登录态判断抽到 `src/session.js`；
  新增 `test/` 下的单元测试。**升级后需重启一次 DSH Desktop**，工具与提示词才会重新组装。

## 功能

| 能力 | 入口 | 说明 |
|---|---|---|
| 查清单 | 工具 `web_sites` | 零副作用：这条网址存过没有、那个浏览器此刻登录着没有。不启动浏览器、不打开页面 |
| 页面导航 / 按文字点击 | 工具 `web_open` | 在带调试端口的浏览器里打开地址，按可见文字点一个元素；会搜所有 iframe |
| 网址清单 | 设置 → 浏览器网址接管 | 只存 URL 与添加时间，不存账号密码 |
| 登录状态 | 同上 | 依据该站点的**会话 cookie 名字**判断，cookie 的值不离开宿主进程 |
| 打开登录页 | 同上 | 端口开着就开新标签，没开就带调试参数启动浏览器 |

一次调用最多点**一个**元素；不做循环点击、不批量爬取。

## Agent 访问网址的顺序

插件往系统提示里写了一段约定（`src/prompt.js`），所以「去访问某个网址」时 Agent 会：

1. 先调 `web_sites({ url })` —— 零成本，回答这条网址在不在清单里；
2. 在清单里（`saved: true`，或 `hostSite` 命中同一站点）→ **用 `web_open` 打开**，
   而不是 `web_fetch` 抓 HTML（抓不到登录后的内容）；
3. 清单里没有 → 也优先 `web_open`；需要登录的站点先让你在那个窗口里登录一次，
   再用 `remember: true` 记进清单，下次就自动算"清单里的网址"。

`web_open` 的返回里一直带着这些判断，所以即使 Agent 直接开了工具，也看得到
「这条网址存过没有、登录着没有」：

```json
{
  "ok": true,
  "saved": true,
  "site": {
    "asked": "https://hdu.fanya.chaoxing.com/portal",
    "saved": true,
    "match": "exact",
    "hostSite": null,
    "domainSite": null,
    "note": "清单里有这条网址（…）——用 web_open 在插件浏览器里打开，那里是用户已登录的会话。"
  },
  "signIn": { "conclusive": true, "signedIn": true, "sessionCookieNames": ["JSESSIONID"] }
}
```

匹配规则：完全一样 > 同一主机（登录态同样适用）> 同注册域名（只作提示）。
比较时忽略 `www.`、末尾斜杠、query 和 hash；差异会原样回显，不替你拍板。

## 安装

```bash
git clone git@github.com:L1818346/dsh-browser-takeover.git
cd dsh-browser-takeover
node scripts/install-dev.mjs     # 用 junction 挂进 desktop profile 并注册 bundle
```

然后**重启 DSH Desktop**（插件树与系统提示都在进程启动时组装；工具与提示词的改动
不重启不会生效）。

要求：

- Node.js ≥ 20
- Edge 或 Chrome（要能开 `--remote-debugging-port`，即 CDP）

## 浏览器准备

插件不会读你的主浏览器 profile —— Chromium 136 起明确禁止在默认 profile 上开调试端口
（[官方说明](https://developer.chrome.com/blog/remote-debugging-port)），而换路径去看同一份
profile 又会因为 App-Bound Encryption 拿不到已登录的 cookie。所以它要的是**一只带调试端口
的独立窗口**，默认端口 `9333`：

```bat
scripts\start-edge-debug.cmd
```

脚本用 `~/.dsh/edge-watch` 作为独立 profile 启动 Edge，并打开调试端口。
**在这个窗口里登录一次**，之后插件都复用这份登录态；你平时的 Edge 可以照常开着。

也可以自己起：

```bat
msedge.exe --remote-debugging-port=9333 --user-data-dir="%USERPROFILE%\.dsh\edge-watch"
```

## 配置

`~/.dsh/browser.json`：

```json
{
  "browserPort": 9333,
  "launchBrowser": true
}
```

| 键 | 默认 | 说明 |
|---|---|---|
| `browserPort` | 无 | 调试端口；工具里显式传 `browserPort` 优先，其次这个文件，最后落到 9333 |
| `launchBrowser` | `false` | 清单里的站点在端口没开时，是否允许插件自己拉起浏览器。打开后"优先走插件"才真的不用你动手 |

端口只该有一个说法。

## 用法

```js
// 1. 先查：这条网址存过没有？（零成本）
web_sites({ url: "https://hdu.fanya.chaoxing.com/portal" })

// 2. 再开：清单里的网址直接走插件浏览器（带登录态）
web_open({ url: "https://hdu.fanya.chaoxing.com/portal", match: "学习空间" })

// 3. 需要登录的新站点：先登录，再记进清单
web_open({ url: "https://example.com/app", match: "我的课程", remember: true })

// 4. 端口没开时，让插件自己拉起浏览器再打开
web_open({ url: "https://example.com/app", launch: true })

// 5. 先看看页面把入口叫什么（不点击）
web_open({ match: "国家安全教育", listOnly: true })

// 6. 同名元素不止一个时用 index 选
web_open({ match: "国家安全教育", index: 0 })
```

匹配规则：完全相同 > 以它开头 > 包含；`<a>` 链接在平手时优先。
匹配不到时会把候选列出来，而不是猜一个。

## 数据与隐私

- 网址清单在 `~/.dsh/browser-takeover-sites.json`，只存 URL 和时间戳。
- 不读、不填账号密码输入框；不导出 cookie 的**值**。设置页和 `web_sites` 只回显会话 cookie 的
  **名字**（如 `SESSDATA`、`JSESSIONID`）。
- 端口没开时，登录状态显示「无法判断」，而不是冒充「未登录」。

## 故障排查

| 现象 | 原因 | 处理 |
|---|---|---|
| `no-debug-port` | 浏览器没带调试参数启动 | 跑 `scripts\start-edge-debug.cmd`，或 `web_open({ …, launch: true })` |
| Agent 没先查清单 | 插件是在加这段提示之前加载的 | 重启 DSH Desktop |
| 设置页显示「端口未开」 | 同上，或端口不是 9333 | 检查 `browser.json` |
| 点了没反应 | 站点用 `window.open`，被弹窗拦截 | 对 `<a href>` 插件会直接导航；其余元素只能真点 |
| 登录状态「无法判断」 | 浏览器没开，读不到 cookie | 先启动调试浏览器 |

## 开发

```bash
npm run check     # 逐文件 node --check（含 client.js 与 test/）
npm test          # node --test：清单匹配与系统提示段的单元测试
npm run smoke     # 用假的 defineTool 跑一遍 apply()，并真的执行两个工具（不碰浏览器）
```

`npm test` 会 fork 子进程；如果你的环境禁止 fork（某些沙箱），直接跑
`node test/lookup.test.mjs` 也能执行（同一进程内）。

## 许可

MIT。条款见 [LICENSE](LICENSE)。
