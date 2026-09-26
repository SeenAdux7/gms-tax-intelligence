import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Offline' }

/**
 * Shown when a navigation fails and nothing is cached for it.
 *
 * Deliberately specific about what is and is not available. "You are offline"
 * alone invites the reader to assume the app is broken; saying that already-read
 * updates still work, and that new ones need a connection, is both true and
 * actionable.
 */
export default function OfflinePage() {
  return (
    <main className="flex flex-1 items-center px-6 py-16">
      <div className="mx-auto max-w-sm text-center">
        <h1 className="text-lg font-semibold">No connection</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">
          This page has not been loaded before, so there is no saved copy to show you.
        </p>

        <div className="mt-5 rounded-xl border border-line bg-surface-raised p-4 text-left">
          <p className="text-[11px] font-semibold tracking-wide text-muted uppercase">
            What still works offline
          </p>
          <ul className="mt-2 space-y-1.5 text-[13px] leading-relaxed text-foreground/85">
            <li>Updates and lessons you have already opened</li>
            <li>Vocabulary cards you have visited</li>
          </ul>
          <p className="mt-3 text-[11px] font-semibold tracking-wide text-muted uppercase">
            What needs a connection
          </p>
          <ul className="mt-2 space-y-1.5 text-[13px] leading-relaxed text-foreground/85">
            <li>Newly published developments</li>
            <li>Saving items and recording answers</li>
            <li>Opening a source document on a tax authority&rsquo;s own website</li>
          </ul>
        </div>

        <Link
          href="/updates"
          className="mt-6 inline-block rounded-lg bg-accent px-4 py-2.5 text-[13px] font-medium text-white"
        >
          Try the feed
        </Link>
      </div>
    </main>
  )
}
