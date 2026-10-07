import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyApiResponse, isLoginUrl } from '../../lib/session.ts'
import type { EnvConfig, TaskConfig } from '../../lib/types.ts'

const env: EnvConfig = {
  startUrl: 'https://app.example.com/',
  appOrigins: ['https://app.example.com'],
  idpOrigins: ['https://login.example.com'],
  dropOrigins: [],
  agentAllowed: true,
}
const session: TaskConfig['session'] = { loginUrl: /\/account\/login/, loginInput: 'input[name=username]' }
const json = 'application/json; charset=utf-8'

test('login URL: the IdP origin, or the app login page', () => {
  assert.equal(isLoginUrl('https://login.example.com/authorize?x=1', env, session), true)
  assert.equal(isLoginUrl('https://app.example.com/account/login', env, session), true)
  assert.equal(isLoginUrl('https://app.example.com/incidents', env, session), false)
  assert.equal(isLoginUrl('about:blank', env, session), false)
})

test('loginUrl given as a string matches origin + pathname', () => {
  const s = { ...session, loginUrl: 'https://app.example.com/signin' }
  assert.equal(isLoginUrl('https://app.example.com/signin?next=/', env, s), true)
  assert.equal(isLoginUrl('https://app.example.com/signin/help', env, s), false)
})

test('401 is an expired session', () => {
  const r = { status: 401, finalUrl: 'https://app.example.com/api/x', contentType: json, expectJson: true }
  assert.equal(classifyApiResponse(r, env, session), 'session-expired')
})

test('a redirect that ends on the IdP or the login page is an expired session', () => {
  const idp = { status: 200, finalUrl: 'https://login.example.com/authorize', contentType: 'text/html', expectJson: false }
  assert.equal(classifyApiResponse(idp, env, session), 'session-expired')
  const login = { status: 200, finalUrl: 'https://app.example.com/account/login', contentType: 'text/html', expectJson: false }
  assert.equal(classifyApiResponse(login, env, session), 'session-expired')
})

test('HTML where JSON was expected is an expired session', () => {
  const r = { status: 200, finalUrl: 'https://app.example.com/api/x', contentType: 'text/html', expectJson: true }
  assert.equal(classifyApiResponse(r, env, session), 'session-expired')
  assert.equal(classifyApiResponse({ ...r, expectJson: false }, env, session), 'ok')
})

test('403 and 500 are plain HTTP errors, not an expired session', () => {
  for (const status of [403, 404, 500]) {
    const r = { status, finalUrl: 'https://app.example.com/api/x', contentType: 'text/html', expectJson: true }
    assert.equal(classifyApiResponse(r, env, session), 'http-error', String(status))
  }
})

test('a JSON 200 is ok', () => {
  const r = { status: 200, finalUrl: 'https://app.example.com/api/x', contentType: json, expectJson: true }
  assert.equal(classifyApiResponse(r, env, session), 'ok')
})
