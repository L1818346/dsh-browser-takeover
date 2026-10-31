/**
 * tool-spec.js — 两个工具的定义（**不含 execute**）：`web_open` 与 `web_sites`。
 *
 * 单独抽出来是为了让脚本能把同一份 spec 丢给宿主真实的 `defineTool` 编译一遍。
 * schema 用了宿主不认的关键字时，`ctx.tools.register()` 会在 apply() 阶段抛错，
 * 整棵插件树（连带应用）都起不来。
 *
 * 宿主支持的子集（见 @deepseek-ai/dsh-tools 的 ValueSchemaSpec）：
 *   string / number / integer / boolean / null / array(items) / object(properties, additionalProperties) / json / oneOf
 * **不支持** minimum、maximum、pattern、maxItems、minLength、format 等注解式约束。
 *
 * 两个工具的**分工**写死在描述里：`web_sites` 只查清单（零副作用），
 * `web_open` 才真的走页面。Agent 先查后开，才谈得上"优先用这个插件访问"。
 */

export const WEB_OPEN_TOOL_NAME = 'web_open';
export const WEB_SITES_TOOL_NAME = 'web_sites';

/**
 * 查询类工具：这条网址在用户的「要登录的网址」清单里吗？那个浏览器此刻登录着没有？
 * 不启动浏览器、不打开页面、不点任何东西。
 */
export function webSitesToolSpec() {
  return {
    name: WEB_SITES_TOOL_NAME,
    description: [
      'Look up the saved-site list of this plugin ("要登录的网址"): is this URL already saved, and is',
      'the browser signed in there right now?',
      '',
      'Call this FIRST whenever the user asks you to open or visit a URL. A saved site is one this',
      'plugin already drives with the user\'s own logged-in browser session, so visiting it through',
      'web_open needs no re-login. Answering costs nothing: no browser is started and no page is loaded.',
      '',
      'Pass url to check one address. Omit it to list every saved site with its sign-in state.',
      'saved:true means that exact address is saved; a different path on the same host shows up as',
      'hostSite (same login session applies) and the domain shortcut as domainSite.',
      '',
      'Sign-in state comes from session-cookie NAMES only (SESSDATA, JSESSIONID, ...); cookie values',
      'never leave the Host process. When the debug port is closed the reply says conclusive:false',
      'instead of pretending the user is signed out.',
    ].join('\n'),
    parameters: {
      url: {
        type: 'string',
        description: 'The address you are about to visit. Omit to list the whole saved-site list.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string', required: true, description: 'JSON: saved / match / sign-in state, or every saved site.' },
        },
      },
      render(args, value) {
        return [{ type: 'text', text: value.text }];
      },
    },
    timeoutMs: 30_000,
    isConcurrencySafe() {
      return true;
    },
  };
}

/**
 * 导航类工具：打开地址、按可见文字点一个入口。
 * 只有"走页面"，没有"播页面"——play / seek / 等播放完成一律不在这里。
 */
export function webOpenToolSpec() {
  return {
    name: WEB_OPEN_TOOL_NAME,
    description: [
      'Walk a web app in the user\'s browser (the one with the debug port open): navigate to a URL, then',
      'click ONE element by its visible text (e.g. "学习空间", a course name). Every frame is searched, so',
      'entries inside an <iframe> are found too.',
      '',
      'This is the PREFERRED way to open any URL the user asks for, and the only path that carries their',
      'logged-in session. Check web_sites({ url }) first (one cheap call): when it says saved:true or',
      'hostSite, use web_open instead of web_fetch — fetching HTML cannot see a logged-in page.',
      '',
      'Pass remember:true to save the URL into that list as it opens, so the next visit already counts as',
      'a saved site. Pass launch:true to let the plugin start the debug browser when its port is closed',
      '(otherwise the reply says no-debug-port and you should ask the user to start it).',
      '',
      'When the text matches several elements, the reply lists them; call again with index to pick one,',
      'or listOnly: true to see what the page calls things without clicking anything.',
      '',
      'Typical use: web_sites({ url: "https://<portal>/portal" }), then',
      'web_open({ url: "https://<portal>/portal", match: "学习空间" }), then',
      'web_open({ match: "<course name>" }).',
    ].join('\n'),
    parameters: {
      url: {
        type: 'string',
        description: 'Open this address first (same tab). Optional when the browser is already on the page.',
      },
      match: {
        type: 'string',
        description: 'Visible text of the element to click. Exact match beats prefix beats substring; ' +
          'links win ties. Omit to only report the page.',
      },
      index: {
        type: 'number',
        description: 'Which candidate to click when several match (0-based, default 0).',
      },
      remember: {
        type: 'boolean',
        description: 'Save `url` into the plugin\'s saved-site list before opening it (default false).',
      },
      launch: {
        type: 'boolean',
        description: 'Start the debug browser when its port is closed, then continue (default false: ' +
          'report no-debug-port and let the user start it).',
      },
      browserPort: {
        type: 'number',
        description: 'Debug port of the browser. Falls back to browser.json (browserPort), then 9333.',
      },
      waitMs: {
        type: 'number',
        description: 'How long to wait after the click before reporting (default 2500 ms).',
      },
      listOnly: {
        type: 'boolean',
        description: 'Report matching elements without clicking anything.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string', required: true, description: 'JSON: what was opened/clicked, the page it landed on, saved-site state, candidates.' },
        },
      },
      render(args, value) {
        return [{ type: 'text', text: value.text }];
      },
    },
    timeoutMs: 60_000,
    isConcurrencySafe() {
      return false;
    },
  };
}
