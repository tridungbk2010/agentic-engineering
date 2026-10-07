import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  EXIT,
  GuardError,
  HttpError,
  MaxPagesError,
  ProfileLockedError,
  SessionExpiredError,
  UsageError,
  ValidationError,
  checkAgentAllowed,
  formatReport,
  resolveExit,
} from '../../lib/exit.ts'
import type { EnvConfig } from '../../lib/types.ts'

const violation = { method: 'POST', origin: 'https://app.example.com', pathname: '/api/items', reason: 'write-not-allowlisted' }

test('success is exit 0', () => {
  assert.equal(resolveExit({ violations: [], sessionExpired: false }).code, EXIT.OK)
})

test('each failure maps to its own code', () => {
  assert.equal(resolveExit({ error: new GuardError('x'), violations: [], sessionExpired: false }).code, 4)
  assert.equal(resolveExit({ error: new SessionExpiredError(), violations: [], sessionExpired: false }).code, 2)
  assert.equal(resolveExit({ error: new ValidationError([]), violations: [], sessionExpired: false }).code, 3)
  for (const error of [new Error('x'), new HttpError(403), new ProfileLockedError('x'), new MaxPagesError(5), new UsageError('x')]) {
    assert.equal(resolveExit({ error, violations: [], sessionExpired: false }).code, 1, error.constructor.name)
  }
})

test('priority is 4 > 2 > 3 > 1', () => {
  // a guard violation wins over everything, even a run that otherwise succeeded
  assert.equal(resolveExit({ violations: [violation], sessionExpired: false }).code, 4)
  assert.equal(resolveExit({ error: new SessionExpiredError(), violations: [violation], sessionExpired: true }).code, 4)
  assert.equal(resolveExit({ error: new ValidationError([]), violations: [violation], sessionExpired: false }).code, 4)
  // an expired session explains the missing records, so it wins over validation and generic errors
  assert.equal(resolveExit({ error: new ValidationError([]), violations: [], sessionExpired: true }).code, 2)
  assert.equal(resolveExit({ error: new Error('timeout'), violations: [], sessionExpired: true }).code, 2)
  assert.equal(resolveExit({ violations: [], sessionExpired: true }).code, 2)
  assert.equal(resolveExit({ error: new ValidationError([]), violations: [], sessionExpired: false }).code, 3)
})

test('kind is the error class name, never the message', () => {
  const secret = new Error('locator resolved to <td>SECRET</td>')
  assert.equal(resolveExit({ error: secret, violations: [], sessionExpired: false }).kind, 'Error')
  const named = Object.assign(new Error('x'), { name: 'TimeoutError' })
  assert.equal(resolveExit({ error: named, violations: [], sessionExpired: false }).kind, 'TimeoutError')
  const odd = Object.assign(new Error('x'), { name: '<b>SECRET</b>' })
  assert.equal(resolveExit({ error: odd, violations: [], sessionExpired: false }).kind, 'Error')
  assert.equal(resolveExit({ error: 'a thrown string with SECRET', violations: [], sessionExpired: false }).kind, 'Error')
})

test('report prints step, class, zod path + code, and blocked method/origin/pathname only', () => {
  const report = formatReport({
    task: 'tickets',
    env: 'uat',
    code: 3,
    kind: 'ValidationError',
    step: 'validate',
    logPath: 'out/logs/tickets-1.log',
    issues: [{ path: 'records.3.title', code: 'invalid_type' }],
    violations: [violation],
  })
  assert.match(report, /exit=3/)
  assert.match(report, /step: validate/)
  assert.match(report, /error: ValidationError/)
  assert.match(report, /records\.3\.title invalid_type/)
  assert.match(report, /POST https:\/\/app\.example\.com\/api\/items/)
  assert.match(report, /log: out\/logs\/tickets-1\.log/)
})

test('repeated issues on the same field collapse into one line with a count', () => {
  const issues = Array.from({ length: 100 }, (_, i) => ({ path: `records.${i}.author`, code: 'invalid_type' }))
  const report = formatReport({ task: 't', env: 'uat', code: 3, kind: 'ValidationError', step: 'validate', issues, violations: [] })
  const lines = report.split('\n').filter((line) => line.startsWith('issue:'))
  assert.deepEqual(lines, ['issue: records.*.author invalid_type x100 (first: records.0.author)'])
})

test('report caps the issue list and says how many were left out', () => {
  const issues = Array.from({ length: 30 }, (_, i) => ({ path: `records.0.field${i}`, code: 'invalid_type' }))
  const report = formatReport({ task: 't', env: 'uat', code: 3, kind: 'ValidationError', step: 'validate', issues, violations: [] })
  assert.equal(report.split('\n').filter((line) => line.startsWith('issue:')).length, 20)
  assert.match(report, /10 more/)
})

test('a usage message is printed, since we wrote it ourselves', () => {
  const report = formatReport({ task: 't', env: '-', code: 1, kind: 'UsageError', step: 'args', violations: [], message: 'pass --env' })
  assert.match(report, /pass --env/)
})

test('agent may only run an env marked agentAllowed', () => {
  const env = (agentAllowed: boolean): EnvConfig => ({ startUrl: 'https://x/', appOrigins: [], idpOrigins: [], dropOrigins: [], agentAllowed })
  assert.doesNotThrow(() => checkAgentAllowed(env(true), 'uat', { CLAUDECODE: '1' }))
  assert.doesNotThrow(() => checkAgentAllowed(env(false), 'prod', {}))
  assert.throws(() => checkAgentAllowed(env(false), 'prod', { CLAUDECODE: '1' }), UsageError)
  assert.throws(() => checkAgentAllowed(env(false), 'prod', { CURSOR_AGENT: '1' }), UsageError)
  assert.throws(() => checkAgentAllowed(env(false), 'prod', { AE_AGENT: '1' }), UsageError)
})
