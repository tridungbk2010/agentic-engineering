import type { OutputMeta } from '../../lib/output.ts'
import type { MockRecord } from '../../schemas/mock.ts'

export function analyze(records: MockRecord[], meta: OutputMeta) {
  return {
    crawledAt: meta.finishedAt,
    total: records.length,
    distinctOwners: new Set(records.map((record) => record.owner)).size,
  }
}
