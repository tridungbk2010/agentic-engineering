import { z } from 'zod'

// Derived from the "Thuộc tính cần lấy" section of specs/efis-my-learning.md.
export const recordSchema = z.object({
  courseId: z.string().min(1),
  title: z.string().min(1),
  url: z.url(),
  progressPercent: z.number().min(0).max(100),
  completedLessons: z.number().int().min(0).optional(),
  totalLessons: z.number().int().min(0).optional(),
})

export type EfisMyLearningRecord = z.infer<typeof recordSchema>
