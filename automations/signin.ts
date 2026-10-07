// pnpm signin <task> [--env <name>]
// Opens a headed browser on the task's profile so a person can sign in by hand. No guard here:
// signing in needs POSTs, and a person is driving.
import { launch } from '../lib/browser.ts'
import { ProfileLockedError, UsageError } from '../lib/exit.ts'
import { loadTask, parseCli, pickEnv } from '../lib/task.ts'

try {
  const cli = parseCli(process.argv.slice(2), 'pnpm signin <task> [--env <name>]')
  const module = await loadTask(cli.task)
  const { name, env } = pickEnv(module, cli.envName)

  const context = await launch({ site: module.config.site, envName: name, headed: true, locale: module.config.locale })
  const closed = new Promise<void>((resolve) => context.on('close', () => resolve()))
  const page = context.pages()[0] ?? (await context.newPage())
  await page.goto(env.startUrl, { waitUntil: 'domcontentloaded' }).catch(() => {
    // the person can still type the address themselves
  })

  console.log(`signin ${cli.task} [${name}]: sign in in the browser window (choose "Stay signed in" if offered).`)
  console.log('Close the browser window when you are done.')
  await closed
  console.log('profile saved.')
  process.exit(0)
} catch (error) {
  if (error instanceof UsageError || error instanceof ProfileLockedError) console.error(error.message)
  else console.error(`signin failed: ${error instanceof Error ? error.name : 'Error'}`)
  process.exit(1)
}
