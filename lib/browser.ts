import fs from 'node:fs'
import path from 'node:path'
import { chromium, type BrowserContext } from 'playwright'
import { ProfileLockedError } from './exit.ts'
import { authDir, browserChannel } from './settings.ts'

/** One profile per site and env, shared by every task on that site and by playwright-cli. */
export function profileDir(site: string, envName: string): string {
  const root = authDir()
  fs.mkdirSync(root, { recursive: true, mode: 0o700 })
  fs.chmodSync(root, 0o700)
  const dir = path.join(root, `${site}-${envName}`)
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  return dir
}

// Matches .playwright/cli.config.json, so probing and crawling see the same language.
const DEFAULT_LOCALE = 'en-US'

const LOCKED_HINT = 'run `playwright-cli close` (or `playwright-cli kill-all`), and wait for any other crawl or signin to finish'

/** Chromium keeps a SingletonLock symlink named `<host>-<pid>` in a profile that is open. */
function lockHolder(dir: string): number | undefined {
  let target: string
  try {
    target = fs.readlinkSync(path.join(dir, 'SingletonLock'))
  } catch {
    return undefined
  }
  const pid = Number(target.slice(target.lastIndexOf('-') + 1))
  if (!Number.isInteger(pid) || pid <= 0) return undefined
  try {
    process.kill(pid, 0)
    return pid
  } catch (error) {
    // EPERM means the process exists but belongs to someone else; anything else means it is gone.
    return (error as NodeJS.ErrnoException).code === 'EPERM' ? pid : undefined
  }
}

export async function launch(options: { site: string; envName: string; headed?: boolean; locale?: string }): Promise<BrowserContext> {
  const dir = profileDir(options.site, options.envName)
  if (lockHolder(dir) !== undefined) throw new ProfileLockedError(`profile ${options.site}-${options.envName} is in use: ${LOCKED_HINT}`)

  const channel = browserChannel()
  try {
    return await chromium.launchPersistentContext(dir, {
      channel: channel === 'chromium' ? undefined : channel,
      headless: !options.headed,
      locale: options.locale ?? DEFAULT_LOCALE,
      // A service worker can answer requests without context.route ever seeing them.
      serviceWorkers: 'block',
    })
  } catch (error) {
    // Two launches can pass the check above at the same moment; Chromium then refuses the second one.
    if (error instanceof Error && /ProcessSingleton|profile is already in use/i.test(error.message)) {
      throw new ProfileLockedError(`profile ${options.site}-${options.envName} is in use: ${LOCKED_HINT}`)
    }
    throw error
  }
}
