import Link from 'next/link'
import type { Metadata } from 'next'
import { getLearnSet } from '../../lib/vocab-queries'
import { EmptyState } from '../../components/ui'
import { LearnDeck } from './LearnDeck'

export const metadata: Metadata = { title: 'Learn vocabulary' }
export const dynamic = 'force-dynamic'

export default async function VocabLearnPage() {
  const cards = await getLearnSet(5)

  if (cards.length === 0) {
    return (
      <EmptyState title="No terms to learn">
        Run <code>npm run db:seed:content</code> to load the vocabulary library.
      </EmptyState>
    )
  }

  return (
    <>
      <LearnDeck cards={cards} />
      <p className="px-4 pb-4 text-center text-[10px] text-muted">
        Showing the {cards.length} terms you know least well.{' '}
        <Link href="/vocabulary" className="text-accent hover:underline">
          Browse all
        </Link>
      </p>
    </>
  )
}
