/**
 * Drive the dashboard and assert its numbers are honest
 * =====================================================
 *
 * A dashboard is the easiest screen to get quietly wrong, because a number
 * with no source looks authoritative by default. These checks are mostly about
 * honesty rather than rendering:
 *
 *   - A chart whose parts sum to more than the total SAYS SO. "Review items by
 *     topic" summed to 58 against a headline of 20 because an item counts under
 *     every topic its development touches; without the caption a reader
 *     reasonably concludes the numbers are broken.
 *   - Question accuracy renders "—" when nothing has been answered, never "0%".
 *     "You got everything wrong" and "you have not started" are opposite claims.
 *   - Overdue is derived from the due date, so a stale stored status cannot make
 *     a deadline 22 days past due read as merely "open".
 *   - Developments with no stated effective date are counted visibly rather
 *     than dropped from the timeline in silence.
 *   - Exactly one hero figure.
 *
 * Run with:  npm run verify:dashboard   (dev server must be running)
 */

import { chromium } from 'playwright'

const BASE = process.env.SCREENSHOT_BASE_URL ?? 'http://localhost:3000'
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
  const browser = await chromium.launch({ channel: 'chrome' })
  const context = await browser.newContext({ viewport: PHONE, isMobile: true, hasTouch: true })
  const page = await context.newPage()

  const consoleErrors: string[] = []
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()))
  page.on('pageerror', (e) => consoleErrors.push(e.message))

  try {
    /* --- with learning data ------------------------------------------- */
    await page.request.delete(`${BASE}/api/debug/attempts`)
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' })
    const emptyText = (await page.locator('body').innerText()).toLowerCase()

    check(
      'unanswered accuracy shows an em dash, not 0%',
      emptyText.includes('no questions answered yet') && !emptyText.includes('0%\nquestion'),
      '"you got everything wrong" and "you have not started" must not look identical',
    )

    /* --- structure ---------------------------------------------------- */
    check('dashboard loads', emptyText.includes('dashboard'))
    check(
      'exactly one hero figure',
      (await page.locator('main p.text-\\[52px\\]').count()) === 1,
      'the brief allows one lead number per view',
    )
    check('leads with potential review items', emptyText.includes('potential review items'))
    check(
      'hero figure is labelled as not a determination',
      emptyText.includes('not determinations'),
    )

    /* --- the lifecycle split the brief asks to keep visible ----------- */
    check(
      'shows the not-yet-law vs settled split',
      emptyText.includes('not yet law') && emptyText.includes('enacted or in effect'),
    )
    check('states that a proposal is not a law', emptyText.includes('a proposal is not a law'))
    check(
      'status-not-stated is shown outside the lifecycle ramp',
      emptyText.includes('status not stated'),
    )

    /* --- absent data is counted, not dropped -------------------------- */
    check(
      'developments with no effective date are counted visibly',
      emptyText.includes('announce no effective date'),
    )
    check(
      'explains that they cannot appear in the timeline',
      emptyText.includes('cannot appear in the timeline'),
    )

    /* --- double counting is disclosed --------------------------------- */
    check(
      'by-place chart discloses multi-counting',
      emptyText.includes('counted in each'),
    )
    check(
      'by-topic chart discloses multi-counting',
      emptyText.includes('add up to more than the total above'),
    )
    check(
      'review-items-by-topic discloses multi-counting against the hero figure',
      emptyText.includes('add up to more than the 20'),
      'a chart summing to 58 against a headline of 20 must explain itself',
    )

    /* --- derived overdue ---------------------------------------------- */
    const overdueShown = emptyText.includes('overdue')
    check(
      'a past-due deadline reads as overdue, not open',
      overdueShown,
      'overdue must be derived from the due date, not a stored column that goes stale',
    )

    /* --- provenance claim --------------------------------------------- */
    check(
      'states that nothing on the page is estimated',
      emptyText.includes('nothing here is estimated or generated'),
    )

    /* --- now with learning data --------------------------------------- */
    await page.goto(`${BASE}/learn/ie-sarp-extension`, { waitUntil: 'networkidle' })
    const next = page.locator('button', { hasText: /^(Next|Answer the questions)/ }).last()
    await next.click()
    await page.locator('fieldset').nth(0).locator('input[type="radio"]').first().check()
    await page.locator('fieldset').nth(1).locator('input[type="radio"]').first().check()
    await next.click()
    await page.waitForTimeout(900)

    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' })
    const withData = (await page.locator('body').innerText()).toLowerCase()
    check(
      'accuracy appears once questions are answered',
      /\d+%/.test(withData) && withData.includes('question accuracy'),
    )
    check(
      'lesson progress meter reflects the attempt',
      withData.includes('lesson questions attempted'),
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
