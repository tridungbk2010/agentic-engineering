// pnpm analyze <task>
// Reads the newest JSON in out/raw/<task>/ and writes an aggregate report. Never opens a browser.
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { UsageError } from '../lib/exit.ts'
import { latestOutput, writeAtomic, type OutputMeta } from '../lib/output.ts'
import { ROOT, rawDir, reportsDir, timestamp } from '../lib/settings.ts'
import { loadSchema, parseCli } from '../lib/task.ts'

type AnalysisModule = { analyze?: (records: any[], meta: OutputMeta) => unknown }

try {
  const cli = parseCli(process.argv.slice(2), 'pnpm analyze <task>')
  const schema = await loadSchema(cli.task)

  const moduleFile = path.join(ROOT, 'analysis', 'tasks', `${cli.task}.ts`)
  if (!fs.existsSync(moduleFile)) throw new UsageError(`analysis module not found: analysis/tasks/${cli.task}.ts`)
  const module = (await import(moduleFile)) as AnalysisModule
  if (typeof module.analyze !== 'function') throw new UsageError(`analysis/tasks/${cli.task}.ts must export analyze()`)

  const source = latestOutput(rawDir(), cli.task)
  if (!source) throw new UsageError(`no raw output for "${cli.task}", run pnpm crawl ${cli.task} first`)
  const raw = JSON.parse(fs.readFileSync(source, 'utf8')) as { meta: OutputMeta; records: unknown }
  const records = z.array(schema).parse(raw.records)

  const report = module.analyze(records, raw.meta)
  const file = path.join(reportsDir(), cli.task, `${timestamp()}.json`)
  writeAtomic(file, JSON.stringify({ source: path.basename(source), meta: raw.meta, report }, null, 2))
  console.log(`analyze ${cli.task} OK records=${records.length} file=${path.relative(ROOT, file)}`)
} catch (error) {
  if (error instanceof UsageError) console.error(error.message)
  else console.error(`analyze failed: ${error instanceof Error ? error.name : 'Error'}`)
  process.exit(1)
}
