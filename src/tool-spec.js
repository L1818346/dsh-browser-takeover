/**
 * tool-spec.js — web_open 的工具定义（**不含 execute**）。
 *
 * 单独抽出来是为了让脚本能把同一份 spec 丢给宿主真实的 `defineTool` 编译一遍。
 * schema 用了宿主不认的关键字时，`ctx.tools.register()` 会在 apply() 阶段抛错，
 * 整棵插件树（连带应用）都起不来。
 *
 * 宿主支持的子集（见 @deepseek-ai/dsh-tools 的 ValueSchemaSpec）：
 *   string / number / integer / boolean / null / array(items) / object(properties, additionalProperties) / json / oneOf
 * **不支持** minimum、maximum、pattern、maxItems、minLength、format 等注解式约束。
 */

export const WEB_OPEN_TOOL_NAME = 'web_open';

/**
 * 导航类工具：打开地址、按可见文字点一个入口。
 * 只有"走页面"，没有"播页面"——play / seek / 等播放完成一律不在这里。
 */
export function webOpenToolSpec() {
  return {
    name: WEB_OPEN_TOOL_NAME,
    description: [
      'Walk a web app in the browser that has the debug port open: navigate to a URL, then click ONE',
      'element by its visible text (e.g. "学习空间", a course name). Every frame is searched, so entries',
      'inside an <iframe> are found too.',
      '',
      'This is NAVIGATION ONLY. It never plays, seeks, mutes or waits for a video, and it never touches',
      'credentials — the browser\'s own logged-in session is the whole of the authorisation.',
      '',
      'When the text matches several elements, the reply lists them; call again with index to pick one,',
      'or listOnly: true to see what the page calls things without clicking anything.',
      '',
      'Typical use: web_open({ url: "https://<portal>/portal", match: "学习空间" }), then',
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
      browserPort: {
        type: 'number',
        description: 'Debug port of the browser. Falls back to browser.json / video.json browserPort, then 9333.',
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
          text: { type: 'string', required: true, description: 'JSON: what was opened/clicked, the page it landed on, candidates.' },
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
