import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { latestOutput, validateRecords, writeOutput } from '../../lib/output.ts'
import { ValidationError } from '../../lib/exit.ts'

const schema = z.object({ id: z.string(), title: z.string(), owner: z.string().optional() })
const rules = { minRecords: 2, uniqueKey: 'id' }
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ae-output-'))

const issuesOf = (fn: () => unknown) => {
  try {
    fn()
  } catch (error) {
    assert.ok(error instanceof ValidationError, 'expected a ValidationError')
    return error.issues
  }
  assert.fail('expected a throw')
}

test('valid records come back, and fields outside the schema are stripped', () => {
  const records = validateRecords(
    [
      { id: '1', title: 'a', internalNote: 'do not store' },
      { id: '2', title: 'b' },
    ],
    schema,
    rules,
  )
  assert.deepEqual(records, [
    { id: '1', title: 'a' },
    { id: '2', title: 'b' },
  ])
})

test('a schema mismatch reports path and code, never the value', () => {
  const issues = issuesOf(() => validateRecords([{ id: '1', title: 'a' }, { id: '2', title: 4242 }], schema, rules))
  assert.deepEqual(issues, [{ path: 'records.1.title', code: 'invalid_type' }])
  assert.ok(!JSON.stringify(issues).includes('4242'))
})

test('zero or too few records is a validation error, not a success', () => {
  assert.deepEqual(issuesOf(() => validateRecords([], schema, rules)), [{ path: 'records', code: 'too_few_records' }])
  assert.deepEqual(issuesOf(() => validateRecords([{ id: '1', title: 'a' }], schema, rules)), [
    { path: 'records', code: 'too_few_records' },
  ])
})

test('a non-array result is a validation error', () => {
  assert.deepEqual(issuesOf(() => validateRecords({ id: '1' }, schema, rules)), [{ path: 'records', code: 'not_array' }])
})

test('duplicate uniqueKey values are a validation error that does not print the key', () => {
  const issues = issuesOf(() =>
    validateRecords(
      [
        { id: 'DUP-77', title: 'a' },
        { id: 'DUP-77', title: 'b' },
      ],
      schema,
      rules,
    ),
  )
  assert.deepEqual(issues, [{ path: 'records.*.id', code: 'duplicate_key' }])
  assert.ok(!JSON.stringify(issues).includes('DUP-77'))
})

test('output is written under <task>/, owner-only, with meta, and leaves no temp file', () => {
  const root = tmp()
  const file = writeOutput(root, 'tickets', { task: 'tickets', env: 'uat', params: {}, recordCount: 1 }, [{ id: '1', title: 'a' }])
  assert.equal(path.dirname(file), path.join(root, 'tickets'))
  assert.equal(fs.statSync(file).mode & 0o777, 0o600)
  assert.deepEqual(fs.readdirSync(path.dirname(file)), [path.basename(file)])
  const body = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.equal(body.meta.recordCount, 1)
  assert.deepEqual(body.records, [{ id: '1', title: 'a' }])
})

test('latestOutput picks the newest file and ignores temp files', () => {
  const root = tmp()
  const dir = path.join(root, 'tickets')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, '2026-01-01T00-00-00-000Z.json'), '{}')
  fs.writeFileSync(path.join(dir, '2026-03-01T00-00-00-000Z.json'), '{}')
  fs.writeFileSync(path.join(dir, '.2026-09-01T00-00-00-000Z.json.tmp'), '{}')
  assert.equal(latestOutput(root, 'tickets'), path.join(dir, '2026-03-01T00-00-00-000Z.json'))
  assert.equal(latestOutput(root, 'nothing-here'), undefined)
})
