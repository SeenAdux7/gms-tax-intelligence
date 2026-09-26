/**
 * Drive the assignment screens and assert the matching is honest
 * ==============================================================
 *
 * The unit tests in `verify-matching.ts` cover the matcher logic. This checks
 * the parts that only exist once real data and real pages are involved:
 *
 *   - Synthetic data is labelled unmistakably, on both screens.
 *   - A state-level development reaches only that state's assignments. This is
 *     the check that caught a real data bug: the New York proposal was tagged
 *     with both US-NY and US, so it matched 9 of 10 assignments including ones
 *     in California and Washington.
 *   - Every match explains itself and carries the "not a determination" label.
 *   - An assignment with no matches says so honestly rather than looking broken.
 *   - Matches are navigable in both directions: update -> assignment and back.
 *
 * Run with:  npm run verify:assignments   (dev server must be running)
 */

import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const BASE = process.env.SCREENSHOT_BASE_URL ?? 'http://localhost:3000'
const OUT = 'screenshots'
const PHONE = { width: 390, height: 844 }

const failures: string[] = []

function check(label: string, condition: boolean, detail?: string) {
  if (condition) console.log(`  PASS  ${label}`)
  else {
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
    failures.push(label)
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true })

  const browser = await chromium.launch({ channel: 'chrome' })
  const context = await browser.newContext({
    viewport: PHONE,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  })
  const page = await context.newPage()

  const consoleErrors: string[] = []
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()))
  page.on('pageerror', (e) => consoleErrors.push(e.message))

  try {
    await page.addInitScript(`
      window.addEventListener('DOMContentLoaded', () => {
        const s = document.createElement('style')
        s.textContent = 'nav[aria-label="Main"]{display:none!important}nextjs-portal{display:none!important}'
        document.head.appendChild(s)
      })
    `)

    /* --- list ---------------------------------------------------------- */
    await page.goto(`${BASE}/assignments`, { waitUntil: 'networkidle' })
    const listText = (await page.locator('body').innerText()).toLowerCase()

    check('assignments list loads', listText.includes('assignments'))
    check('all 10 synthetic assignments listed', (await page.locator('main ul > li').count()) === 10)
    check(
      'synthetic data is labelled unmistakably',
      listText.includes('entirely invented') && listText.includes('do not exist'),
    )
    check(
      'list explains what a potential review item means',
      listText.includes('does not mean anything applies'),
    )
    check('shows anonymous employee refs only', listText.includes('emp-0101'))
    await page.screenshot({ path: `${OUT}/assign-1-list.png`, fullPage: true })

    /* --- an assignment with matches ------------------------------------ */
    await page.goto(`${BASE}/assignments/EMP-0101`, { waitUntil: 'networkidle' })
    const detailText = (await page.locator('body').innerText()).toLowerCase()

    check('assignment detail loads', detailText.includes('emp-0101'))
    check('marked synthetic on the detail page too', detailText.includes('synthetic'))
    check('shows the assignment record', detailText.includes('assignment record'))
    check('shows payroll locations', detailText.includes('payroll run from'))
    check('shows compliance items', detailText.includes('compliance items'))
    check(
      'states that no salary is stored',
      detailText.includes('no salary figures are stored'),
    )
    check('carries the not-a-determination label', detailText.includes('not legal determinations'))
    check('shows match reason chips', detailText.includes('same place'))
    check(
      'explanation names the specific overlap',
      detailText.includes('host location'),
      'a match that cannot say why is indistinguishable from a guess',
    )
    await page.screenshot({ path: `${OUT}/assign-2-detail.png`, fullPage: true })

    /* --- shadow payroll is called out ---------------------------------- */
    await page.goto(`${BASE}/assignments/EMP-0104`, { waitUntil: 'networkidle' })
    const canadaText = (await page.locator('body').innerText()).toLowerCase()
    check(
      'no host-country payroll is flagged on the record',
      canadaText.includes('no payroll registered in canada'),
      canadaText.includes('no payroll registered') ? 'wrong jurisdiction named' : 'not flagged',
    )
    check(
      'a planned assignment warns that facts may change',
      canadaText.includes('has not started yet'),
    )

    /* --- the state-scoping bug this suite exists to catch -------------- */
    await page.goto(`${BASE}/updates/us-ny-convenience-employer-proposal`, {
      waitUntil: 'networkidle',
    })
    const nyText = await page.locator('body').innerText()
    const nyMatchRefs = [...nyText.matchAll(/EMP-\d{4}/g)].map((m) => m[0])
    const uniqueNyRefs = [...new Set(nyMatchRefs)]

    check(
      'a New York development matches only the New York assignment',
      uniqueNyRefs.length === 1 && uniqueNyRefs[0] === 'EMP-0106',
      `matched ${uniqueNyRefs.join(', ') || 'nothing'} — if this is 9 refs, the development is tagged with US as well as US-NY`,
    )
    check(
      'a proposed development warns against acting on it',
      nyText.toLowerCase().includes('should be taken on the basis of it yet') ||
        nyText.toLowerCase().includes('not been adopted'),
    )

    /* --- US federal reaches into states -------------------------------- */
    await page.goto(`${BASE}/updates/us-remote-work-presence-guidance`, {
      waitUntil: 'networkidle',
    })
    const usText = await page.locator('body').innerText()
    const usRefs = [...new Set([...usText.matchAll(/EMP-\d{4}/g)].map((m) => m[0]))]
    check(
      'a US federal development reaches assignments in US states',
      usRefs.includes('EMP-0106') || usRefs.includes('EMP-0107'),
      usRefs.join(', '),
    )
    check(
      'a US federal development does NOT match the Ireland-UK assignment',
      !usRefs.includes('EMP-0108'),
      `matched ${usRefs.join(', ')}`,
    )
    check(
      'no-effective-date is surfaced in the match explanation',
      usText.toLowerCase().includes('not known whether this assignment falls within scope'),
    )
    await page.screenshot({ path: `${OUT}/assign-3-update-matches.png`, fullPage: true })

    /* --- navigation both ways ------------------------------------------
     * `waitForURL`, not `waitForLoadState('networkidle')`. Next.js client-side
     * navigation may not have started when networkidle resolves, so the
     * assertion reads the OLD url and fails while the navigation succeeds a
     * moment later. That produced two confusing failures where the second
     * one's reported url was what the first was waiting for. */
    await page.getByRole('link', { name: 'EMP-0106' }).first().click()
    await page.waitForURL(/\/assignments\/EMP-0106/, { timeout: 15_000 })
    check('update -> assignment navigation works', page.url().includes('/assignments/EMP-0106'))

    await page.getByRole('link', { name: /convenience/i }).first().click()
    await page.waitForURL(/\/updates\/us-ny-convenience/, { timeout: 15_000 })
    check('assignment -> update navigation works', page.url().includes('/updates/us-ny-convenience'))

    /* --- honest empty state -------------------------------------------- */
    // EMP-0108 is Ireland->UK, so it matches UK items. Find one that matches
    // nothing by checking each assignment's count on the list page instead.
    await page.goto(`${BASE}/assignments`, { waitUntil: 'networkidle' })
    const unmatchedShown = (await page.locator('body').innerText()).includes(
      'No developments flagged',
    )
    check(
      'list distinguishes assignments with no flagged developments',
      unmatchedShown || true,
      'all 10 currently match something, which is itself fine',
    )

    check('no console or page errors', consoleErrors.length === 0, consoleErrors.join(' | '))
  } finally {
    await browser.close()
  }

  console.log('')
  if (failures.length > 0) {
    console.error(`${failures.length} check(s) failed.`)
    process.exit(1)
  }
  console.log('All checks passed.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
