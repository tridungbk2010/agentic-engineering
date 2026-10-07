// Spec: specs/efis-my-learning.md.
// EFIS renders the course list and progress on the server (TanStack Start loaders), so there is no JSON API
// to call: the task reads the enrolled courses from /courses and the progress from each /learn/<slug> page.
import type { TaskConfig, TaskContext } from '../../lib/types.ts'

const ORIGIN = 'https://staging.efis.edu.vn'

export const config: TaskConfig = {
  site: 'efis',
  envs: {
    staging: {
      startUrl: `${ORIGIN}/my-learning`,
      // Supabase is the app's backend (REST + Auth), so it counts as app: writes to it are blocked.
      appOrigins: [ORIGIN, 'https://nnofmqnajhdxdwcqrpxt.supabase.co'],
      idpOrigins: ['https://accounts.google.com'],
      dropOrigins: [],
      agentAllowed: true,
    },
  },
  writeAllowlist: [],
  blockUrls: [/logout|signout/i],
  allowWebSocket: [],
  minRecords: 1,
  uniqueKey: 'courseId',
  maxPages: 20,
  rate: { minDelayMs: 1000 },
  // A signed-out visit to /my-learning redirects to /login?next=...
  session: { loginUrl: /^https:\/\/staging\.efis\.edu\.vn\/login(\?|$)/, loginInput: 'input[type=email]' },
  timeoutMs: 120_000,
}

type EnrolledCourse = { courseId: string; title: string }

export async function run({ page, step, nextPage }: TaskContext): Promise<unknown[]> {
  step('course list')
  nextPage()
  await page.goto(`${ORIGIN}/courses`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: 'Khóa học của bạn', level: 2 }).waitFor()

  // Only cards with a "Tiếp tục học" link to /learn/<slug> are enrolled courses.
  const cards = page.getByRole('article').filter({ has: page.getByRole('link', { name: 'Tiếp tục học' }) })
  const found: EnrolledCourse[] = []
  for (const card of await cards.all()) {
    const href = await card.getByRole('link', { name: 'Tiếp tục học' }).getAttribute('href')
    const courseId = href?.match(/^\/learn\/([^/?#]+)/)?.[1]
    const title = (await card.getByRole('heading', { level: 3 }).innerText()).trim()
    if (courseId === undefined) throw new Error('enrolled course card has no /learn/<slug> link')
    found.push({ courseId, title })
  }

  const records: unknown[] = []
  for (const course of found) {
    step('course progress')
    nextPage()
    await page.goto(`${ORIGIN}/learn/${course.courseId}`, { waitUntil: 'domcontentloaded' })
    const counts = page.getByText(/^\d+\/\d+ bài đã hoàn thành$/).first()
    await counts.waitFor()
    const [, completed, total] = (await counts.innerText()).match(/^(\d+)\/(\d+)/) ?? []
    const percent = (await page.getByText(/^\d+%$/).first().innerText()).replace('%', '')
    records.push({
      courseId: course.courseId,
      title: course.title,
      url: `${ORIGIN}/learn/${course.courseId}`,
      progressPercent: Number(percent),
      completedLessons: Number(completed),
      totalLessons: Number(total),
    })
  }
  return records
}
