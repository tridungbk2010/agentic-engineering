import { parseArgs } from 'node:util'
import path from 'node:path'
import fs from 'node:fs'
import type { ZodType } from 'zod'
import { UsageError } from './exit.ts'
import { ROOT, TASK_NAME } from './settings.ts'
import type { EnvConfig, TaskModule } from './types.ts'

export type Cli = {
  task: string
  envName?: string
  headed: boolean
  trace: boolean
  /** Every other `--key=value` flag, handed to the task as params. */
  params: Record<string, string>
}

export function parseCli(argv: string[], usage: string): Cli {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: false,
    options: { env: { type: 'string' }, headed: { type: 'boolean' }, trace: { type: 'boolean' } },
  })
  const [task, ...rest] = positionals
  if (task === undefined || rest.length > 0) throw new UsageError(`usage: ${usage}`)
  if (!TASK_NAME.test(task)) throw new UsageError('task name may only contain a-z, 0-9 and "-"')

  const params: Record<string, string> = {}
  for (const [key, value] of Object.entries(values)) {
    if (key === 'env' || key === 'headed' || key === 'trace') continue
    if (typeof value !== 'string') throw new UsageError(`pass task params as --${key}=value`)
    params[key] = value
  }
  return {
    task,
    envName: typeof values.env === 'string' ? values.env : undefined,
    headed: values.headed === true,
    trace: values.trace === true,
    params,
  }
}

async function importIfExists<T>(file: string, what: string): Promise<T> {
  if (!fs.existsSync(file)) throw new UsageError(`${what} not found: ${path.relative(ROOT, file)}`)
  return (await import(file)) as T
}

export async function loadTask(task: string): Promise<TaskModule> {
  const module = await importIfExists<Partial<TaskModule>>(path.join(ROOT, 'automations', 'tasks', `${task}.ts`), 'task module')
  if (!module.config || typeof module.run !== 'function') throw new UsageError(`task "${task}" must export config and run()`)
  return module as TaskModule
}

export async function loadSchema(task: string): Promise<ZodType> {
  const module = await importIfExists<{ recordSchema?: ZodType }>(path.join(ROOT, 'schemas', `${task}.ts`), 'schema')
  if (!module.recordSchema) throw new UsageError(`schemas/${task}.ts must export recordSchema`)
  return module.recordSchema
}

/** A task with several envs never guesses: `--env` is required so prod is always an explicit choice. */
export function pickEnv(module: TaskModule, envName: string | undefined): { name: string; env: EnvConfig } {
  const names = Object.keys(module.config.envs)
  const name = envName ?? (names.length === 1 ? names[0] : undefined)
  if (name === undefined) throw new UsageError(`this task has several envs, pass --env (${names.join(' | ')})`)
  const env = module.config.envs[name]
  if (!env) throw new UsageError(`unknown env "${name}" (${names.join(' | ')})`)
  return { name, env }
}
