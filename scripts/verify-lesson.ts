/**
 * Drive the lesson flow and assert it behaves
 * ===========================================
 *
 * The lesson is the only genuinely interactive part of the app, so a 200
 * response tells us almost nothing. This walks a real browser through all five
 * stages of a real lesson and asserts the behaviours that matter:
 *
 *   - Stage 2 refuses to advance until every question is answered.
 *   - Answers lock once stage 3 is reached (so the score means something).
 *   - Stage 3 reveals the correct answer, the quote behind it, and why a
 *     chosen wrong answer was weaker.
 *   - An "insufficient information" answer shows the absence explanation
 *     instead of a quote — because there is no quote to show.
 *   - The attempt is persisted server-side.
 *
 * It answers the FIRST question wrong on purpose. The wrong path is the one
 * with more to go wrong in it, and it is the path a learner will actually take.
 *
 * Run with:  npm run verify:lesson   (dev server must be running)
 */

import { mkdirSync } from 'node:fs'
import { chromium, type Page } from 'playwright'

const BASE = process.env.SCREENSHOT_BASE_URL ?? 'http://localhost:3000'
const OUT = 'screenshots'
const PHONE = { width: 390, height: 844 }

/** The US lesson: has an "insufficient information" correct answer at Q2. */
const LESSON = '/learn/us-remote-work-presence-guidance'

const failures: string[] = []

function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  PASS  ${label}`)
  } else {
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
    failures.push(label)
  }
}

async function nextButton(page: Page) {
  // The primary control is the last button in the sticky footer.
  return page.locator('button', { hasText: /^(Next|Finished|Answer the questions)/ }).last()
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
    // Start from a known state. Attempts accumulate, so without this the
    // correctness assertion below drifts on every subsequent run.
    await page.request.delete(`${BASE}/api/debug/attempts`)

    // Full-page captures render sticky elements wherever they sit in the
    // document, so the tab bar lands across the middle of the image. Applied
    // via init script so it survives every navigation in this run.
    await page.addInitScript(`
      window.addEventListener('DOMContentLoaded', () => {
        const style = document.createElement('style')
        style.textContent =
          'nav[aria-label="Main"]{display:none!important}' +
          'nextjs-portal,[data-nextjs-toast]{display:none!important}'
        document.head.appendChild(style)
      })
    `)

    /* --- stage 1 ------------------------------------------------------ */
    await page.goto(`${BASE}${LESSON}`, { waitUntil: 'networkidle' })
    check('stage 1 loads', await page.getByText('Step 1 of 5').isVisible())
    check(
      'stage 1 shows plain-language explanation',
      (await page.locator('body').innerText()).includes('One hour counts the same as ten'),
    )
    await page.screenshot({ path: `${OUT}/lesson-1-what-happened.png`, fullPage: true })

    /* --- stage 2 ------------------------------------------------------ */
    await (await nextButton(page)).click()
    check('advances to stage 2', await page.getByText('Step 2 of 5').isVisible())

    const radios = page.locator('input[type="radio"]')
    const radioCount = await radios.count()
    check('questions rendered with options', radioCount >= 6, `found ${radioCount} radios`)

    // The gate: cannot advance with nothing answered.
    const gated = await (await nextButton(page)).isDisabled()
    check('stage 2 blocks advancing with no answers', gated)

    // Answer Q1 WRONG on purpose. Q1's first option is the correct one, so
    // pick the second.
    const q1 = page.locator('fieldset').nth(0)
    await q1.locator('input[type="radio"]').nth(1).check()

    const stillGated = await (await nextButton(page)).isDisabled()
    check('still blocked with only one of two questions answered', stillGated)

    // Answer Q2 correctly — its first option is the "not enough information" one.
    const q2 = page.locator('fieldset').nth(1)
    await q2.locator('input[type="radio"]').nth(0).check()

    const nowOpen = await (await nextButton(page)).isEnabled()
    check('unblocks once every question is answered', nowOpen)
    await page.screenshot({ path: `${OUT}/lesson-2-questions.png`, fullPage: true })

    /* --- stage 3 ------------------------------------------------------ */
    await (await nextButton(page)).click()
    check('advances to stage 3', await page.getByText('Step 3 of 5').isVisible())

    // Lowercased throughout: `innerText` applies CSS `text-transform`, so any
    // label styled `uppercase` comes back shouting and a case-sensitive
    // comparison fails for no real reason.
    const stage3 = (await page.locator('body').innerText()).toLowerCase()
    check('reports the score', /of 2/.test(stage3))
    check('flags the wrong answer without scolding', stage3.includes('not the strongest answer'))
    check('confirms the right answer', stage3.includes('you had it right'))
    check('shows the strongest answer', stage3.includes('strongest answer'))
    check(
      'shows the verbatim quote for the evidence-backed answer',
      stage3.includes('regardless of the number of hours worked'),
    )
    check(
      'explains the absence for the insufficient-information answer',
      stage3.includes('that absence is the answer'),
    )
    check('explains why the chosen wrong option was weaker', stage3.includes('you chose'))
    check('gives the reasoning', stage3.includes('why'))

    // Answers must be locked now.
    const lockedCount = await page.locator('fieldset[disabled] input[type="radio"]').count()
    await (await page.locator('button', { hasText: 'Back' }).last()).click()
    const backAtStage2 = await page.getByText('Step 2 of 5').isVisible()
    const disabledAfterBack = await page.locator('fieldset[disabled]').count()
    check(
      'answers are locked after seeing the explanations',
      backAtStage2 && disabledAfterBack >= 2,
      `disabled fieldsets: ${disabledAfterBack}, locked radios on stage 3: ${lockedCount}`,
    )
    await (await nextButton(page)).click()
    await page.screenshot({ path: `${OUT}/lesson-3-answers.png`, fullPage: true })

    /* --- stage 4 ------------------------------------------------------ */
    await (await nextButton(page)).click()
    check('advances to stage 4', await page.getByText('Step 4 of 5').isVisible())
    const stage4 = await page.locator('body').innerText()
    check('labels the client as fictional', stage4.includes('Fictional client'))
    check('presents a scenario', stage4.includes('Delta Harbour'))
    check('asks what facts are needed', stage4.includes('what facts would I need'))
    await page.screenshot({ path: `${OUT}/lesson-4-apply.png`, fullPage: true })

    /* --- stage 5 ------------------------------------------------------ */
    await (await nextButton(page)).click()
    check('advances to stage 5', await page.getByText('Step 5 of 5').isVisible())
    const stage5 = await page.locator('body').innerText()
    check('gives a professional summary', stage5.includes('substantial presence test'))
    check('states the uncertainty explicitly', stage5.includes('No effective date is stated'))
    check('links back to the update and its sources', stage5.includes('See the full update'))
    await page.screenshot({ path: `${OUT}/lesson-5-summary.png`, fullPage: true })

    /* --- swipe --------------------------------------------------------
     * Playwright has no swipe primitive, so the touch sequence is dispatched
     * directly. Passed as a STRING rather than a function: tsx compiles
     * functions through esbuild, which injects a `__name` helper that does not
     * exist in the browser context, and the evaluate fails with
     * `ReferenceError: __name is not defined`. A string is handed over
     * untransformed. */
    await page.evaluate(`
      (() => {
        // Dispatch on a node INSIDE the flow container, not on body. The
        // handler sits on the flow div, and events bubble up — a touch on
        // body is an ancestor and never reaches it.
        const el = document.querySelector('h1')
        const at = (x) => [new Touch({ identifier: 1, target: el, clientX: x, clientY: 400 })]
        el.dispatchEvent(new TouchEvent('touchstart', { touches: at(80), bubbles: true }))
        el.dispatchEvent(new TouchEvent('touchend', { changedTouches: at(300), bubbles: true }))
      })()
    `)
    await page.waitForTimeout(300)
    check('swiping right goes back a stage', await page.getByText('Step 4 of 5').isVisible())

    /* --- keyboard ----------------------------------------------------- */
    // Click the heading, not a control: the handler deliberately ignores arrow
    // keys while focus is inside a button or input.
    await page.locator('h1').click()
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(300)
    check('arrow key advances a stage', await page.getByText('Step 5 of 5').isVisible())

    /* --- persistence -------------------------------------------------- */
    const attempts = await page.request.get(`${BASE}/api/debug/attempts`)
    if (attempts.ok()) {
      const body = (await attempts.json()) as { count: number; correct: number }
      check('attempts persisted server-side', body.count >= 2, `count=${body.count}`)
      check('server recomputed correctness (1 of 2)', body.correct === 1, `correct=${body.correct}`)
    } else {
      check('attempts endpoint reachable', false, `HTTP ${attempts.status()}`)
    }

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
