import { redirect } from 'next/navigation'

/**
 * Updates is the app's home. The brief calls it "the main current-events feed",
 * so `/` redirects there rather than adding a landing page nobody asked for.
 *
 * Kept as a redirect rather than rendering the feed at `/` so that the feed has
 * exactly one canonical URL — which matters for the shareable filter links.
 */
export default function Home() {
  redirect('/updates')
}
