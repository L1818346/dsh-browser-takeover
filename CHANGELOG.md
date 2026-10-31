# Changelog

## [0.9.1] — 2026-10-31

### Fixed

- **GitHub 登录成功却显示「未登录」**：登录判定只认 `SESSDATA` / `JSESSIONID` / `UID` 这套
  学习通/B 站的名字，而 GitHub 用的是 `user_session` / `logged_in` / `dotcom_user`。
  白名单补齐 GitHub、Google、Microsoft、知乎、微博等常见名字，并加通用规则兜底。
- `logged_in` 这类开关型 cookie 改为按值判断：`logged_in=no` 不算登录（之前只看名字会误报）。

### Added

- 判定分两档：命中已知名字 → `confidence: 'certain'`；只命中通用规则
  （名字含 session / sso / auth / token / ticket 且值长度 ≥ 8）→ `'likely'`。
  设置页对应显示「已登录」/「可能已登录」，`web_sites` 与 `signIn` 输出里带 `confidence`。
- 通用规则刻意不收 `sess`：GitHub 未登录时也有 `_gh_sess`，收了会误报。
- `test/session.test.mjs`：10 条用例，含 GitHub 登录/未登录两组真实 cookie 形状。

## [0.9.0] — 2026-10-31

### Changed

- **CDP 层收成一个小模块**：`src/browser-time.js` 换成 `src/cdp.js`，只保留这个插件真正用到的
  能力——找页面目标、在页面/每个 iframe 上下文里求值、读 cookie、回答端口状态、按端口拉起浏览器。
  删掉视频时代的位置读取（`readBrowserPosition`）、iframe 快照、`probeBrowser` 的视频扫描、
  媒体 cookie 导出（`cookiesToNetscape` / `writeBrowserCookiesFile`）等：627 行 → 374 行。
- **`probeBrowser` 语义简化**：状态只剩 `open` / `closed` / `unconfigured` / `error`，
  不再返回"页面里有没有视频"。设置页文案同步。
- **端口只认 `~/.dsh/browser.json`**：不再回退到 `video.json`（那是另一个插件的配置）。
- **清单不再有默认项**：删掉预置的学习通入口与旧文件名 `video-storyboard-sites.json` 的回退。
  新装的插件清单为空，第一条网址由用户自己加（设置页或 `web_open({ …, remember: true })`）。
- **删除许可证的版权声明行**：`LICENSE` 保留 MIT 正文，不再有 `Copyright (c) …`。
- 新增 `test/sites.test.mjs`：空清单、增删、重复、以及"存在旧文件名也不读"的行为。

## [0.8.1] — 2026-10-31

### Changed

- 移除上游来源与第三方声明：README / README.en 的「来源」段、`CREDITS.md`、`NOTICE`，以及
  `package.json` 里的 `contributors` 与 `files` 条目。本插件已经不含来源项目的代码，也不再
  引用它的文档与二进制说明（`NOTICE` 里提到的 `docs/demo*.png`、`vendor/ffmpeg` 在本仓库从未存在）。
- 只有文档与元数据变化，运行时代码与 0.8.0 完全一致。

## [0.8.0] — 2026-10-31

### Added

- `web_sites` 工具：访问网址前先查「要登录的网址」清单——这条地址存过没有、那个浏览器
  此刻登录着没有。零副作用：不启动浏览器、不打开页面、不点任何东西。
- 系统提示里的一段约定（`src/prompt.js`）：用户让 Agent 访问网址时，先 `web_sites`，
  清单里的（或同一站点的）优先用 `web_open`，不要改用 `web_fetch` 抓 HTML 顶替。
- `web_open` 新增两个参数：`remember`（打开前先把网址记进清单，下次访问自动算"已保存"）、
  `launch`（端口没开时让插件自己拉起浏览器再打开）。
- `web_open` 的返回里带上 `site`（清单命中情况与一句结论）与 `signIn`（登录态），
  所以即使 Agent 没先查，也看得到"这条网址存过没有、登录着没有"。
- `test/lookup.test.mjs`：清单匹配规则的单元测试（完全一致 / 同主机 / 同域名 / 坏地址 / 裸域名）。

### Changed

- 清单匹配独立成 `src/lookup.js`（纯函数、可单测）；登录态判断抽到 `src/session.js`，
  设置页与工具共用同一份实现，隐私边界（只回显会话 cookie 名字）只写一遍。
- `scripts/smoke.mjs` 现在校验两个工具、五条路由和一个提示词段，并真的执行一次
  `web_sites` 与 `web_open`（端口不通的路径，不碰浏览器）。
- `scripts/check-syntax.mjs` 把 `client.js` 与 `test/` 也纳入语法检查。
- README 增加"Agent 访问网址的顺序"，并说明为什么不能直接用你主浏览器的 profile。

## [0.7.0] — 2026-10-31

### Added

- `web_open` 工具：在带调试端口的浏览器里打开地址，按可见文字点一个入口；匹配会搜所有
  iframe，找不到时列出候选而不是猜。
- 设置页：维护要登录的网址清单、检查各站点的登录状态（只看会话 cookie 的名字）、
  一键打开登录页。
- CDP 连接与按端口启动浏览器；端口配置优先读 `~/.dsh/browser.json`，
  也接受 `~/.dsh/video.json`。
- `scripts/smoke.mjs`：用假的 `defineTool` 跑一遍 `apply()`，校验注册的工具与路由。
- `scripts/install-dev.mjs`：包名从 `package.json` 读取，用 junction 挂进 profile；
  卸载时不会跟着链接删源码。
