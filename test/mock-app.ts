// A fake app, IdP, second API, telemetry host and an undeclared host, all on one port and told apart
// by hostname. Separate hostnames matter: cookies ignore the port, so `localhost:4000` and
// `localhost:4001` would share a cookie jar and the SSO flow would not behave like a real one.
import http from 'node:http'
import { randomUUID } from 'node:crypto'

export const MOCK_PORT = 4610
export const mockOrigin = (name: 'app' | 'idp' | 'api' | 'telemetry' | 'other') => `http://${name}.localhost:${MOCK_PORT}`

export const SECRET = 'SECRET-VALUE-8841'
const PAGE_SIZE = 4

export type MockState = {
  cookieMode: 'persistent' | 'session'
  appSessions: Set<string>
  idpSessions: Set<string>
  tickets: Set<string>
  apiStatus: 200 | 401 | 403
  apiRedirectToIdp: boolean
  totalPages: number
  duplicateIds: boolean
  badField: boolean
  /** Every non-GET request that reached the server, plus GET /logout. */
  writes: { host: string; method: string; path: string }[]
  reads: { host: string; method: string; path: string }[]
  upgrades: number
}

const freshState = (): MockState => ({
  cookieMode: 'persistent',
  appSessions: new Set(),
  idpSessions: new Set(),
  tickets: new Set(),
  apiStatus: 200,
  apiRedirectToIdp: false,
  totalPages: 3,
  duplicateIds: false,
  badField: false,
  writes: [],
  reads: [],
  upgrades: 0,
})

function cookieOf(req: http.IncomingMessage, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [key, value] = part.trim().split('=')
    if (key === name) return value
  }
  return undefined
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => resolve(body))
  })
}

const html = (body: string) => `<!doctype html><html><head><meta charset="utf-8"><title>mock</title></head><body>${body}</body></html>`

const APP_PAGE = html(`
  <h1>Items</h1>
  <div id="secret">${SECRET}</div>
  <ul id="items"></ul>
  <script>
    fetch('/api/items?page=1').then((r) => r.json()).then((data) => {
      for (const item of data.items) {
        const li = document.createElement('li')
        li.textContent = item.title
        document.getElementById('items').append(li)
      }
    }).catch(() => {})
  </script>`)

export async function startMockApp(port = MOCK_PORT) {
  let state = freshState()

  const server = http.createServer(async (req, res) => {
    const host = (req.headers.host ?? '').split(':')[0]!.replace('.localhost', '')
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
    const method = req.method ?? 'GET'
    const entry = { host, method, path: url.pathname }
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') state.reads.push(entry)
    else state.writes.push(entry)

    const send = (status: number, type: string, body = '', headers: Record<string, string | string[]> = {}) => {
      res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...headers })
      res.end(body)
    }
    const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
      send(status, 'application/json', JSON.stringify(body), headers)
    const redirect = (location: string, headers: Record<string, string | string[]> = {}) => send(302, 'text/plain', '', { location, ...headers })
    const sessionCookie = (name: string, value: string) =>
      `${name}=${value}; Path=/; HttpOnly${state.cookieMode === 'persistent' ? '; Max-Age=86400' : ''}`
    const authorize = `${mockOrigin('idp')}/authorize?return=${encodeURIComponent(`${mockOrigin('app')}/callback`)}`

    if (host === 'idp') {
      if (method === 'GET' && url.pathname === '/authorize') {
        const back = url.searchParams.get('return') ?? `${mockOrigin('app')}/callback`
        if (state.idpSessions.has(cookieOf(req, 'idp_sess') ?? '')) {
          // A live IdP session renews the app session without asking: the page redirects back by itself.
          const ticket = randomUUID()
          state.tickets.add(ticket)
          return send(200, 'text/html', html(`<p>Signing you in…</p><script>setTimeout(() => { location.href = ${JSON.stringify(`${back}?ticket=${ticket}`)} }, 300)</script>`))
        }
        return send(
          200,
          'text/html',
          html(`<h1>Sign in</h1><form method="post" action="/login">
            <input type="hidden" name="return" value="${back}">
            <label>Username <input name="username"></label>
            <button type="submit">Sign in</button></form>`),
        )
      }
      if (method === 'POST' && url.pathname === '/login') {
        const form = new URLSearchParams(await readBody(req))
        const sid = randomUUID()
        const ticket = randomUUID()
        state.idpSessions.add(sid)
        state.tickets.add(ticket)
        return redirect(`${form.get('return')}?ticket=${ticket}`, { 'set-cookie': sessionCookie('idp_sess', sid) })
      }
      if (method === 'POST' && url.pathname === '/token') return json(200, { ok: true })
    }

    if (host === 'app') {
      const signedIn = state.appSessions.has(cookieOf(req, 'app_sess') ?? '')
      if (method === 'GET' && url.pathname === '/callback') {
        const ticket = url.searchParams.get('ticket') ?? ''
        if (!state.tickets.delete(ticket)) return send(403, 'text/plain', 'bad ticket')
        const sid = randomUUID()
        state.appSessions.add(sid)
        return redirect('/', { 'set-cookie': sessionCookie('app_sess', sid) })
      }
      if (method === 'GET' && url.pathname === '/') return signedIn ? send(200, 'text/html', APP_PAGE) : redirect(authorize)
      if (method === 'GET' && url.pathname === '/logout') {
        state.writes.push(entry)
        state.appSessions.clear()
        return send(200, 'text/html', html('<p>Signed out</p>'))
      }
      if (url.pathname === '/api/items') {
        if (method !== 'GET') return json(200, { saved: true })
        if (state.apiRedirectToIdp) return redirect(authorize)
        if (state.apiStatus !== 200) return json(state.apiStatus, { error: 'denied' })
        if (!signedIn) return json(401, { error: 'unauthenticated' })
        const page = Number(url.searchParams.get('page') ?? 1)
        const items = Array.from({ length: page <= state.totalPages ? PAGE_SIZE : 0 }, (_, i) => {
          const n = (page - 1) * PAGE_SIZE + i + 1
          return {
            id: state.duplicateIds ? 'ITEM-1' : `ITEM-${n}`,
            title: state.badField ? n : `Item-Title-${n}`,
            owner: `Owner-${n}`,
            internal: `INTERNAL-${n}`,
          }
        })
        return json(200, { items, hasNext: page < state.totalPages })
      }
    }

    if (host === 'api') {
      const cors = {
        'access-control-allow-origin': mockOrigin('app'),
        'access-control-allow-headers': 'x-custom',
        'access-control-allow-methods': 'GET, POST',
      }
      if (method === 'OPTIONS') return send(204, 'text/plain', '', cors)
      if (method === 'GET' && url.pathname === '/data') return json(200, { ok: true }, cors)
      if (method === 'POST') return json(200, { ok: true }, cors)
    }

    if ((host === 'telemetry' || host === 'other') && method === 'POST') return json(200, { ok: true })

    return send(404, 'text/plain', 'not found')
  })

  server.on('upgrade', (_req, socket) => {
    state.upgrades += 1
    socket.destroy()
  })

  // `*.localhost` resolves to ::1 in Node and to 127.0.0.1 in Chromium, so listen on both.
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '::', () => resolve())
  })

  return {
    get state() {
      return state
    },
    reset() {
      state = freshState()
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}

// `tsx test/mock-app.ts` runs it standalone, to poke at it from a browser.
if (import.meta.main) {
  await startMockApp()
  console.log(`mock app on ${mockOrigin('app')}/`)
}
