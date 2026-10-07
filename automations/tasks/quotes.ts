// Reference task (plan Phase 3a): quotes.toscrape.com, a public sandbox built for scraping practice.
// Spec: specs/quotes.md. Copy this file as the starting point for a new task.
import type { TaskConfig, TaskContext } from '../../lib/types.ts'

const ORIGIN = 'https://quotes.toscrape.com'

export const config: TaskConfig = {
  site: 'quotes',
  envs: {
    live: { startUrl: `${ORIGIN}/`, appOrigins: [ORIGIN], idpOrigins: [], dropOrigins: [], agentAllowed: true },
  },
  writeAllowlist: [],
  blockUrls: [/logout|signout/i],
  allowWebSocket: [],
  minRecords: 100,
  uniqueKey: 'text',
  maxPages: 20,
  rate: { minDelayMs: 500 },
  // The site is public; these only matter if a crawl ever lands on its login page.
  session: { loginUrl: `${ORIGIN}/login`, loginInput: 'input[name=username]' },
  timeoutMs: 120_000,
}

// The /scroll page loads its quotes from this JSON API, so the task calls it directly instead of parsing HTML.
type QuotesPage = {
  has_next: boolean
  quotes: { text: string; tags: string[]; author: { name: string; slug: string } }[]
}

export async function run({ api, step, nextPage }: TaskContext): Promise<unknown[]> {
  step('quotes api')
  const records: unknown[] = []
  for (let hasNext = true; hasNext; ) {
    const data = await api.json<QuotesPage>(`/api/quotes?page=${nextPage()}`)
    for (const quote of data.quotes) {
      records.push({ text: quote.text, author: quote.author.name, authorSlug: quote.author.slug, tags: quote.tags })
    }
    hasNext = data.has_next
  }
  return records
}
