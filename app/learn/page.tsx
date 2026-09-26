import Link from 'next/link'
import type { Metadata } from 'next'
import { listLessons } from '../lib/lesson-queries'
import { EmptyState, SeedDataNotice, StatusBadge } from '../components/ui'

export const metadata: Metadata = { title: 'Learn' }

/**
 * Rendered per request, not prerendered at build time.
 *
 * Two reasons, and the second is the real one:
 *
 *   1. Prerendering makes the build depend on a reachable database, so a
 *      transient database problem becomes a failed deploy.
 *   2. This list changes whenever the hourly collection publishes a new
 *      development. A page baked at build time would show whatever was true
 *      when the deploy ran and then quietly go stale.
 *
 * Any page in this app that reads the database should be dynamic for the same
 * reason. `/updates` and `/updates/[slug]` already are, by virtue of reading
 * searchParams.
 */
export const dynamic = 'force-dynamic'

export default async function LearnPage() {
  const lessons = await listLessons()

  return (
    <main className="flex-1">
      <header className="px-4 pt-6 pb-3">
        <h1 className="text-2xl font-semibold tracking-tight">Learn</h1>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">
          Each lesson takes one real development and walks through it in five steps — what happened,
          what you think it means, what the answer actually is, how it plays out for a client, and
          how you would write it up.
        </p>
      </header>

      {lessons.length === 0 ? (
        <EmptyState title="No lessons available">
          Lessons are generated from updates. Run <code>npm run db:seed:lessons</code> to load them.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {lessons.map((lesson) => (
            <li key={lesson.developmentSlug}>
              <Link
                href={`/learn/${lesson.developmentSlug}`}
                className="block px-4 py-4 transition-colors hover:bg-surface active:bg-surface"
              >
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <StatusBadge status={lesson.status} size="sm" />
                  {lesson.isSeedData && <SeedDataNotice inline />}
                </div>
                <h2 className="text-[15px] leading-snug font-semibold">{lesson.headline}</h2>
                <p className="mt-1.5 text-[11px] text-muted">
                  5 steps · {lesson.questionCount}{' '}
                  {lesson.questionCount === 1 ? 'question' : 'questions'}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <p className="px-4 pt-5 text-[11px] leading-relaxed text-muted">
        Questions are only published when the correct answer either quotes the source or is
        explicitly &ldquo;not enough information to decide&rdquo;. Two of the questions in this set
        have the second kind of answer — those are the ones worth slowing down on.
      </p>
    </main>
  )
}
