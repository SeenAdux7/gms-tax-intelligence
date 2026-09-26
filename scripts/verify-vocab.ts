/**
 * Drive the vocabulary section and assert it behaves
 * ==================================================
 *
 * The interesting behaviours here are invisible from the page, so this checks
 * the database through a dev-only endpoint as well as the UI:
 *
 *   - Saving a term and an update actually persists, and both show up in Saved.
 *   - Flagging a term difficult is INDEPENDENT of bookmarking it — the bug this
 *     catches is un-saving a term silently dropping its difficulty flag and
 *     removing it from the review queue.
 *   - A correct practice answer pushes the term further out; a wrong one brings
 *     it back tomorrow. That is the whole point of spaced repetition and it is
 *     easy to get backwards.
 *   - Review only offers terms that need work, and an empty queue reads as
 *     success rather than as an error.
 *
 * Run with:  npm run verify:vocab   (dev server must be running)
 */

import { mkdirSync } from 'node:fs'
import { chromium, type Page } from 'playwright'

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

type DebugState = {
  bookmarkedDevelopments: number
  bookmarkedTerms: number
  difficultTerms: number
  reviewRows: number
  schedule: { correctStreak: number; incorrectCount: number; daysUntilDue: number | null }[]
}

async function debugState(page: Page): Promise<DebugState> {
  const res = await page.request.get(`${BASE}/api/debug/vocab`)
  return (await res.json()) as DebugState
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
    await page.request.delete(`${BASE}/api/debug/vocab`)
    await page.addInitScript(`
      window.addEventListener('DOMContentLoaded', () => {
        const s = document.createElement('style')
        s.textContent = 'nav[aria-label="Main"]{display:none!important}nextjs-portal{display:none!important}'
        document.head.appendChild(s)
      })
    `)

    /* --- browse -------------------------------------------------------- */
    await page.goto(`${BASE}/vocabulary`, { waitUntil: 'networkidle' })
    const browseText = (await page.locator('body').innerText()).toLowerCase()
    check('vocabulary page loads', browseText.includes('vocabulary'))
    check('shows all 16 terms', (await page.locator('main ul > li').count()) === 16)
    check('shows progress buckets', browseText.includes('not started'))
    check('offers the three modes', ['learn', 'practice', 'review'].every((m) => browseText.includes(m)))
    await page.screenshot({ path: `${OUT}/vocab-1-browse.png`, fullPage: true })

    /* --- category filter ---------------------------------------------- */
    await page.goto(`${BASE}/vocabulary?category=payroll`, { waitUntil: 'networkidle' })
    const payrollCount = await page.locator('main ul > li').count()
    check('category filter narrows the list', payrollCount > 0 && payrollCount < 16, `${payrollCount} terms`)

    /* --- search -------------------------------------------------------- */
    await page.goto(`${BASE}/vocabulary?q=shadow`, { waitUntil: 'networkidle' })
    check('search finds a term', (await page.locator('body').innerText()).includes('Shadow payroll'))

    /* --- term card ----------------------------------------------------- */
    await page.goto(`${BASE}/vocabulary/shadow-payroll`, { waitUntil: 'networkidle' })
    // Lowercased: `innerText` applies CSS `text-transform`, and the section
    // headings on this card are styled uppercase. Same trap as verify-lesson.
    const cardText = (await page.locator('body').innerText()).toLowerCase()
    check('term card shows the definition', cardText.includes('reporting-only payroll'))
    check('term card shows why it matters', cardText.includes('why it matters'))
    check('term card shows an example', cardText.includes('for example'))
    check('term card shows the misunderstanding', cardText.includes('commonly misunderstood'))
    check('term card shows related terms', cardText.includes('related terms'))
    check('term card links to updates that use it', cardText.includes('seen in these updates'))
    check(
      'absent formal definition is stated, not faked',
      cardText.includes('no formal source-based definition is recorded'),
    )
    await page.screenshot({ path: `${OUT}/vocab-2-term.png`, fullPage: true })

    /* --- save + difficulty are independent ----------------------------- */
    await page.getByRole('button', { name: /^Save$/ }).click()
    await page.waitForTimeout(600)
    let state = await debugState(page)
    check('saving a term persists', state.bookmarkedTerms === 1, JSON.stringify(state))

    await page.getByRole('button', { name: /Find this hard/ }).click()
    await page.waitForTimeout(600)
    state = await debugState(page)
    check('flagging difficult persists', state.difficultTerms === 1)
    check('flagging difficult also schedules the term', state.reviewRows === 1)

    // The key independence check: un-save while difficult is set.
    await page.reload({ waitUntil: 'networkidle' })
    await page.getByRole('button', { name: /^Saved$/ }).click()
    await page.waitForTimeout(600)
    state = await debugState(page)
    check('un-saving clears the bookmark', state.bookmarkedTerms === 0)
    check(
      'un-saving does NOT discard the difficulty flag',
      state.difficultTerms === 1,
      `difficultTerms=${state.difficultTerms}`,
    )

    /* --- saving an update ---------------------------------------------- */
    await page.goto(`${BASE}/updates/ie-sarp-extension`, { waitUntil: 'networkidle' })
    const updateText = (await page.locator('body').innerText()).toLowerCase()
    check('update page shows tappable terms', updateText.includes('terms worth knowing'))
    check('update page links to its lesson', updateText.includes('take the lesson'))
    await page.getByRole('button', { name: /^Save$/ }).click()
    await page.waitForTimeout(600)
    state = await debugState(page)
    check('saving an update persists', state.bookmarkedDevelopments === 1)

    /* --- saved tab ----------------------------------------------------- */
    await page.goto(`${BASE}/saved`, { waitUntil: 'networkidle' })
    const savedText = (await page.locator('body').innerText()).toLowerCase()
    check('Saved lists the bookmarked update', savedText.includes('special assignee relief'))
    check('Saved groups difficult terms separately', savedText.includes('terms you find difficult'))
    check('Saved shows the review prompt', savedText.includes('ready for review'))
    await page.screenshot({ path: `${OUT}/vocab-3-saved.png`, fullPage: true })

    /* --- learn deck ---------------------------------------------------- */
    await page.goto(`${BASE}/vocabulary/learn`, { waitUntil: 'networkidle' })
    check('learn deck starts at card 1', (await page.locator('body').innerText()).includes('Card 1 of 5'))
    await page.getByRole('button', { name: 'Next' }).click()
    await page.waitForTimeout(250)
    check('learn deck advances', (await page.locator('body').innerText()).includes('Card 2 of 5'))
    await page.screenshot({ path: `${OUT}/vocab-4-learn.png`, fullPage: true })

    /* --- practice: schedule must move the right way -------------------- */
    await page.request.delete(`${BASE}/api/debug/vocab`)
    await page.goto(`${BASE}/vocabulary/practice`, { waitUntil: 'networkidle' })
    const practiceText = await page.locator('body').innerText()
    check('practice asks a question', practiceText.includes('Question 1 of'))
    check(
      'practice states what is being asked',
      /which (term|definition)/i.test(practiceText),
    )

    // Answer correctly: click the option marked correct is not knowable from
    // the DOM before answering, so answer, read the result, and assert on the
    // schedule rather than on which button was right.
    await page.locator('main button').filter({ hasText: /\w/ }).first().click()
    await page.waitForTimeout(800)
    const afterFirst = await page.locator('body').innerText()
    const wasCorrect = afterFirst.includes('this term will come back less often')
    check('practice gives immediate feedback', /come back (less often|tomorrow)/.test(afterFirst))

    state = await debugState(page)
    const entry = state.schedule[0]
    check('practice writes a review row', state.reviewRows === 1, JSON.stringify(state))

    if (wasCorrect) {
      check(
        'a correct answer schedules the term at least a day out',
        entry.correctStreak === 1 && (entry.daysUntilDue ?? 0) >= 1,
        JSON.stringify(entry),
      )
    } else {
      check(
        'a wrong answer resets the streak and brings it back tomorrow',
        entry.correctStreak === 0 && entry.incorrectCount === 1 && (entry.daysUntilDue ?? -1) <= 1,
        JSON.stringify(entry),
      )
    }
    await page.screenshot({ path: `${OUT}/vocab-5-practice.png`, fullPage: true })

    /* --- review -------------------------------------------------------- */
    await page.goto(`${BASE}/vocabulary/review`, { waitUntil: 'networkidle' })
    const reviewText = await page.locator('body').innerText()
    check(
      'review either offers work or says nothing is due',
      reviewText.includes('Question 1 of') || reviewText.includes('Nothing due'),
    )

    // With everything cleared and only one term answered, 15 terms have never
    // been seen, so they are all due — review must offer questions.
    check('review offers the terms that need work', reviewText.includes('Question 1 of'))
    await page.screenshot({ path: `${OUT}/vocab-6-review.png`, fullPage: true })

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
