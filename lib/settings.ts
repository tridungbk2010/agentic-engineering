import os from 'node:os'
import path from 'node:path'

export const ROOT = path.resolve(import.meta.dirname, '..')

/** Days that raw output, traces and logs are kept before `pnpm clean` removes them. */
export const RETENTION_DAYS = Number(process.env.AE_RETENTION_DAYS ?? 7)

// Read lazily so a test can point these at a temp dir.
export const outDir = () => path.resolve(process.env.AE_OUT_DIR ?? path.join(ROOT, 'out'))
export const rawDir = () => path.join(outDir(), 'raw')
export const reportsDir = () => path.join(outDir(), 'reports')
export const tracesDir = () => path.join(outDir(), 'traces')
export const logsDir = () => path.join(outDir(), 'logs')

/** Changing AUTH_DIR means changing the Read deny rule in .claude/settings.json too. */
export const authDir = () => path.resolve(process.env.AUTH_DIR ?? path.join(os.homedir(), '.agentic-engineering', 'auth'))

/** `msedge` is the target. `chrome` works on a machine without Edge; `chromium` uses Playwright's bundled build. */
export const browserChannel = () => process.env.AE_BROWSER_CHANNEL ?? 'msedge'

export const timestamp = (date = new Date()) => date.toISOString().replace(/[:.]/g, '-')

export const TASK_NAME = /^[a-z0-9][a-z0-9-]*$/
