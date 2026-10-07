import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classify, wsAllowed } from '../../lib/guard.ts'
import type { EnvConfig, TaskConfig } from '../../lib/types.ts'

const env: EnvConfig = {
  startUrl: 'https://app.example.com/',
  appOrigins: ['https://app.example.com', 'https://api.example.com'],
  idpOrigins: ['https://login.example.com'],
  dropOrigins: ['https://telemetry.example.com'],
  agentAllowed: true,
}

const base: TaskConfig = {
  site: 'example',
  envs: { uat: env },
  writeAllowlist: [],
  blockUrls: [/logout|signout/i],
  allowWebSocket: [],
  minRecords: 1,
  maxPages: 10,
  rate: { minDelayMs: 0 },
  session: { loginInput: 'input[name=username]' },
  timeoutMs: 60_000,
}

const gql = (body: unknown) => JSON.stringify(body)
const GQL_URL = 'https://api.example.com/graphql'
const withRules = (...rules: TaskConfig['writeAllowlist']): TaskConfig => ({ ...base, writeAllowlist: rules })

test('safe methods pass on every origin, declared or not', () => {
  for (const method of ['GET', 'HEAD', 'OPTIONS', 'get']) {
    for (const url of ['https://app.example.com/x', 'https://cdn.unknown.net/lib.js']) {
      assert.equal(classify({ method, url }, env, base).action, 'allow', `${method} ${url}`)
    }
  }
})

test('write to an app origin outside the allowlist is blocked', () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.deepEqual(classify({ method, url: 'https://app.example.com/api/items' }, env, base), {
      action: 'block',
      reason: 'write-not-allowlisted',
    })
  }
})

test('write to a second app origin (API on another host) is blocked too', () => {
  assert.equal(classify({ method: 'POST', url: 'https://api.example.com/v1/save' }, env, base).action, 'block')
})

test('write to an undeclared origin is blocked', () => {
  assert.deepEqual(classify({ method: 'POST', url: 'https://other.example.net/write' }, env, base), {
    action: 'block',
    reason: 'undeclared-origin',
  })
})

test('write to the IdP passes, write to telemetry is dropped', () => {
  assert.equal(classify({ method: 'POST', url: 'https://login.example.com/oauth2/token' }, env, base).action, 'allow')
  assert.equal(classify({ method: 'POST', url: 'https://telemetry.example.com/beacon' }, env, base).action, 'drop')
})

test('allowlisted write passes: string matches origin + pathname, query ignored', () => {
  const config = withRules({ method: 'POST', url: 'https://api.example.com/search' })
  assert.equal(classify({ method: 'POST', url: 'https://api.example.com/search?q=1' }, env, config).action, 'allow')
  assert.equal(classify({ method: 'PUT', url: 'https://api.example.com/search' }, env, config).action, 'block')
  assert.equal(classify({ method: 'POST', url: 'https://api.example.com/search/delete' }, env, config).action, 'block')
})

test('allowlist does not open an undeclared origin', () => {
  const config = withRules({ method: 'POST', url: 'https://other.example.net/search' })
  assert.equal(classify({ method: 'POST', url: 'https://other.example.net/search' }, env, config).action, 'block')
})

test('blockUrls stops a GET with side effects, but not a script that merely has the word in its name', () => {
  const logout = 'https://app.example.com/account/logout'
  assert.deepEqual(classify({ method: 'GET', url: logout, resourceType: 'document' }, env, base), {
    action: 'block',
    reason: 'blocked-url',
  })
  assert.equal(classify({ method: 'GET', url: logout }, env, base).action, 'block')
  assert.equal(
    classify({ method: 'GET', url: 'https://app.example.com/js/logout-button.js', resourceType: 'script' }, env, base).action,
    'allow',
  )
  assert.equal(
    classify({ method: 'GET', url: 'https://app.example.com/home?next=/logout', resourceType: 'document' }, env, base).action,
    'allow',
  )
})

test('non-http schemes pass', () => {
  assert.equal(classify({ method: 'GET', url: 'data:text/plain,hi' }, env, base).action, 'allow')
  assert.equal(classify({ method: 'GET', url: 'about:blank' }, env, base).action, 'allow')
})

test('graphql: an allowlisted named query passes', () => {
  const config = withRules({ method: 'POST', url: GQL_URL, graphql: { operationName: 'ListIncidents' } })
  const postData = gql({ operationName: 'ListIncidents', query: 'query ListIncidents { incidents { id } }' })
  assert.equal(classify({ method: 'POST', url: GQL_URL, postData }, env, config).action, 'allow')
})

test('graphql: a mutation is blocked even when it borrows an allowlisted operationName', () => {
  const config = withRules({ method: 'POST', url: GQL_URL, graphql: { operationName: 'ListIncidents' } })
  const renamed = gql({ operationName: 'ListIncidents', query: 'mutation ListIncidents { deleteAll }' })
  assert.deepEqual(classify({ method: 'POST', url: GQL_URL, postData: renamed }, env, config), {
    action: 'block',
    reason: 'graphql-not-allowlisted',
  })
  // operationName picks the mutation out of a document that also holds the allowlisted query
  const mixed = gql({
    operationName: 'Wipe',
    query: 'query ListIncidents { incidents { id } } mutation Wipe { deleteAll }',
  })
  assert.equal(classify({ method: 'POST', url: GQL_URL, postData: mixed }, env, config).action, 'block')
})

test('graphql: several operations with no operationName cannot be resolved, so blocked', () => {
  const config = withRules({ method: 'POST', url: GQL_URL, graphql: { operationName: 'A' } })
  const postData = gql({ query: 'query A { a } query B { b }' })
  assert.equal(classify({ method: 'POST', url: GQL_URL, postData }, env, config).action, 'block')
})

test('graphql: a query not on the allowlist, an anonymous query, and junk bodies are blocked', () => {
  const config = withRules({ method: 'POST', url: GQL_URL, graphql: { operationName: 'ListIncidents' } })
  const bodies = [
    gql({ query: 'query Other { x }' }),
    gql({ query: '{ incidents { id } }' }),
    gql({ query: 'not graphql at all {{{' }),
    'not json',
    gql([]),
    gql(null),
    undefined,
  ]
  for (const postData of bodies) {
    assert.equal(classify({ method: 'POST', url: GQL_URL, postData }, env, config).action, 'block', String(postData))
  }
})

test('graphql: every element of a batch is checked', () => {
  const config = withRules({ method: 'POST', url: GQL_URL, graphql: { operationName: 'ListIncidents' } })
  const ok = { query: 'query ListIncidents { incidents { id } }' }
  assert.equal(classify({ method: 'POST', url: GQL_URL, postData: gql([ok, ok]) }, env, config).action, 'allow')
  const bad = { query: 'mutation Wipe { deleteAll }' }
  assert.equal(classify({ method: 'POST', url: GQL_URL, postData: gql([ok, bad]) }, env, config).action, 'block')
})

test('graphql: a persisted query passes only when its hash is allowlisted', () => {
  const config = withRules({ method: 'POST', url: GQL_URL, graphql: { sha256Hash: 'abc123' } })
  const persisted = (hash: string) => gql({ extensions: { persistedQuery: { version: 1, sha256Hash: hash } } })
  assert.equal(classify({ method: 'POST', url: GQL_URL, postData: persisted('abc123') }, env, config).action, 'allow')
  assert.equal(classify({ method: 'POST', url: GQL_URL, postData: persisted('zzz') }, env, config).action, 'block')
})

test('graphql: a rule with a graphql condition does not let a plain POST through', () => {
  const config = withRules({ method: 'POST', url: GQL_URL, graphql: { operationName: 'ListIncidents' } })
  assert.equal(classify({ method: 'POST', url: GQL_URL, postData: gql({ foo: 1 }) }, env, config).action, 'block')
})

test('websocket: closed unless the URL is allowlisted', () => {
  assert.equal(wsAllowed('wss://app.example.com/hub', base), false)
  assert.equal(wsAllowed('wss://app.example.com/hub', { ...base, allowWebSocket: ['wss://app.example.com/hub'] }), true)
  assert.equal(wsAllowed('wss://app.example.com/hub?id=9', { ...base, allowWebSocket: [/\/hub/] }), true)
  assert.equal(wsAllowed('wss://app.example.com/other', { ...base, allowWebSocket: ['wss://app.example.com/hub'] }), false)
})
