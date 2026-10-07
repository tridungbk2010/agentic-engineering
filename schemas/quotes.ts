import { z } from 'zod'

// Mirrors the "Output schema" section of specs/quotes.md.
export const recordSchema = z.object({
  text: z.string().min(1),
  author: z.string().min(1),
  authorSlug: z.string().min(1),
  tags: z.array(z.string()),
})

export type QuoteRecord = z.infer<typeof recordSchema>
