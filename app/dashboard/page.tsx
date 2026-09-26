import Link from 'next/link'
import type { Metadata } from 'next'
import { ComingSoon } from '../components/ui'

export const metadata: Metadata = { title: 'Dashboard' }

export default function DashboardPage() {
  return (
    <>
      <ComingSoon section="Dashboard" phase="phase 5">
        Developments by place and topic, proposed versus effective, upcoming deadlines, potentially
        affected synthetic employees, and learning progress. The assignment matching it counts is
        already built — this is the screen that summarises it.
      </ComingSoon>
      {/* The assignments screen has no tab of its own, so until the dashboard
          exists this is the only way to reach it. */}
      <div className="px-6 pb-8 text-center">
        <Link href="/assignments" className="text-[13px] font-medium text-accent hover:underline">
          Browse the synthetic assignments →
        </Link>
      </div>
    </>
  )
}
