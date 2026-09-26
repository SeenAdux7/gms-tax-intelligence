import type { Metadata } from 'next'
import { getPracticeSet } from '../../lib/vocab-queries'
import { EmptyState } from '../../components/ui'
import { PracticeRunner } from './PracticeRunner'

export const metadata: Metadata = { title: 'Practice vocabulary' }
export const dynamic = 'force-dynamic'

export default async function PracticePage() {
  const questions = await getPracticeSet({ limit: 8 })

  if (questions.length === 0) {
    return (
      <EmptyState title="Nothing to practise yet">
        Run <code>npm run db:seed:content</code> to load the vocabulary library.
      </EmptyState>
    )
  }

  return <PracticeRunner questions={questions} mode="practice" />
}
