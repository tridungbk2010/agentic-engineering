// Hand-written task against test/mock-app.ts. It exists to exercise auth, session expiry and the guard
// (plan Phase 3b); `--action=...` makes it attempt one specific thing before the normal crawl.
import type { TaskConfig, TaskContext } from '../../lib/types.ts'

const PORT = 4610
const origin = (name: string) => `http://${name}.localhost:${PORT}`

const local = {
  startUrl: `${origin('app')}/`,
  appOrigins: [origin('app'), origin('api')],
  idpOrigins: [origin('idp')],
  dropOrigins: [origin('telemetry')],
}

export const config: TaskConfig = {
  site: 'mock',
  envs: {
    local: { ...local, agentAllowed: true },
    // Same target, but marked as off limits to agents, to exercise that check.
    restricted: { ...local, agentAllowed: false },
  },
  writeAllowlist: [{ method: 'POST', url: `${origin('api')}/search` }],
  blockUrls: [/logout|signout/i],
  allowWebSocket: [],
  minRecords: 1,
  uniqueKey: 'id',
  maxPages: 5,
  rate: { minDelayMs: 0 },
  session: { loginInput: 'input[name=username]', timeoutMs: 2000 },
  timeoutMs: 30_000,
}

type ItemsPage = { items: unknown[]; hasNext: boolean }

export async function run({ page, api, params, step, nextPage }: TaskContext): Promise<unknown[]> {
  // Runs inside the page, so it passes through context.route like any request the app makes.
  const inPage = (url: string, init: { method?: string; mode?: 'no-cors'; body?: string; headers?: Record<string, string> } = {}) =>
    page.evaluate(([u, i]) => fetch(u, i).then((r) => r.status, () => 'failed'), [url, init] as const)

  step('action')
  switch (params.action) {
    case 'post-app':
      await inPage('/api/items', { method: 'POST', body: '{}' })
      break
    case 'post-other':
      await inPage(`${origin('other')}/write`, { method: 'POST', mode: 'no-cors', body: 'x' })
      break
    case 'post-idp':
      await inPage(`${origin('idp')}/token`, { method: 'POST', mode: 'no-cors', body: 'x' })
      break
    case 'post-telemetry':
      await inPage(`${origin('telemetry')}/beacon`, { method: 'POST', mode: 'no-cors', body: 'x' })
      break
    case 'post-allowlisted':
      await inPage(`${origin('api')}/search`, { method: 'POST', mode: 'no-cors', body: 'x' })
      break
    case 'preflight':
      await inPage(`${origin('api')}/data`, { headers: { 'x-custom': '1' } })
      break
    case 'api-post':
      await api.fetch('/api/items', { method: 'POST', data: {} })
      break
    case 'logout':
      await page.goto(`${origin('app')}/logout`)
      break
    case 'websocket': {
      const code = await page.evaluate(
        () =>
          new Promise<number>((resolve) => {
            const ws = new WebSocket('ws://app.localhost:4610/hub')
            ws.onclose = (event) => resolve(event.code)
          }),
      )
      if (code !== 1008) throw new Error('websocket was not closed by the guard')
      break
    }
    case 'leak-timeout':
      // Times out with the element's HTML in Playwright's call log: the kind of error that must not reach stdout.
      await page.locator('#secret').waitFor({ state: 'hidden', timeout: 500 })
      break
  }

  step('items')
  const records: unknown[] = []
  for (let hasNext = true; hasNext; ) {
    const data = await api.json<ItemsPage>(`/api/items?page=${nextPage()}`)
    records.push(...data.items)
    hasNext = data.hasNext
  }
  if (params.action === 'post-app-late') {
    // Fired and not awaited as the very last thing: the guard judges it after run() has returned.
    await page.evaluate(() => {
      void fetch('/api/items', { method: 'POST', body: '{}' }).catch(() => {})
    })
  }
  return records
}
