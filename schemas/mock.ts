import { z } from 'zod'

export const recordSchema = z.object({
  id: z.string(),
  title: z.string(),
  owner: z.string(),
})

export type MockRecord = z.infer<typeof recordSchema>
