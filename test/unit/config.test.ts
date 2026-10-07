import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveConfig } from '../../lib/config.ts'
import { UsageError } from '../../lib/exit.ts'

const minimal = { site: 'shop', envs: { prod: { startUrl: 'https://shop.example.com/orders' } } }

test('a minimal config gets the safe defaults', () => {
  const config = resolveConfig(minimal)
  assert.deepEqual(config.envs.prod, {
    startUrl: 'https://shop.example.com/orders',
    appOrigins: ['https://shop.example.com'],
    idpOrigins: [],
    dropOrigins: [],
    agentAllowed: false,
  })
  assert.deepEqual(config.writeAllowlist, [])
  assert.deepEqual(config.allowWebSocket, [])
  assert.equal(config.blockUrls.length, 1)
  assert.equal(config.blockUrls[0]!.test('https://shop.example.com/logout'), true)
  assert.equal(config.blockUrls[0]!.test('https://shop.example.com/account/SignOut'), true)
  assert.equal(config.minRecords, 1)
  assert.equal(config.uniqueKey, undefined)
  assert.equal(config.maxPages, 20)
  assert.deepEqual(config.rate, { minDelayMs: 1000 })
  assert.equal(config.timeoutMs, 120_000)
  assert.equal(config.session.loginUrl, undefined)
  assert.match(config.session.loginInput, /type=email/)
  assert.match(config.session.loginInput, /type=password/)
})

test('the startUrl origin is always an app origin, next to the ones listed', () => {
  const config = resolveConfig({
    site: 'shop',
    envs: { prod: { startUrl: 'https://shop.example.com/', appOrigins: ['https://api.example.com', 'https://shop.example.com'] } },
  })
  assert.deepEqual(config.envs.prod!.appOrigins, ['https://shop.example.com', 'https://api.example.com'])
})

test('the logout pattern is always blocked, next to the ones listed', () => {
  const config = resolveConfig({ ...minimal, blockUrls: [/\/export/, /logout|signout/i] })
  assert.deepEqual(
    config.blockUrls.map(String),
    ['/logout|signout/i', '/\\/export/'],
  )
})

test('explicit values win over the defaults', () => {
  const config = resolveConfig({
    ...minimal,
    envs: { prod: { startUrl: 'https://shop.example.com/', agentAllowed: true } },
    minRecords: 50,
    uniqueKey: 'id',
    maxPages: 3,
    rate: { minDelayMs: 0 },
    timeoutMs: 5000,
    session: { loginUrl: /\/login/ },
    locale: 'vi-VN',
  })
  assert.equal(config.envs.prod!.agentAllowed, true)
  assert.equal(config.minRecords, 50)
  assert.equal(config.uniqueKey, 'id')
  assert.equal(config.maxPages, 3)
  assert.deepEqual(config.rate, { minDelayMs: 0 })
  assert.equal(config.timeoutMs, 5000)
  assert.deepEqual(config.session.loginUrl, /\/login/)
  assert.match(config.session.loginInput, /type=email/)
  assert.equal(config.locale, 'vi-VN')
})

test('a missing site, env or startUrl is a usage error', () => {
  assert.throws(() => resolveConfig({ envs: minimal.envs } as never), UsageError)
  assert.throws(() => resolveConfig({ site: 'shop', envs: {} }), UsageError)
  assert.throws(() => resolveConfig({ site: 'shop', envs: { prod: {} as never } }), UsageError)
  assert.throws(() => resolveConfig({ site: 'shop', envs: { prod: { startUrl: 'not a url' } } }), UsageError)
})

test('resolving twice gives the same config', () => {
  const once = resolveConfig(minimal)
  assert.deepEqual(resolveConfig(once), once)
})
