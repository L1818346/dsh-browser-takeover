# dsh-browser-takeover

> Walk the browser you are **already signed in to**: open a URL, click one entry by its visible
> text, keep a list of login-gated sites, check sign-in state, and open login pages.

---

## What it provides

| Surface | Where | Notes |
|---|---|---|
| Navigate / click by text | tool `web_open` | navigates and clicks ONE element in a browser started with a debug port; every frame is searched |
| Site list | Settings → Browser Session Takeover | URLs only — no credentials |
| Sign-in state | same | derived from the *names* of that site's session cookies; values never leave the host |
| Open login page | same | new tab when the port is up, otherwise launches the browser with the debug flag |

At most one click per call. No loops, no bulk crawling.

## Install

```bash
git clone git@github.com:L1818346/dsh-browser-takeover.git
cd dsh-browser-takeover
node scripts/install-dev.mjs     # junction into the desktop profile + register the bundle
```

Then **restart DSH Desktop** (the plugin tree is composed at process start).

Requirements: Node.js ≥ 20 and Edge/Chrome (CDP via `--remote-debugging-port`).

## Browser setup

The plugin does not touch your everyday browser. It needs a **separate window with the debug
port open**, default `9333`:

```bat
scripts\start-edge-debug.cmd
```

That starts Edge with the dedicated profile `~/.dsh/edge-watch` and the debug port. Sign in there
once; the plugin reuses that session. Your normal Edge window is untouched.

Or start it yourself:

```bat
msedge.exe --remote-debugging-port=9333 --user-data-dir="%USERPROFILE%\.dsh\edge-watch"
```

## Configuration

`~/.dsh/browser.json`:

```json
{
  "browserPort": 9333,
  "launchBrowser": false
}
```

| Key | Default | Meaning |
|---|---|---|
| `browserPort` | none | debug port; the tool argument wins, then this file, then 9333 |
| `launchBrowser` | `false` | let the plugin start the browser when needed; off by default |

One port, one answer.

## Usage

```js
web_open({ url: "https://example.com/portal", match: "My courses" })
web_open({ match: "Course name", listOnly: true })   // list candidates, click nothing
web_open({ match: "Course name", index: 0 })         // click one
```

Matching: exact > prefix > substring; links win ties. When nothing matches, candidates are
returned instead of a guess.

## Data and privacy

- Site list: `~/.dsh/browser-takeover-sites.json`.
- No credential reads/fills, no cookie **values** exported. The settings page echoes session
  cookie **names** only (`SESSDATA`, `JSESSIONID`, ...).
- When the port is down, sign-in state is reported as "cannot tell", not "signed out".

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `no-debug-port` | browser started without the debug flag | run `scripts\start-edge-debug.cmd` |
| settings says port closed | not running, or a different port | check `browser.json` |
| click does nothing | site uses `window.open`; popup blocked | `<a href>` entries are navigated directly; others can only be clicked |
| sign-in "cannot tell" | browser not running | start the debug browser |

## License

MIT. Upstream: [SAOS-3624/dsh-video-storyboard](https://github.com/SAOS-3624/dsh-video-storyboard).
See [LICENSE](LICENSE), [CREDITS.md](CREDITS.md), [NOTICE](NOTICE).
