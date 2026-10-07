import { UsageError } from './exit.ts'
import type { EnvConfig, TaskConfig, TaskConfigInput } from './types.ts'

export const DEFAULT_BLOCK_URL = /logout|signout/i
export const DEFAULT_LOGIN_INPUT = 'input[type=email], input[type=password], input[name=username], input[name=loginfmt]'

export const DEFAULTS = {
  minRecords: 1,
  maxPages: 20,
  minDelayMs: 1000,
  timeoutMs: 120_000,
}

const unique = <T>(items: T[], key: (item: T) => string = String) => [...new Map(items.map((item) => [key(item), item])).values()]

function resolveEnv(name: string, input: TaskConfigInput['envs'][string]): EnvConfig {
  let origin: string
  try {
    origin = new URL(input.startUrl).origin
  } catch {
    throw new UsageError(`env "${name}" needs a valid startUrl`)
  }
  return {
    startUrl: input.startUrl,
    // The start page's own origin is always app: its writes are judged by the allowlist, never let through.
    appOrigins: unique([origin, ...(input.appOrigins ?? [])]),
    idpOrigins: input.idpOrigins ?? [],
    dropOrigins: input.dropOrigins ?? [],
    agentAllowed: input.agentAllowed ?? false,
  }
}

/** Fills a task's partial config with defaults. Every default keeps the guard at least as strict. */
export function resolveConfig(input: TaskConfigInput): TaskConfig {
  if (typeof input.site !== 'string' || input.site === '') throw new UsageError('task config needs a site')
  const envNames = Object.keys(input.envs ?? {})
  if (envNames.length === 0) throw new UsageError('task config needs at least one env')

  return {
    site: input.site,
    envs: Object.fromEntries(envNames.map((name) => [name, resolveEnv(name, input.envs[name]!)])),
    writeAllowlist: input.writeAllowlist ?? [],
    blockUrls: unique([DEFAULT_BLOCK_URL, ...(input.blockUrls ?? [])]),
    allowWebSocket: input.allowWebSocket ?? [],
    minRecords: input.minRecords ?? DEFAULTS.minRecords,
    uniqueKey: input.uniqueKey,
    maxPages: input.maxPages ?? DEFAULTS.maxPages,
    rate: { minDelayMs: input.rate?.minDelayMs ?? DEFAULTS.minDelayMs },
    session: { ...input.session, loginInput: input.session?.loginInput ?? DEFAULT_LOGIN_INPUT },
    timeoutMs: input.timeoutMs ?? DEFAULTS.timeoutMs,
    locale: input.locale,
  }
}
