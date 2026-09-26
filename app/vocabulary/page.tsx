import type { Metadata } from 'next'
import { ComingSoon } from '../components/ui'

export const metadata: Metadata = { title: 'Vocabulary' }

export default function VocabularyPage() {
  return (
    <ComingSoon section="Vocabulary" phase="phase 3">
      Browse, learn, practise, and review the language of global mobility. The 16 foundational terms
      are already in the database with definitions, examples, and common misunderstandings — this
      screen is what is missing.
    </ComingSoon>
  )
}
