# 浏览器网址接管 · dsh-browser-takeover

> 让 DSH 里的模型在你**已经登录**的浏览器里走过去：打开网址、按页面上的可见文字点一个入口；
> 同时维护一份「要登录的网址」清单，检查每个站点登录了没有，一键打开登录页。

---

## 功能

| 能力 | 入口 | 说明 |
|---|---|---|
| 页面导航 / 按文字点击 | 工具 `web_open` | 在带调试端口的浏览器里打开地址，按可见文字点一个元素；会搜所有 iframe |
| 网址清单 | 设置 → 浏览器网址接管 | 只存 URL 与添加时间，不存账号密码 |
| 登录状态 | 同上 | 依据该站点的**会话 cookie 名字**判断，cookie 的值不离开宿主进程 |
| 打开登录页 | 同上 | 端口开着就开新标签，没开就带调试参数启动浏览器 |

一次调用最多点**一个**元素；不做循环点击、不批量爬取。

## 安装

```bash
git clone git@github.com:L1818346/dsh-browser-takeover.git
cd dsh-browser-takeover
node scripts/install-dev.mjs     # 用 junction 挂进 desktop profile 并注册 bundle
```

然后**重启 DSH Desktop**（插件树在进程启动时组装）。

要求：

- Node.js ≥ 20
- Edge 或 Chrome（要能开 `--remote-debugging-port`，即 CDP）

## 浏览器准备

插件不会读你的主浏览器。它要的是**一只带调试端口的独立窗口**，默认端口 `9333`：

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
  "launchBrowser": false
}
```

| 键 | 默认 | 说明 |
|---|---|---|
| `browserPort` | 无 | 调试端口；没配时工具里显式传 `browserPort`，最后才落到 9333 |
| `launchBrowser` | `false` | 需要浏览器时是否由插件自己拉起。默认关：不替用户随便开程序 |

端口只该有一个说法。

## 用法

```js
// 打开门户，再点「学习空间」
web_open({ url: "https://hdu.fanya.chaoxing.com/portal", match: "学习空间" })

// 先看看页面把入口叫什么（不点击）
web_open({ match: "国家安全教育", listOnly: true })

// 点进去；同名元素不止一个时用 index 选
web_open({ match: "国家安全教育", index: 0 })
```

匹配规则：完全相同 > 以它开头 > 包含；`<a>` 链接在平手时优先。
匹配不到时会把候选列出来，而不是猜一个。

## 数据与隐私

- 网址清单在 `~/.dsh/browser-takeover-sites.json`，只存 URL 和时间戳。
- 不读、不填账号密码输入框；不导出 cookie 的**值**。设置页只回显会话 cookie 的**名字**
  （如 `SESSDATA`、`JSESSIONID`）。
- 端口没开时，登录状态显示「无法判断」，而不是冒充「未登录」。

## 故障排查

| 现象 | 原因 | 处理 |
|---|---|---|
| `no-debug-port` | 浏览器没带调试参数启动 | 跑 `scripts\start-edge-debug.cmd` |
| 设置页显示「端口未开」 | 同上，或端口不是 9333 | 检查 `browser.json` |
| 点了没反应 | 站点用 `window.open`，被弹窗拦截 | 对 `<a href>` 插件会直接导航；其余元素只能真点 |
| 登录状态「无法判断」 | 浏览器没开，读不到 cookie | 先启动调试浏览器 |

## 许可

MIT。源自 [SAOS-3624/dsh-video-storyboard](https://github.com/SAOS-3624/dsh-video-storyboard)
（MIT）；版权、第三方说明见 [LICENSE](LICENSE)、[CREDITS.md](CREDITS.md)、[NOTICE](NOTICE)。
