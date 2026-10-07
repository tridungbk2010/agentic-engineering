import fs from 'node:fs'
import path from 'node:path'
import type { EnvConfig } from './types.ts'

export const EXIT = { OK: 0, OTHER: 1, SESSION: 2, VALIDATION: 3, GUARD: 4 } as const

export type Violation = { method: string; origin: string; pathname: string; reason: string }
export type Issue = { path: string; code: string }

export class GuardError extends Error {
  override name = 'GuardError'
}

export class SessionExpiredError extends Error {
  override name = 'SessionExpiredError'
  constructor(message = 'session expired') {
    super(message)
  }
}

export class ValidationError extends Error {
  override name = 'ValidationError'
  issues: Issue[]
  constructor(issues: Issue[]) {
    super(`validation failed with ${issues.length} issue(s)`)
    this.issues = issues
  }
}

export class ProfileLockedError extends Error {
  override name = 'ProfileLockedError'
}

export class MaxPagesError extends Error {
  override name = 'MaxPagesError'
  constructor(maxPages: number) {
    super(`went past maxPages (${maxPages})`)
  }
}

export class RunTimeoutError extends Error {
  override name = 'RunTimeoutError'
  constructor(timeoutMs: number) {
    super(`run exceeded timeoutMs (${timeoutMs})`)
  }
}

export class HttpError extends Error {
  override name = 'HttpError'
  status: number
  constructor(status: number) {
    super(`HTTP ${status}`)
    this.status = status
  }
}

/** Raised for mistakes in how the command was called. Its message is ours, so it is safe to print. */
export class UsageError extends Error {
  override name = 'UsageError'
}

const SAFE_KIND = /^[A-Za-z][A-Za-z0-9]*$/

function kindOf(error: unknown): string {
  if (!(error instanceof Error)) return 'Error'
  return SAFE_KIND.test(error.name) ? error.name : 'Error'
}

/** Priority when several things went wrong: 4 > 2 > 3 > 1. */
export function resolveExit(input: { error?: unknown; violations: Violation[]; sessionExpired: boolean }): {
  code: number
  kind: string
} {
  const { error, violations, sessionExpired } = input
  if (violations.length > 0 || error instanceof GuardError) return { code: EXIT.GUARD, kind: 'GuardError' }
  if (sessionExpired || error instanceof SessionExpiredError) return { code: EXIT.SESSION, kind: 'SessionExpiredError' }
  if (error instanceof ValidationError) return { code: EXIT.VALIDATION, kind: 'ValidationError' }
  if (error !== undefined) return { code: EXIT.OTHER, kind: kindOf(error) }
  return { code: EXIT.OK, kind: 'ok' }
}

const HINTS: Record<number, (task: string) => string> = {
  [EXIT.GUARD]: () => 'review the script, do not run it again as is',
  [EXIT.SESSION]: (task) => `pnpm signin ${task}, then run again`,
  [EXIT.VALIDATION]: (task) => `/web-crawl-script fix ${task}`,
  [EXIT.OTHER]: () => 'run again; if it repeats, use --headed --trace',
}

const MAX_ISSUES = 20

/** The same fault on every record is one finding, not a hundred lines. */
function groupIssues(issues: Issue[]): string[] {
  const groups = new Map<string, { count: number; first: Issue }>()
  for (const issue of issues) {
    const key = `${issue.path.replace(/\.\d+(?=\.|$)/g, '.*')} ${issue.code}`
    const group = groups.get(key)
    if (group) group.count += 1
    else groups.set(key, { count: 1, first: issue })
  }
  return [...groups.entries()].map(([key, { count, first }]) =>
    count === 1 ? `${first.path} ${first.code}` : `${key} x${count} (first: ${first.path})`,
  )
}

/**
 * The only text a failed run prints. It carries the step, the error class and structural
 * detail, never an error message, a query string, a body or a record value.
 */
export function formatReport(input: {
  task: string
  env: string
  code: number
  kind: string
  step: string
  logPath?: string
  issues?: Issue[]
  violations: Violation[]
  message?: string
}): string {
  const lines = [`crawl ${input.task} [${input.env}] FAILED exit=${input.code}`, `step: ${input.step}`, `error: ${input.kind}`]
  if (input.message) lines.push(`message: ${input.message}`)
  const issues = groupIssues(input.issues ?? [])
  for (const issue of issues.slice(0, MAX_ISSUES)) lines.push(`issue: ${issue}`)
  if (issues.length > MAX_ISSUES) lines.push(`not shown: ${issues.length - MAX_ISSUES} more issue(s)`)
  for (const v of input.violations.slice(0, MAX_ISSUES)) lines.push(`blocked: ${v.method} ${v.origin}${v.pathname} (${v.reason})`)
  if (input.violations.length > MAX_ISSUES) lines.push(`not shown: ${input.violations.length - MAX_ISSUES} more blocked request(s)`)
  const hint = HINTS[input.code]
  if (hint && input.kind !== 'UsageError') lines.push(`next: ${hint(input.task)}`)
  if (input.logPath) lines.push(`log: ${input.logPath}`)
  return lines.join('\n')
}

/** Full detail, including Playwright messages and call logs. Lands in out/logs, which the agent may not read. */
export function writeLog(dir: string, name: string, error: unknown, violations: Violation[]): string {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const file = path.join(dir, `${name}.log`)
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error)
  const body = [detail, '', 'violations:', JSON.stringify(violations, null, 2), ''].join('\n')
  fs.writeFileSync(file, body, { mode: 0o600 })
  return file
}

const AGENT_VARS = ['CLAUDECODE', 'CURSOR_AGENT', 'AE_AGENT']

export function isAgentShell(processEnv: NodeJS.ProcessEnv | Record<string, string | undefined>): boolean {
  return AGENT_VARS.some((name) => Boolean(processEnv[name]))
}

export function checkAgentAllowed(
  env: EnvConfig,
  envName: string,
  processEnv: NodeJS.ProcessEnv | Record<string, string | undefined>,
): void {
  if (env.agentAllowed || !isAgentShell(processEnv)) return
  throw new UsageError(`env "${envName}" is not approved for agents (agentAllowed: false). A person has to run this.`)
}
