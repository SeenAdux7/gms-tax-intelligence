import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import { BottomNav } from './components/BottomNav'
import { AdviceDisclaimer } from './components/ui'

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

export const metadata: Metadata = {
  title: {
    default: 'Mobility Tax Intelligence',
    template: '%s · Mobility Tax Intelligence',
  },
  description:
    'Track tax, payroll, social security, and treaty developments affecting mobile employees — explained in plain language, with sources. Educational use only.',
  applicationName: 'Mobility Tax',
}

/**
 * Viewport settings for the installed-app experience.
 *
 * `maximumScale` is deliberately left unset: capping zoom is an accessibility
 * failure, and the brief's primary user is a learner who may well want to zoom
 * into a quoted passage.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#060a13' },
  ],
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      // Next.js 16 no longer overrides scroll-behavior during navigation unless
      // asked; this keeps route changes jumping to top instantly.
      data-scroll-behavior="smooth"
    >
      <body className="flex min-h-full flex-col font-sans">
        <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col">{children}</div>
        <footer className="mx-auto w-full max-w-2xl border-t border-line">
          <AdviceDisclaimer />
        </footer>
        <BottomNav />
      </body>
    </html>
  )
}
