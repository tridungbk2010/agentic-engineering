// pnpm crawl <task> [--env <name>] [--headed] [--trace] [--param=value ...]
import fs from 'node:fs'
import path from 'node:path'
import type { BrowserContext } from 'playwright'
import { launch } from '../lib/browser.ts'
import {
  EXIT,
  MaxPagesError,
  RunTimeoutError,
  UsageError,
  ValidationError,
  checkAgentAllowed,
  formatReport,
  resolveExit,
  writeLog,
} from '../lib/exit.ts'
import { GuardState, createApi, installGuard } from '../lib/guard.ts'
import { validateRecords, writeOutput } from '../lib/output.ts'
import { ensureSession } from '../lib/session.ts'
import { ROOT, logsDir, rawDir, timestamp, tracesDir } from '../lib/settings.ts'
import { loadSchema, loadTask, parseCli, pickEnv } from '../lib/task.ts'

const relative = (file: string) => path.relative(ROOT, file) || file

async function main(): Promise<number> {
  const startedAt = new Date()
  const runId = timestamp(startedAt)
  const guard = new GuardState()
  let step = 'args'
  let taskName = '-'
  let envName = '-'
  let sessionExpired = false
  let context: BrowserContext | undefined
  let traceFile: string | undefined
  let error: unknown
  let summary = ''
  let valid: unknown[] | undefined
  let params: Record<string, string> = {}

  try {
    const cli = parseCli(process.argv.slice(2), 'pnpm crawl <task> [--env <name>] [--headed] [--trace] [--param=value]')
    taskName = cli.task
    params = cli.params
    const module = await loadTask(cli.task)
    const schema = await loadSchema(cli.task)
    const { config } = module
    const picked = pickEnv(module, cli.envName)
    envName = picked.name
    const env = picked.env
    checkAgentAllowed(env, envName, process.env)

    step = 'launch'
    context = await launch({ site: config.site, envName, headed: cli.headed, locale: config.locale })
    await installGuard(context, env, config, guard)
    // A 401 on the app's own XHR means the session is gone, whatever the task makes of the empty page.
    context.on('response', (response) => {
      if (response.status() !== 401) return
      const type = response.request().resourceType()
      if ((type === 'xhr' || type === 'fetch') && env.appOrigins.some((origin) => response.url().startsWith(`${origin}/`))) sessionExpired = true
    })
    if (cli.trace) {
      traceFile = path.join(tracesDir(), `${cli.task}-${runId}.zip`)
      await context.tracing.start({ screenshots: true, snapshots: true })
    }

    const page = context.pages()[0] ?? (await context.newPage())
    let pagesUsed = 0
    const work = async () => {
      step = 'navigate'
      await page.goto(env.startUrl, { waitUntil: 'domcontentloaded' })
      step = 'session'
      await ensureSession(page, env, config.session)
      step = 'run'
      const records = await module.run({
        page,
        api: createApi(context!, env, config, guard),
        params: cli.params,
        env,
        step: (name) => {
          step = `run: ${name}`
        },
        nextPage: () => {
          pagesUsed += 1
          if (pagesUsed > config.maxPages) throw new MaxPagesError(config.maxPages)
          return pagesUsed
        },
      })
      await guard.settle()
      // A blocked write or an expired session outranks whatever the task returned (priority 4 > 2 > 3 > 1).
      if (guard.violations.length > 0 || sessionExpired) return
      step = 'validate'
      valid = validateRecords(records, schema, config)
    }

    let timer: NodeJS.Timeout | undefined
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new RunTimeoutError(config.timeoutMs)), config.timeoutMs)
    })
    const running = work()
    // If the deadline wins, the task is still running and will reject once the browser closes.
    running.catch(() => {})
    try {
      await Promise.race([running, deadline])
    } finally {
      clearTimeout(timer)
    }
  } catch (caught) {
    error = caught
  }

  if (context) {
    try {
      if (traceFile) {
        fs.mkdirSync(path.dirname(traceFile), { recursive: true, mode: 0o700 })
        await context.tracing.stop({ path: traceFile })
        fs.chmodSync(traceFile, 0o600)
      }
      await context.close()
    } catch (closeError) {
      error ??= closeError
    }
  }

  // The file is written only after the browser is closed: by then every request the page could
  // still fire has been judged, so a late blocked write can never leave an output file behind.
  if (error === undefined && valid && guard.violations.length === 0 && !sessionExpired) {
    step = 'write'
    try {
      const meta = { task: taskName, env: envName, params, recordCount: valid.length, startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString() }
      const file = writeOutput(rawDir(), taskName, meta, valid)
      summary = `crawl ${taskName} [${envName}] OK records=${valid.length} file=${relative(file)}`
    } catch (writeError) {
      error = writeError
    }
  }

  const { code, kind } = resolveExit({ error, violations: guard.violations, sessionExpired })
  if (code === EXIT.OK) {
    console.log(summary)
    if (traceFile) console.log(`trace: ${relative(traceFile)} (holds real data and tokens, delete it after debugging)`)
    return code
  }

  const usageMessage = error instanceof UsageError ? error.message : undefined
  const logPath = usageMessage !== undefined ? undefined : relative(writeLog(logsDir(), `${taskName}-${runId}`, error ?? 'no error thrown', guard.violations))
  console.error(
    formatReport({
      task: taskName,
      env: envName,
      code,
      kind,
      step,
      logPath,
      issues: error instanceof ValidationError ? error.issues : undefined,
      violations: guard.violations,
      message: usageMessage,
    }),
  )
  return code
}

// A stray rejection would otherwise make Node print the raw error, which can hold page content.
for (const event of ['unhandledRejection', 'uncaughtException'] as const) {
  process.on(event, (reason) => {
    console.error(`crawl FAILED exit=${EXIT.OTHER}\nstep: ${event}\nerror: ${resolveExit({ error: reason ?? new Error(), violations: [], sessionExpired: false }).kind}`)
    process.exit(EXIT.OTHER)
  })
}

process.exit(await main())
