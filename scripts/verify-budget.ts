/**
 * Verifies the spend ceiling actually stops paid calls
 * ====================================================
 *
 * The ceiling is the only brake available on a shared or institutional plan
 * where the billing page is out of reach, so "it looks right" is not good
 * enough. This records fake spend, confirms the gate refuses, and cleans up.
 *
 * Costs nothing and needs no API key.
 *
 * Run with:  npm run verify:budget
 */

import '../pipeline/env'
import { sql } from 'drizzle-orm'
import { db } from '../db/index'
import { processingRuns } from '../db/schema'
import { assertWithinBudget, checkBudget, describeBudget, spendLimit } from '../pipeline/budget'

const MARKER = '31.415900'
const failures: string[] = []

function check(label: string, condition: boolean, detail?: string) {
  if (condition) console.log(`  PASS  ${label}`)
  else {
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
    failures.push(label)
  }
}

async function cleanup() {
  await db.delete(processingRuns).where(sql`${processingRuns.costUsd} = ${MARKER}`)
}

async function main() {
  console.log('\nSpend ceiling:')

  await cleanup()

  /* --- limit parsing -------------------------------------------------- */

  const original = process.env.MAX_TOTAL_SPEND_USD

  process.env.MAX_TOTAL_SPEND_USD = '50'
  check('a valid override is used', spendLimit() === 50)

  // The important cases: a malformed limit must NOT become "no limit".
  process.env.MAX_TOTAL_SPEND_USD = ''
  check('an empty limit falls back to the default, not zero', spendLimit() === 20)

  process.env.MAX_TOTAL_SPEND_USD = 'abc'
  check('a non-numeric limit falls back to the default, not NaN', spendLimit() === 20)

  process.env.MAX_TOTAL_SPEND_USD = '-5'
  check('a negative limit falls back to the default', spendLimit() === 20)

  if (original === undefined) delete process.env.MAX_TOTAL_SPEND_USD
  else process.env.MAX_TOTAL_SPEND_USD = original

  /* --- the gate ------------------------------------------------------- */

  const before = await checkBudget()
  check('starts under the ceiling', !before.exceeded, describeBudget(before))

  let allowed = false
  try {
    await assertWithinBudget('a paid call')
    allowed = true
  } catch {
    allowed = false
  }
  check('a paid call is allowed while under the ceiling', allowed)

  // Record fake spend well above the ceiling.
  await db.insert(processingRuns).values({ trigger: 'manual', costUsd: MARKER })

  const after = await checkBudget()
  check('recorded spend is counted', after.spent >= 31, describeBudget(after))
  check('the ceiling reads as exceeded', after.exceeded)

  let blocked = false
  let message = ''
  try {
    await assertWithinBudget('a paid call')
  } catch (error) {
    blocked = true
    message = error instanceof Error ? error.message : String(error)
  }
  check('a paid call is BLOCKED once the ceiling is reached', blocked)
  check(
    'the error explains this is an app brake, not the account balance',
    message.includes('not your account balance'),
  )
  check('the error says how to raise it', message.includes('MAX_TOTAL_SPEND_USD'))

  await cleanup()

  const restored = await checkBudget()
  check('cleanup restored the original state', !restored.exceeded, describeBudget(restored))

  console.log('')
  if (failures.length > 0) {
    console.error(`${failures.length} check(s) failed.`)
    process.exit(1)
  }
  console.log('All budget checks passed.')
  process.exit(0)
}

main().catch(async (error) => {
  await cleanup().catch(() => {})
  console.error(error)
  process.exit(1)
})
