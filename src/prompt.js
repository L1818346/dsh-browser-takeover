/**
 * prompt.js — 写进系统提示的那段"访问网址的约定"。
 *
 * 为什么必须有这一段：工具描述只在模型"考虑这个工具"时起作用；用户说
 * "去访问某个网址"时，模型更可能直接 `web_fetch` 抓 HTML（那拿不到登录后的内容）。
 * 把约定放进系统提示，才谈得上"**优先**查询清单、**优先**走插件"。
 *
 * 用 `ctx.systemPrompt.section()` 注册（见 cordis-plugin-development/references/practices.md：
 * 加提示词用 section，不要监听 `system-prompt/assemble` 去改整份装配）。
 *
 * 文字刻意短：它在**每一次**请求里都要花 token。规则都在，细节交给工具描述。
 */

export const ROUTING_SECTION_NAME = 'dsh-browser-takeover.routing';

/**
 * 段落在系统提示里的位置。段落按 order 升序排，相同 order 按名字排（`comparePromptSections`），
 * 所以这个数值只要挑一个"读起来该在这儿"的位置即可，不需要全局唯一。
 *
 * 2150 = 紧跟在宿主自己的 `TOOL_WEB_FETCH`(2100) 之后：模型刚读完"怎么抓网页"，
 * 紧接着就是"访问网址先查清单、别用抓取顶替"。
 */
export const ROUTING_SECTION_ORDER = 2150;

export const ROUTING_TEXT = [
  '## 访问网址（dsh-browser-takeover）',
  '',
  '用户让你打开或访问一个网址时：',
  '',
  '1. 先调 `web_sites({ url })`：零成本查询，不启动浏览器、不打开页面，回答这条网址在不在用户的清单里。',
  '2. 回 `saved: true`，或 `hostSite` 指向同一站点 → 用 `web_open` 在插件浏览器里打开。那里的会话就是用户已登录的那个；不要改用 `web_fetch` 抓 HTML 顶替，抓不到登录后的内容。',
  '3. 清单里没有 → 也优先用 `web_open`。需要登录才看得全的站点，先让用户在那个窗口里登录一次，再用 `remember: true` 记进清单。',
  '4. `web_open` 回 `no-debug-port`：说明调试浏览器没开——让用户启动（`scripts\\start-edge-debug.cmd`），或改用 `launch: true` 让插件自己拉起。',
  '5. 一次调用最多点一个元素；不做循环点击，不批量爬取。',
].join('\n');

/** 不依赖宿主版本：拿到对象就试，拿不到就安静跳过 */
export function registerRoutingSection(scope) {
  const service = scope?.systemPrompt;
  if (!service || typeof service.section !== 'function') return () => {};
  return service.section({
    name: ROUTING_SECTION_NAME,
    order: ROUTING_SECTION_ORDER,
    text: ROUTING_TEXT,
    interpolate: false,
  });
}
