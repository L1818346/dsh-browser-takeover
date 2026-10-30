# Changelog

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
