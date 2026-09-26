import Link from 'next/link'
import type { Metadata } from 'next'
import { getPracticeSet } from '../../lib/vocab-queries'
import { PracticeRunner } from '../practice/PracticeRunner'

export const metadata: Metadata = { title: 'Review vocabulary' }
export const dynamic = 'force-dynamic'

/**
 * Review is Practice restricted to what needs work: terms that are due, flagged
 * difficult, or previously answered wrong.
 *
 * An empty review queue is a SUCCESS state, not an error — so it says so rather
 * than showing an empty-list message that reads like something went wrong.
 */
export default async function ReviewPage() {
  const questions = await getPracticeSet({ limit: 10, onlyWeak: true })

  if (questions.length === 0) {
    return (
      <main className="flex-1 px-4 py-6">
        <div className="rounded-xl border border-line bg-surface-raised p-5 text-center">
          <h1 className="text-[16px] font-semibold">Nothing due</h1>
          <p className="mx-auto mt-2 max-w-xs text-[13px] leading-relaxed text-muted">
            Every term is either known or scheduled for later. Terms come back on a spacing
            schedule — the ones you find hard return soonest.
          </p>
          <div className="mt-5 space-y-2">
            <Link
              href="/vocabulary/practice"
              className="block rounded-lg bg-accent px-4 py-2.5 text-[13px] font-medium text-white"
            >
              Practise anyway
            </Link>
            <Link
              href="/vocabulary"
              className="block rounded-lg bg-surface px-4 py-2.5 text-[13px] font-medium text-accent ring-1 ring-line"
            >
              Back to vocabulary
            </Link>
          </div>
        </div>
      </main>
    )
  }

  return <PracticeRunner questions={questions} mode="review" />
}
