/**
 * Screenshot the app at phone size
 * ================================
 *
 * A build passing and a page returning 200 do not tell you whether the thing is
 * usable on a phone, which is the brief's central constraint ("a user can open
 * it comfortably on a phone-sized screen"). So this drives a real browser at a
 * real phone viewport and writes PNGs to `screenshots/`.
 *
 * Uses the Chrome already installed on this machine (`channel: 'chrome'`) rather
 * than Playwright's own bundled Chromium, whose download is blocked here.
 *
 * Run with:  npm run screenshot        (dev server must already be running)
 */

import { mkdirSync } from 'node:fs'
import { chromium, type Browser } from 'playwright'

const BASE = process.env.SCREENSHOT_BASE_URL ?? 'http://localhost:3000'
const OUT = 'screenshots'

/** iPhone 14-ish. Narrow enough to catch real overflow, which a desktop
 *  viewport shrunk in devtools often hides. */
const PHONE = { width: 390, height: 844 }

const SHOTS = [
  { name: '01-feed', path: '/updates', fullPage: true },
  { name: '02-feed-filtered', path: '/updates?status=proposed', fullPage: true },
  { name: '03-detail-learn', path: '/updates/us-remote-work-presence-guidance', fullPage: true },
  {
    name: '04-detail-professional',
    path: '/updates/us-remote-work-presence-guidance?mode=professional',
    fullPage: true,
  },
  { name: '05-detail-null-status', path: '/updates/us-ca-nonresident-withholding-discussion', fullPage: true },
  { name: '06-vocabulary', path: '/vocabulary', fullPage: true },
  { name: '07-dashboard', path: '/dashboard', fullPage: true },
  { name: '08-assignments', path: '/assignments', fullPage: true },
  { name: '09-saved', path: '/saved', fullPage: true },
] as const

async function shoot(browser: Browser, colorScheme: 'light' | 'dark') {
  const context = await browser.newContext({
    viewport: PHONE,
    deviceScaleFactor: 2,
    colorScheme,
    isMobile: true,
    hasTouch: true,
  })
  const page = await context.newPage()

  // Surface client-side errors rather than silently shipping a broken page.
  const problems: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console: ${msg.text()}`)
  })
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`))

  for (const shot of SHOTS) {
    const response = await page.goto(`${BASE}${shot.path}`, { waitUntil: 'networkidle' })
    if (!response || !response.ok()) {
      problems.push(`${shot.path} -> HTTP ${response?.status() ?? 'no response'}`)
      continue
    }

    // Expand every <details> so citations appear in the capture — the whole
    // point of these screenshots is to show the provenance UI.
    await page.evaluate(() => {
      document.querySelectorAll('details').forEach((d) => d.setAttribute('open', ''))
    })

    if (shot.fullPage) {
      // In a full-page capture a `position: sticky` bar renders wherever it
      // happens to sit in the document, landing across the middle of the image
      // and hiding content. Hide it (and Next's dev-tools bubble) so the
      // capture shows the page rather than the artefacts of capturing it.
      await page.addStyleTag({
        content: `
          nav[aria-label="Main"] { display: none !important; }
          nextjs-portal, [data-nextjs-toast], #__next-build-watcher { display: none !important; }
        `,
      })
    }

    const file = `${OUT}/${colorScheme}-${shot.name}.png`
    await page.screenshot({ path: file, fullPage: shot.fullPage })
    console.log(`  ${file}`)
  }

  /* --- overflow check --------------------------------------------------
   * Horizontal scroll on a phone is the single most common mobile layout bug
   * and it is invisible in a screenshot, so assert it numerically. The filter
   * rails scroll horizontally by design, so measure the document, not children. */
  await page.goto(`${BASE}/updates`, { waitUntil: 'networkidle' })
  const overflow = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }))
  if (overflow.documentWidth > overflow.viewportWidth + 1) {
    problems.push(
      `horizontal overflow: document is ${overflow.documentWidth}px wide in a ${overflow.viewportWidth}px viewport`,
    )
  }

  await context.close()
  return problems
}

async function main() {
  mkdirSync(OUT, { recursive: true })

  const browser = await chromium.launch({ channel: 'chrome' })
  try {
    const light = await shoot(browser, 'light')
    const dark = await shoot(browser, 'dark')
    const problems = [...new Set([...light, ...dark])]

    if (problems.length > 0) {
      console.error(`\n${problems.length} problem(s):`)
      for (const p of problems) console.error(`  - ${p}`)
      process.exitCode = 1
    } else {
      console.log('\nNo console errors, no page errors, no horizontal overflow.')
    }
  } finally {
    await browser.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
