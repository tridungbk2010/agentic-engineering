import { Kind, parse, type OperationDefinitionNode } from 'graphql'
import type { APIResponse, BrowserContext } from 'playwright'
import { GuardError, HttpError, SessionExpiredError, type Violation } from './exit.ts'
import { classifyApiResponse } from './session.ts'
import type { EnvConfig, GraphqlRule, TaskConfig } from './types.ts'

export type GuardRequest = { method: string; url: string; postData?: string | null; resourceType?: string }
export type BlockReason = 'blocked-url' | 'undeclared-origin' | 'write-not-allowlisted' | 'graphql-not-allowlisted'
export type Verdict = { action: 'allow' } | { action: 'drop' } | { action: 'block'; reason: BlockReason }

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
// blockUrls is about requests that act on the server, not about a script or image with "logout" in its name.
const ACTING_RESOURCE_TYPES = new Set(['document', 'xhr', 'fetch'])

/** Default-deny: anything that is not a safe method needs an explicit reason to pass. */
export function classify(request: GuardRequest, env: EnvConfig, config: TaskConfig): Verdict {
  let url: URL
  try {
    url = new URL(request.url)
  } catch {
    return { action: 'block', reason: 'undeclared-origin' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { action: 'allow' }

  const target = url.origin + url.pathname
  const acts = request.resourceType === undefined || ACTING_RESOURCE_TYPES.has(request.resourceType)
  if (acts && config.blockUrls.some((pattern) => pattern.test(target))) return { action: 'block', reason: 'blocked-url' }

  const method = request.method.toUpperCase()
  if (SAFE_METHODS.has(method)) return { action: 'allow' }

  if (env.idpOrigins.includes(url.origin)) return { action: 'allow' }
  if (env.dropOrigins.includes(url.origin)) return { action: 'drop' }
  if (!env.appOrigins.includes(url.origin)) return { action: 'block', reason: 'undeclared-origin' }

  const rules = config.writeAllowlist.filter(
    (rule) => rule.method.toUpperCase() === method && (typeof rule.url === 'string' ? rule.url === target : rule.url.test(url.href)),
  )
  if (rules.length === 0) return { action: 'block', reason: 'write-not-allowlisted' }
  if (rules.some((rule) => rule.graphql === undefined)) return { action: 'allow' }

  const graphqlRules = rules.flatMap((rule) => (rule.graphql ? [rule.graphql] : []))
  return graphqlAllowed(request.postData, graphqlRules) ? { action: 'allow' } : { action: 'block', reason: 'graphql-not-allowlisted' }
}

function graphqlAllowed(postData: string | null | undefined, rules: GraphqlRule[]): boolean {
  if (!postData) return false
  let body: unknown
  try {
    body = JSON.parse(postData)
  } catch {
    return false
  }
  // A batch is an array: one mutation among allowed queries must still block the request.
  const items = Array.isArray(body) ? body : [body]
  return items.length > 0 && items.every((item) => graphqlItemAllowed(item, rules))
}

function graphqlItemAllowed(item: unknown, rules: GraphqlRule[]): boolean {
  if (item === null || typeof item !== 'object') return false
  const { query, operationName, extensions } = item as {
    query?: unknown
    operationName?: unknown
    extensions?: { persistedQuery?: { sha256Hash?: unknown } }
  }

  if (typeof query === 'string') {
    // operationName comes from the client, so the type and name are read from the document itself.
    let operations: OperationDefinitionNode[]
    try {
      operations = parse(query).definitions.filter((d): d is OperationDefinitionNode => d.kind === Kind.OPERATION_DEFINITION)
    } catch {
      return false
    }
    const operation =
      typeof operationName === 'string' && operationName !== ''
        ? operations.find((op) => op.name?.value === operationName)
        : operations.length === 1
          ? operations[0]
          : undefined
    if (!operation || operation.operation !== 'query') return false
    const name = operation.name?.value
    return name !== undefined && rules.some((rule) => 'operationName' in rule && rule.operationName === name)
  }

  const hash = extensions?.persistedQuery?.sha256Hash
  if (typeof hash === 'string') return rules.some((rule) => 'sha256Hash' in rule && rule.sha256Hash === hash)
  return false
}

export function wsAllowed(url: string, config: TaskConfig): boolean {
  let target: string
  try {
    const parsed = new URL(url)
    target = parsed.origin + parsed.pathname
  } catch {
    return false
  }
  return config.allowWebSocket.some((rule) => (typeof rule === 'string' ? rule === target : rule.test(url)))
}

export class GuardState {
  violations: Violation[] = []
  /** When the guard last judged a request from the page. */
  lastSeen = 0

  /**
   * Waits until the page has been quiet for a moment. A write the task fired without awaiting it is
   * still on its way to the guard when run() returns; without this it would be neither sent nor reported.
   */
  async settle(quietMs = 250, maxMs = 3000): Promise<void> {
    const start = Date.now()
    while (Date.now() - Math.max(this.lastSeen, start) < quietMs && Date.now() - start < maxMs) await sleep(50)
  }

  record(method: string, url: string, reason: string): void {
    let origin = 'invalid-url'
    let pathname = ''
    try {
      ;({ origin, pathname } = new URL(url))
    } catch {
      // keep the placeholder: the raw string could hold anything
    }
    this.violations.push({ method: method.toUpperCase(), origin, pathname, reason })
  }
}

export async function installGuard(context: BrowserContext, env: EnvConfig, config: TaskConfig, state: GuardState): Promise<void> {
  await context.route('**/*', async (route) => {
    const request = route.request()
    state.lastSeen = Date.now()
    const verdict = classify(
      { method: request.method(), url: request.url(), postData: request.postData(), resourceType: request.resourceType() },
      env,
      config,
    )
    if (verdict.action === 'block') state.record(request.method(), request.url(), verdict.reason)
    // Both calls reject if the page went away meanwhile (the browser closing mid-request); nothing is left to decide then.
    const settled = verdict.action === 'allow' ? route.continue() : route.abort('blockedbyclient')
    await settled.catch(() => {})
  })

  // context.route never sees WebSockets, and the guard cannot judge frames, so sockets are closed unless allowlisted.
  await context.routeWebSocket(/.*/, (ws) => {
    if (wsAllowed(ws.url(), config)) ws.connectToServer()
    else void ws.close({ code: 1008, reason: 'blocked by guard' })
  })
}

export type ApiInit = { method?: string; headers?: Record<string, string>; data?: unknown }

export type Api = {
  /** Guarded and throttled request through the browser's cookie jar. Throws on 401 or a bounce to login. */
  fetch(url: string, init?: ApiInit): Promise<APIResponse>
  /** Same, and also requires a JSON response with a 2xx status. */
  json<T = unknown>(url: string, init?: ApiInit): Promise<T>
}

const RETRY_STATUS = new Set([429, 503])
const MAX_RETRIES = 3
const MAX_BACKOFF_MS = 60_000

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * context.request does not pass through context.route, so tasks get this wrapper instead:
 * the same classify() decides, and requests are spaced out by config.rate.
 */
export function createApi(context: BrowserContext, env: EnvConfig, config: TaskConfig, state: GuardState): Api {
  let nextSlot = 0

  async function send(url: string, init: ApiInit, expectJson: boolean): Promise<APIResponse> {
    const target = new URL(url, env.startUrl).href
    const method = (init.method ?? 'GET').toUpperCase()
    const postData = init.data === undefined ? undefined : typeof init.data === 'string' ? init.data : JSON.stringify(init.data)

    const verdict = classify({ method, url: target, postData }, env, config)
    if (verdict.action !== 'allow') {
      const reason = verdict.action === 'block' ? verdict.reason : 'drop-origin'
      state.record(method, target, reason)
      throw new GuardError(`guard refused ${method} (${reason})`)
    }

    for (let attempt = 0; ; attempt++) {
      const wait = nextSlot - Date.now()
      if (wait > 0) await sleep(wait)
      nextSlot = Date.now() + config.rate.minDelayMs

      const response = await context.request.fetch(target, { method, headers: init.headers, data: init.data })

      if (RETRY_STATUS.has(response.status()) && attempt < MAX_RETRIES) {
        const retryAfter = Number(response.headers()['retry-after'])
        const backoff = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : Math.max(config.rate.minDelayMs, 1000) * 2 ** attempt
        await response.dispose()
        nextSlot = Date.now() + Math.min(backoff, MAX_BACKOFF_MS)
        continue
      }

      const outcome = classifyApiResponse(
        { status: response.status(), finalUrl: response.url(), contentType: response.headers()['content-type'] ?? '', expectJson },
        env,
        config.session,
      )
      if (outcome === 'session-expired') throw new SessionExpiredError()
      if (outcome === 'http-error' && expectJson) throw new HttpError(response.status())
      return response
    }
  }

  return {
    fetch: (url, init = {}) => send(url, init, false),
    json: async <T>(url: string, init: ApiInit = {}) => (await (await send(url, init, true)).json()) as T,
  }
}
