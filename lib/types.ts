import type { Page } from 'playwright'
import type { Api } from './guard.ts'

export type EnvConfig = {
  startUrl: string
  /** App and its API origins: writes outside the allowlist are aborted and give exit 4. */
  appOrigins: string[]
  /** Identity provider origins: every method passes (token endpoints use POST). */
  idpOrigins: string[]
  /** Telemetry origins: writes are aborted silently. */
  dropOrigins: string[]
  /** May an agent (Claude Code, Cursor) run a crawl against this env? */
  agentAllowed: boolean
}

export type GraphqlRule = { operationName: string } | { sha256Hash: string }

export type WriteRule = {
  method: string
  /** string: exact match on origin + pathname. RegExp: tested against the full URL. */
  url: string | RegExp
  graphql?: GraphqlRule
}

export type TaskConfig = {
  site: string
  envs: Record<string, EnvConfig>
  writeAllowlist: WriteRule[]
  /** GETs with side effects (logout, export triggers). Tested against origin + pathname. */
  blockUrls: RegExp[]
  allowWebSocket: (string | RegExp)[]
  minRecords: number
  uniqueKey?: string
  maxPages: number
  rate: { minDelayMs: number }
  session: {
    /** Login page of the app itself, when it has no separate IdP origin. */
    loginUrl?: string | RegExp
    /** Selector for the login field or account picker. */
    loginInput: string
    /** How long an SSO redirect may take before the page counts as stuck on login. */
    timeoutMs?: number
  }
  timeoutMs: number
  locale?: string
}

/**
 * What a task file writes. Only `site` and each env's `startUrl` are required; `resolveConfig()`
 * fills the rest with defaults that never loosen the guard.
 */
export type EnvConfigInput = Pick<EnvConfig, 'startUrl'> & Partial<EnvConfig>

export type TaskConfigInput = Pick<TaskConfig, 'site'> &
  Partial<Omit<TaskConfig, 'site' | 'envs' | 'session'>> & {
    envs: Record<string, EnvConfigInput>
    session?: Partial<TaskConfig['session']>
  }

export type TaskContext = {
  page: Page
  api: Api
  params: Record<string, string>
  env: EnvConfig
  /** Name the current step for error reports. Static text only, never data. */
  step(name: string): void
  /** Call once per page fetched. Throws once the run goes past maxPages. */
  nextPage(): number
}

export type TaskModule = {
  config: TaskConfig
  run(ctx: TaskContext): Promise<unknown[]>
}
