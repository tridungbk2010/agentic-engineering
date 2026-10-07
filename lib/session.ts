import type { Page } from 'playwright'
import { SessionExpiredError } from './exit.ts'
import type { EnvConfig, TaskConfig } from './types.ts'

type Session = TaskConfig['session']

const DEFAULT_SSO_TIMEOUT_MS = 15_000

export function isLoginUrl(url: string, env: EnvConfig, session: Session): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (env.idpOrigins.includes(parsed.origin)) return true
  const { loginUrl } = session
  if (loginUrl === undefined) return false
  if (typeof loginUrl === 'string') return loginUrl === parsed.origin + parsed.pathname
  return loginUrl.test(parsed.href)
}

export function classifyApiResponse(
  response: { status: number; finalUrl: string; contentType: string; expectJson: boolean },
  env: EnvConfig,
  session: Session,
): 'ok' | 'session-expired' | 'http-error' {
  if (response.status === 401) return 'session-expired'
  // A redirect followed to the IdP or the login page means the API bounced us to sign in.
  if (isLoginUrl(response.finalUrl, env, session)) return 'session-expired'
  if (response.status >= 400) return 'http-error'
  // A 200 with HTML where JSON belongs is how many apps serve their login page to an API call.
  if (response.expectJson && !/json/i.test(response.contentType)) return 'session-expired'
  return 'ok'
}

/**
 * A redirect to the IdP that comes back by itself is SSO renewing the session. Only a page that is
 * still on the login URL after the timeout, and is asking for input, counts as an expired session.
 */
export async function ensureSession(page: Page, env: EnvConfig, session: Session): Promise<void> {
  if (!isLoginUrl(page.url(), env, session)) return
  const timeout = session.timeoutMs ?? DEFAULT_SSO_TIMEOUT_MS
  try {
    await page.waitForURL((url) => !isLoginUrl(url.href, env, session), { timeout, waitUntil: 'commit' })
    return
  } catch {
    // still on the login URL: decide below whether it is waiting for a person
  }
  const asksForInput = await page
    .locator(session.loginInput)
    .first()
    .isVisible()
    .catch(() => false)
  if (asksForInput) throw new SessionExpiredError()
  throw new Error('still on the login URL after the SSO timeout, with no login prompt')
}
