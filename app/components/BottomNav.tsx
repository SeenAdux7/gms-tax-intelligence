'use client'

/**
 * Bottom tab bar — the five sections from the brief's main navigation.
 *
 * Bottom-anchored rather than a top bar or a hamburger, because the brief's
 * primary target is a phone and thumbs reach the bottom of a screen. It also
 * matches what an installed PWA is expected to feel like: once the browser
 * chrome is gone, a top nav floats oddly with nothing above it.
 *
 * A client component only because it needs `usePathname()` to show the active
 * tab. Everything else in the app stays a server component.
 */

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/updates', label: 'Updates', icon: FeedIcon },
  { href: '/learn', label: 'Learn', icon: LearnIcon },
  { href: '/vocabulary', label: 'Words', icon: VocabIcon },
  { href: '/dashboard', label: 'Dashboard', icon: ChartIcon },
  { href: '/saved', label: 'Saved', icon: BookmarkIcon },
] as const

export function BottomNav() {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Main"
      // pb-[env(safe-area-inset-bottom)] keeps the bar clear of the iPhone home
      // indicator once installed to the home screen.
      className="sticky bottom-0 z-20 border-t border-line bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
    >
      <ul className="mx-auto flex max-w-2xl">
        {TABS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`)
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors ${
                  active ? 'text-accent' : 'text-muted hover:text-foreground'
                }`}
              >
                <Icon filled={active} />
                {label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

/* --------------------------------------------------------------------------
 * Icons, inline.
 *
 * Hand-written rather than pulled from an icon package: five small glyphs is
 * not worth a dependency, and inline SVG means no extra network request and no
 * flash of missing icons on first paint.
 * -------------------------------------------------------------------------- */

type IconProps = { filled?: boolean }

const svg = {
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}

function FeedIcon({ filled }: IconProps) {
  return (
    <svg {...svg} strokeWidth={filled ? 2.25 : 1.75}>
      <path d="M4 5h16M4 10h16M4 15h10M4 20h7" />
    </svg>
  )
}

function LearnIcon({ filled }: IconProps) {
  return (
    <svg {...svg} strokeWidth={filled ? 2.25 : 1.75}>
      <path d="M3 6.5 12 3l9 3.5-9 3.5z" />
      <path d="M21 6.5v6" />
      <path d="M6.5 8.5V15c0 1.7 2.5 3 5.5 3s5.5-1.3 5.5-3V8.5" />
    </svg>
  )
}

function VocabIcon({ filled }: IconProps) {
  return (
    <svg {...svg} strokeWidth={filled ? 2.25 : 1.75}>
      <path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H19v18H5.5A1.5 1.5 0 0 1 4 19.5z" />
      <path d="M8 7.5h7M8 11h7M8 14.5h4" />
    </svg>
  )
}

function ChartIcon({ filled }: IconProps) {
  return (
    <svg {...svg} strokeWidth={filled ? 2.25 : 1.75}>
      <path d="M4 20V4" />
      <path d="M4 20h16" />
      <path d="M8 20v-6M13 20V8M18 20v-9" />
    </svg>
  )
}

function BookmarkIcon({ filled }: IconProps) {
  return (
    <svg {...svg} fill={filled ? 'currentColor' : 'none'} strokeWidth={filled ? 1 : 1.75}>
      <path d="M6 3.5h12a.5.5 0 0 1 .5.5v16.2a.4.4 0 0 1-.63.33L12 16.5l-5.87 4.03a.4.4 0 0 1-.63-.33V4a.5.5 0 0 1 .5-.5z" />
    </svg>
  )
}
