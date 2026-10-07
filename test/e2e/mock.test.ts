// Plan Phase 3b: the real runner as a subprocess, against test/mock-app.ts.
import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '../..')
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-e2e-'))
// Never touch the real profile dir or out/ from a test.
process.env.AUTH_DIR = path.join(tmpRoot, 'auth')
process.env.AE_BROWSER_CHANNEL ??= 'chrome'

const { launch } = await import('../../lib/browser.ts')
const { SECRET, mockOrigin, startMockApp } = await import('../mock-app.ts')

const APP = mockOrigin('app')
let mock: Awaited<ReturnType<typeof startMockApp>>
let outDir = ''
let runCount = 0

type Result = { code: number; out: string }

function runScript(script: string, args: string[], env: Record<string, string | undefined> = {}): Promise<Result> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ['--import', 'tsx', script, ...args],
      { cwd: ROOT, env: { ...process.env, AE_OUT_DIR: outDir, ...env }, encoding: 'utf8' },
      (error, stdout, stderr) => resolve({ code: error ? Number(error.code ?? 1) : 0, out: stdout + stderr }),
    )
  })
}

const crawl = (args: string[] = [], env: Record<string, string | undefined> = {}) =>
  runScript('automations/run.ts', ['mock', '--env', 'local', ...args], env)

async function signIn(): Promise<void> {
  const context = await launch({ site: 'mock', envName: 'local' })
  const page = context.pages()[0] ?? (await context.newPage())
  await page.goto(`${APP}/`)
  await page.getByLabel('Username').fill('tester')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(`${APP}/`)
  await context.close()
}

const rawFiles = () => {
  const dir = path.join(outDir, 'raw', 'mock')
  return fs.existsSync(dir) ? fs.readdirSync(dir) : []
}
const logText = () => {
  const dir = path.join(outDir, 'logs')
  return fs.existsSync(dir) ? fs.readdirSync(dir).map((name) => fs.readFileSync(path.join(dir, name), 'utf8')).join('\n') : ''
}
const wrote = (host: string, pathname: string) => mock.state.writes.some((w) => w.host === host && w.path === pathname)

/** What a failed run may never print: page HTML, a query string, or a value from a record. */
function assertNoData(out: string): void {
  assert.ok(!out.includes(SECRET), 'page content leaked')
  assert.ok(!/Item-Title-|Owner-\d|INTERNAL-/.test(out), 'record value leaked')
  assert.ok(!out.includes('<'), 'HTML leaked')
  assert.ok(!out.includes('?page='), 'query string leaked')
}

function assertFailed(result: Result, code: number, kind: string): void {
  assert.equal(result.code, code, result.out)
  assert.match(result.out, new RegExp(`exit=${code}`))
  assert.match(result.out, new RegExp(`error: ${kind}`))
  assertNoData(result.out)
  assert.deepEqual(rawFiles(), [], 'a failed run must not leave an output file')
}

before(async () => {
  mock = await startMockApp()
})
after(async () => {
  await mock.close()
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})
beforeEach(() => {
  mock.reset()
  fs.rmSync(process.env.AUTH_DIR!, { recursive: true, force: true })
  outDir = path.join(tmpRoot, `out-${++runCount}`)
})

test('signed in: headless crawl exits 0 and writes validated, owner-only output', async () => {
  await signIn()
  const result = await crawl()
  assert.equal(result.code, 0, result.out)
  assert.match(result.out, /crawl mock \[local\] OK records=12 file=/)
  assertNoData(result.out)

  const [name, ...rest] = rawFiles()
  assert.ok(name && rest.length === 0, 'exactly one output file')
  const file = path.join(outDir, 'raw', 'mock', name)
  assert.equal(fs.statSync(file).mode & 0o777, 0o600)
  const body = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.equal(body.meta.recordCount, 12)
  assert.equal(body.meta.env, 'local')
  assert.deepEqual(body.records[0], { id: 'ITEM-1', title: 'Item-Title-1', owner: 'Owner-1' })
  assert.equal(fs.statSync(process.env.AUTH_DIR!).mode & 0o777, 0o700)
})

test('analyze reads the JSON and writes an aggregate report', async () => {
  await signIn()
  assert.equal((await crawl()).code, 0)
  const result = await runScript('analysis/run.ts', ['mock'])
  assert.equal(result.code, 0, result.out)
  assert.match(result.out, /analyze mock OK records=12/)
  const dir = path.join(outDir, 'reports', 'mock')
  const report = JSON.parse(fs.readFileSync(path.join(dir, fs.readdirSync(dir)[0]!), 'utf8'))
  assert.deepEqual(report.report.total, 12)
})

test('exit 2: never signed in, the IdP shows its login form', async () => {
  const result = await crawl()
  assertFailed(result, 2, 'SessionExpiredError')
  assert.match(result.out, /step: session/)
  assert.match(result.out, /pnpm signin mock/)
})

test('exit 2: both sessions gone on the server', async () => {
  await signIn()
  mock.state.appSessions.clear()
  mock.state.idpSessions.clear()
  assertFailed(await crawl(), 2, 'SessionExpiredError')
})

test('not exit 2: app session gone but the IdP renews it by redirecting back', async () => {
  await signIn()
  mock.state.appSessions.clear()
  const result = await crawl()
  assert.equal(result.code, 0, result.out)
  assert.match(result.out, /OK records=12/)
})

test('exit 2: the API answers 401', async () => {
  await signIn()
  mock.state.apiStatus = 401
  assertFailed(await crawl(), 2, 'SessionExpiredError')
})

test('exit 2: the API bounces to the IdP instead of answering', async () => {
  await signIn()
  mock.state.apiRedirectToIdp = true
  assertFailed(await crawl(), 2, 'SessionExpiredError')
})

test('exit 1, not 2: the API answers 403', async () => {
  await signIn()
  mock.state.apiStatus = 403
  assertFailed(await crawl(), 1, 'HttpError')
})

test('exit 2: session-only cookies do not survive closing the browser', async () => {
  mock.state.cookieMode = 'session'
  await signIn()
  assertFailed(await crawl(), 2, 'SessionExpiredError')
})

test('exit 4: POST to the app origin is aborted before it reaches the server', async () => {
  await signIn()
  const result = await crawl(['--action=post-app'])
  assertFailed(result, 4, 'GuardError')
  assert.match(result.out, /blocked: POST http:\/\/app\.localhost:4610\/api\/items \(write-not-allowlisted\)/)
  assert.equal(wrote('app', '/api/items'), false)
})

test('exit 4: POST to an origin nobody declared', async () => {
  await signIn()
  const result = await crawl(['--action=post-other'])
  assertFailed(result, 4, 'GuardError')
  assert.match(result.out, /blocked: POST http:\/\/other\.localhost:4610\/write \(undeclared-origin\)/)
  assert.equal(wrote('other', '/write'), false)
})

test('exit 4: a write through the api helper is refused the same way', async () => {
  await signIn()
  assertFailed(await crawl(['--action=api-post']), 4, 'GuardError')
  assert.equal(wrote('app', '/api/items'), false)
})

test('exit 4: a GET on a blockUrls address (logout) is aborted', async () => {
  await signIn()
  const result = await crawl(['--action=logout'])
  assertFailed(result, 4, 'GuardError')
  assert.match(result.out, /\(blocked-url\)/)
  assert.equal(wrote('app', '/logout'), false)
})

test('exit 4: a write blocked after the task has returned still leaves no output file', async () => {
  await signIn()
  const result = await crawl(['--action=post-app-late'])
  assertFailed(result, 4, 'GuardError')
  assert.equal(wrote('app', '/api/items'), false)
})

test('exit 4 outranks a schema failure in the same run', async () => {
  await signIn()
  mock.state.badField = true
  assertFailed(await crawl(['--action=post-app']), 4, 'GuardError')
})

test('not exit 4: POST to the IdP passes', async () => {
  await signIn()
  const result = await crawl(['--action=post-idp'])
  assert.equal(result.code, 0, result.out)
  assert.equal(wrote('idp', '/token'), true)
})

test('not exit 4: POST to telemetry is dropped silently', async () => {
  await signIn()
  const result = await crawl(['--action=post-telemetry'])
  assert.equal(result.code, 0, result.out)
  assert.equal(wrote('telemetry', '/beacon'), false)
})

test('not exit 4: an allowlisted POST passes', async () => {
  await signIn()
  const result = await crawl(['--action=post-allowlisted'])
  assert.equal(result.code, 0, result.out)
  assert.equal(wrote('api', '/search'), true)
})

test('not exit 4: a CORS preflight (OPTIONS) and the GET behind it pass', async () => {
  await signIn()
  const result = await crawl(['--action=preflight'])
  assert.equal(result.code, 0, result.out)
  assert.ok(mock.state.reads.some((r) => r.host === 'api' && r.method === 'GET' && r.path === '/data'))
})

test('a WebSocket is closed by the guard and never reaches the server', async () => {
  await signIn()
  const result = await crawl(['--action=websocket'])
  assert.equal(result.code, 0, result.out)
  assert.equal(mock.state.upgrades, 0)
})

test('exit 1: the profile is open in another process', async () => {
  await signIn()
  const holder = await launch({ site: 'mock', envName: 'local' })
  try {
    const result = await crawl()
    assertFailed(result, 1, 'ProfileLockedError')
    assert.match(result.out, /step: launch/)
  } finally {
    await holder.close()
  }
})

test('a Playwright timeout prints no page content; the detail goes to an owner-only log', async () => {
  await signIn()
  const result = await crawl(['--action=leak-timeout'])
  assertFailed(result, 1, 'TimeoutError')
  assert.match(result.out, /log: .*logs\/mock-.*\.log/)
  // The log proves the error really carried page content, which is why stdout must not print it.
  assert.ok(logText().includes(SECRET))
  const dir = path.join(outDir, 'logs')
  assert.equal(fs.statSync(path.join(dir, fs.readdirSync(dir)[0]!)).mode & 0o777, 0o600)
})

test('exit 3: a field has the wrong type; the report gives path and code only', async () => {
  await signIn()
  mock.state.badField = true
  const result = await crawl()
  assertFailed(result, 3, 'ValidationError')
  assert.match(result.out, /issue: records\.\*\.title invalid_type x12 \(first: records\.0\.title\)/)
  assert.match(result.out, /\/web-crawl-script fix mock/)
})

test('exit 3: duplicate uniqueKey', async () => {
  await signIn()
  mock.state.duplicateIds = true
  const result = await crawl()
  assertFailed(result, 3, 'ValidationError')
  assert.match(result.out, /issue: records\.\*\.id duplicate_key/)
  assert.ok(!result.out.includes('ITEM-1'))
})

test('exit 3, not 0: zero records', async () => {
  await signIn()
  mock.state.totalPages = 0
  const result = await crawl()
  assertFailed(result, 3, 'ValidationError')
  assert.match(result.out, /issue: records too_few_records/)
})

test('exit 1: pagination goes past maxPages', async () => {
  await signIn()
  mock.state.totalPages = 9
  assertFailed(await crawl(), 1, 'MaxPagesError')
})

test('exit 1: an env that is not agentAllowed refuses to start under an agent shell', async () => {
  const result = await runScript('automations/run.ts', ['mock', '--env', 'restricted'], { CLAUDECODE: '1' })
  assertFailed(result, 1, 'UsageError')
  assert.match(result.out, /not approved for agents/)
  assert.equal(mock.state.reads.length, 0, 'no request may be made')
})

test('exit 1: usage errors explain themselves', async () => {
  const noEnv = await runScript('automations/run.ts', ['mock'])
  assertFailed(noEnv, 1, 'UsageError')
  assert.match(noEnv.out, /pass --env \(local \| restricted\)/)
  const unknown = await runScript('automations/run.ts', ['no-such-task'])
  assert.equal(unknown.code, 1)
  assert.match(unknown.out, /task module not found/)
})
