import type { OutputMeta } from '../../lib/output.ts'
import type { QuoteRecord } from '../../schemas/quotes.ts'

const top = (counts: Map<string, number>, limit: number) =>
  [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }))

export function analyze(records: QuoteRecord[], meta: OutputMeta) {
  const byAuthor = new Map<string, number>()
  const byTag = new Map<string, number>()
  for (const record of records) {
    byAuthor.set(record.author, (byAuthor.get(record.author) ?? 0) + 1)
    for (const tag of record.tags) byTag.set(tag, (byTag.get(tag) ?? 0) + 1)
  }
  return {
    crawledAt: meta.finishedAt,
    totalQuotes: records.length,
    distinctAuthors: byAuthor.size,
    distinctTags: byTag.size,
    topAuthors: top(byAuthor, 5),
    topTags: top(byTag, 5),
  }
}
