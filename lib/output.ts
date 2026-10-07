import fs from 'node:fs'
import path from 'node:path'
import { z, type ZodType } from 'zod'
import { ValidationError, type Issue } from './exit.ts'
import { timestamp } from './settings.ts'

export type OutputMeta = {
  task: string
  env: string
  params: Record<string, string>
  recordCount: number
  startedAt?: string
  finishedAt?: string
}

/**
 * Parses with the task schema. zod drops keys the schema does not name, so only approved
 * fields reach the file. Issues carry a path and a code, never a value.
 */
export function validateRecords<T>(records: unknown, schema: ZodType<T>, rules: { minRecords: number; uniqueKey?: string }): T[] {
  if (!Array.isArray(records)) throw new ValidationError([{ path: 'records', code: 'not_array' }])

  const parsed = z.array(schema).safeParse(records)
  if (!parsed.success) {
    const issues: Issue[] = parsed.error.issues.map((issue) => ({ path: ['records', ...issue.path].join('.'), code: issue.code }))
    throw new ValidationError(issues)
  }

  if (parsed.data.length < rules.minRecords) throw new ValidationError([{ path: 'records', code: 'too_few_records' }])

  const key = rules.uniqueKey
  if (key !== undefined) {
    const seen = new Set(parsed.data.map((record) => JSON.stringify((record as Record<string, unknown>)[key])))
    if (seen.size !== parsed.data.length) throw new ValidationError([{ path: `records.*.${key}`, code: 'duplicate_key' }])
  }
  return parsed.data
}

/** Write to a temp file, then rename, so a reader never sees a half-written file. */
export function writeAtomic(file: string, content: string): void {
  const dir = path.dirname(file)
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const tmp = path.join(dir, `.${path.basename(file)}.tmp`)
  try {
    fs.writeFileSync(tmp, content, { mode: 0o600 })
    fs.renameSync(tmp, file)
  } catch (error) {
    fs.rmSync(tmp, { force: true })
    throw error
  }
}

export function writeOutput(rawRoot: string, task: string, meta: OutputMeta, records: unknown[]): string {
  const file = path.join(rawRoot, task, `${timestamp()}.json`)
  writeAtomic(file, JSON.stringify({ meta, records }, null, 2))
  return file
}

export function latestOutput(rawRoot: string, task: string): string | undefined {
  const dir = path.join(rawRoot, task)
  if (!fs.existsSync(dir)) return undefined
  const files = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.json') && !name.startsWith('.'))
    .sort()
  const newest = files.at(-1)
  return newest === undefined ? undefined : path.join(dir, newest)
}
