# dsh-browser-takeover

> Walk the browser you are **already signed in to**: open a URL, click one entry by its visible
> text, keep a list of login-gated sites — and let the agent **look that list up before it visits
> any URL**, preferring this plugin for the sites it saved.

---

## What 0.9.0 changes

- **The list starts empty** — no preset URL, and no reading another plugin's
  `video-storyboard-sites.json`. You add the first site yourself (the settings page, or
  `web_open({ …, remember: true })`).
- **The CDP layer is one small module**, `src/cdp.js`: list page targets, evaluate in a page or in
  every frame context, read cookies, report the port state, launch the browser on demand. The
  video-era helpers (playback position, media cookie export) are gone.
- **Four browser states only**: `open` / `closed` / `unconfigured` / `error`.
- **The port comes from `~/.dsh/browser.json` only** (`video.json` is no longer read).
- The MIT text stays; the copyright line was removed.

## What 0.8.0 adds

- **`web_sites`** — look the saved list up before visiting: is this address saved, and is the
  browser signed in there? Side-effect free: no browser, no page.
- **`web_open` carries the answer** — its reply always includes `site` (exact / same host / same
  domain) and `signIn`; new `remember` saves the URL as it opens, `launch` starts the debug browser
  when the port is closed.
- **A system-prompt section** — the agent checks `web_sites` first and opens saved sites with
  `web_open` instead of `web_fetch` (which cannot see a logged-in page).
- Matching moved to `src/lookup.js` (pure), sign-in state to `src/session.js`, plus `test/` unit
  tests. **Restart DSH Desktop once** after upgrading: tools and the prompt are assembled at start.

## What it provides

| Surface | Where | Notes |
|---|---|---|
| Look the list up | tool `web_sites` | side-effect free: is this URL saved, and is the browser signed in there? starts no browser, loads no page |
| Navigate / click by text | tool `web_open` | navigates and clicks ONE element in a browser started with a debug port; every frame is searched |
| Site list | Settings → Browser Session Takeover | URLs only — no credentials |
| Sign-in state | same | derived from the *names* of that site's session cookies; values never leave the host |
| Open login page | same | new tab when the port is up, otherwise launches the browser with the debug flag |

At most one click per call. No loops, no bulk crawling.

## The visiting order the agent follows

The plugin adds a short section to the system prompt (`src/prompt.js`), so when asked to visit a URL
the agent:

1. calls `web_sites({ url })` first — free, and it answers whether the URL is saved;
2. when it is (`saved: true`, or `hostSite` for another path on a saved host) → **opens it with
   `web_open`**, not `web_fetch` (fetching HTML cannot see a logged-in page);
3. when it is not → still prefers `web_open`; for a login-gated site, sign in once in that window and
   pass `remember: true` so the next visit already counts as saved.

`web_open` carries the same judgement back in its reply, so even a direct call shows whether the URL
was saved and whether the session is signed in:

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
    "note": "清单里有这条网址（…）——用 web_open 在插件浏览器里打开…"
  },
  "signIn": { "conclusive": true, "signedIn": true, "sessionCookieNames": ["JSESSIONID"] }
}
```

Matching: same address > same host (the login session applies too) > same registrable domain
(information only). `www.`, trailing slashes, query and hash are ignored when comparing; differences
are echoed back rather than guessed away.

## Install

```bash
git clone git@github.com:L1818346/dsh-browser-takeover.git
cd dsh-browser-takeover
node scripts/install-dev.mjs     # junction into the desktop profile + register the bundle
```

Then **restart DSH Desktop** — the plugin tree and the system prompt are composed at process start,
so tool and prompt changes need a restart. The site list **starts empty**: nothing is preset, the
first site is yours to add.

Requirements: Node.js ≥ 20 and Edge/Chrome (CDP via `--remote-debugging-port`).

## Browser setup

The plugin does not read your everyday profile: Chromium 136+ refuses a debug port on the default
profile ([announcement](https://developer.chrome.com/blog/remote-debugging-port)), and pointing a
second browser at the same profile data cannot decrypt the existing cookies (App-Bound Encryption
binds them to the data directory). So it needs a **separate window with the debug port open**,
default `9333`:

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
  "launchBrowser": true
}
```

| Key | Default | Meaning |
|---|---|---|
| `browserPort` | none | debug port; the tool argument wins, then this file, then 9333 |
| `launchBrowser` | `false` | for saved sites whose port is closed, may the plugin start the browser itself; with `true`, "prefer this plugin" needs no manual step |

One port, one answer.

## Usage

The list starts empty: add the first URL on the settings page, or use `remember: true` while opening.

```js
// 1. look it up first (free, no browser)
web_sites({ url: "https://example.com/portal" })

// 2. open it through the plugin browser (already signed in)
web_open({ url: "https://example.com/portal", match: "My courses" })

// 3. a new login-gated site: sign in, then save it in the same call
web_open({ url: "https://example.com/app", match: "My courses", remember: true })

// 4. port closed: let the plugin start the browser, then open
web_open({ url: "https://example.com/app", launch: true })

// 5. list candidates without clicking
web_open({ match: "Course name", listOnly: true })

// 6. pick among several matches
web_open({ match: "Course name", index: 0 })
```

Matching: exact > prefix > substring; links win ties. When nothing matches, candidates are returned
instead of a guess.

## Data and privacy

- Site list: `~/.dsh/browser-takeover-sites.json` — URLs and timestamps only, **empty by default**,
  with nothing preset and nothing adopted from another plugin's file.
- No credential reads/fills, no cookie **values** exported. The settings page and `web_sites` echo
  session cookie **names** only (`SESSDATA`, `JSESSIONID`, ...).
- When the port is down, sign-in state is reported as "cannot tell", not "signed out".

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `no-debug-port` | browser started without the debug flag | run `scripts\start-edge-debug.cmd`, or `web_open({ …, launch: true })` |
| agent does not check the list | plugin was loaded before this section existed | restart DSH Desktop |
| settings says port closed | not running, or a different port | check `browser.json` |
| click does nothing | site uses `window.open`; popup blocked | `<a href>` entries are navigated directly; others can only be clicked |
| sign-in "cannot tell" | browser not running | start the debug browser |

## Development

```bash
npm run check     # node --check per file, including client.js and test/
npm test          # node --test: matching and prompt-section unit tests
npm run smoke     # apply() against a fake defineTool, then really runs both tools (no browser)
```

`npm test` forks a child process per file; where forking is not allowed, running
`node test/lookup.test.mjs` executes the same tests in-process.

## License

MIT. See [LICENSE](LICENSE).
