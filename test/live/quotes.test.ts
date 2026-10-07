// Plan Phase 3a. Talks to the real quotes.toscrape.com, so it is not part of `pnpm test`: run `pnpm test:live`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '../..')
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-live-'))
const env = {
  ...process.env,
  AUTH_DIR: path.join(tmpRoot, 'auth'),
  AE_OUT_DIR: path.join(tmpRoot, 'out'),
  AE_BROWSER_CHANNEL: process.env.AE_BROWSER_CHANNEL ?? 'chrome',
}

const run = (script: string, args: string[]) =>
  new Promise<{ code: number; out: string }>((resolve) => {
    execFile(process.execPath, ['--import', 'tsx', script, ...args], { cwd: ROOT, env, encoding: 'utf8' }, (error, stdout, stderr) =>
      resolve({ code: error ? Number(error.code ?? 1) : 0, out: stdout + stderr }),
    )
  })

test('quotes: crawl all 100 quotes headless, then analyze from the JSON', async () => {
  const crawl = await run('automations/run.ts', ['quotes'])
  assert.equal(crawl.code, 0, crawl.out)
  assert.match(crawl.out, /crawl quotes \[live\] OK records=100/)

  const analyze = await run('analysis/run.ts', ['quotes'])
  assert.equal(analyze.code, 0, analyze.out)
  const dir = path.join(env.AE_OUT_DIR, 'reports', 'quotes')
  const { report } = JSON.parse(fs.readFileSync(path.join(dir, fs.readdirSync(dir)[0]!), 'utf8'))
  assert.equal(report.totalQuotes, 100)
  assert.ok(report.distinctAuthors > 10)

  fs.rmSync(tmpRoot, { recursive: true, force: true })
})
