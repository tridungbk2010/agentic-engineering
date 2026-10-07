# Verification notes

What was checked while building this, on macOS 27 with Node 25, pnpm 11.28.5, Playwright 1.63.0, playwright-cli 0.1.21 and Google Chrome 154. Microsoft Edge was not installed on the build machine, so every browser check below ran on the `chrome` channel.

## Phase 1 checklist (plan v4, section 9)

| Check | Result |
|---|---|
| Can the CLI `route` command filter by method? | No. It only mocks (`--status`, `--body`, `--header`). Probe-time blocking uses `run-code` with `context.route`; verified that a POST from the page is blocked, a GET still passes, and the guard survives a navigation. |
| Do playwright-cli (`--profile`) and the script share one profile? | Yes. A cookie written by the script is visible to the CLI on the same directory. |
| Is a profile held by the CLI detected? | Yes. `launch()` raises `ProfileLockedError` (exit 1) while a CLI session has the profile open. Chromium keeps a `SingletonLock` symlink named `<host>-<pid>` in an open profile. |
| Does Playwright have `routeWebSocket`? | Yes in 1.63.0. A socket opened by the page is closed with code 1008 and never reaches the server. |
| Is `CLAUDECODE` set in the Claude Code shell? | Yes (`CLAUDECODE=1`). |
| Does `.playwright/cli.config.json` apply `contextOptions`? | Yes. `locale` and `serviceWorkers: "block"` are applied. `--browser=chrome` overrides the config's `msedge` channel. |
| Where does `playwright-cli install --skills` write? | `.claude/skills/playwright-cli/`. |
| Does `pnpm signin` run the script? | Yes. `pnpm signin` with no arguments prints this project's usage line. |
| Do session-only cookies survive closing a persistent context? | No. The mock-app test confirms a session cookie is gone on the next launch (exit 2). |

## Found along the way

- **A cookie written just before `playwright-cli close` can be lost.** In two trials, a cookie set immediately before `close` was missing on the next launch, and one set 35 seconds before `close` was there. That fits Chromium saving cookies on a timer that `close` does not wait for, but two data points do not establish the interval. The script side closes its context cleanly and did not show this. If a crawl gives exit 2 right after probing, run `pnpm signin` again.
- **A write the task fires without awaiting it.** When `run()` returned, such a request had not reached the guard yet, and closing the browser dropped it: not sent, but not reported either. `run.ts` now waits for the page to be quiet (250 ms without requests, 3 s at most) before judging the run, so it gives exit 4. The output file is also written only after the browser has closed.
- **pnpm blocks dependency build scripts by default.** `pnpm-workspace.yaml` allows `esbuild` (needed by `tsx`).

## Phase 3 results

- `pnpm test`: unit tests plus 28 end-to-end cases against `test/mock-app.ts` (plan 3b). The route guard, the WebSocket guard, the api wrapper, the SSO wait, the output sanitizer and the quiet-page wait were each also checked by breaking the code on purpose and seeing their tests fail.
- `pnpm test:live` and a manual pass through `pnpm crawl quotes` (plan 3a): 100 records, exit 0. `minRecords: 1000` gives exit 3, `uniqueKey: 'author'` gives exit 3, `maxPages: 3` gives exit 1, a broken field mapping gives exit 3 and exit 0 again once repaired.

The quotes task reads the site's JSON API, so the plan's "break a selector, then fix" check was done as "break a field mapping, then fix".

## Not verified

- **Microsoft Edge.** Nothing here ran on `msedge`.
- **Phase 0**: Edge policies, SSO, Conditional Access, a real sign-in.
- **The `/web-crawl-script` skill being invoked** in Claude Code or Cursor. The quotes task was written by hand following SKILL.md.
- **Cursor**: that it loads `.claude/skills/`, that `.cursor/commands/` still works, and which environment variable its agent terminal sets. `run.ts` checks `CLAUDECODE`, `CURSOR_AGENT` and `AE_AGENT`; `CURSOR_AGENT` is a guess.
- **Company-managed Claude Code settings.** If they set `allowUnsandboxedCommands: false`, the `excludedCommands` in this repo are ignored and must be declared in managed settings instead.

### Checking the sandbox yourself

Start Claude Code in this folder, ask it to run the command below, and expect it to be refused:

```bash
node -e "console.log(require('fs').readdirSync('out/raw'))"
```
