import type { Metadata } from 'next'
import { ComingSoon } from '../components/ui'

export const metadata: Metadata = { title: 'Dashboard' }

export default function DashboardPage() {
  return (
    <ComingSoon section="Dashboard" phase="phase 5">
      Developments by place and topic, proposed versus effective, upcoming deadlines, potentially
      affected synthetic employees, and learning progress. It needs the assignment matching from
      phase 4 to have anything worth counting.
    </ComingSoon>
  )
}
