import type { Metadata } from 'next'
import { ComingSoon } from '../components/ui'

export const metadata: Metadata = { title: 'Saved' }

export default function SavedPage() {
  return (
    <ComingSoon section="Saved" phase="phase 1–3">
      Bookmarked updates, terms marked difficult, and questions answered incorrectly, gathered for
      review. The tables exist; saving gets wired up alongside the screens that create the things
      worth saving.
    </ComingSoon>
  )
}
