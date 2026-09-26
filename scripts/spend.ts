/**
 * Where the money went
 * ====================
 *
 * Reports every recorded API cost, broken down by source and by run, against
 * the application spend ceiling. Reads only stored rows — costs nothing and
 * needs no key.
 *
 * Exists because "how much has this used?" is a question you should be able to
 * answer without logging into a provider console, particularly on a shared
 * plan where you may not have access to the billing page at all.
 *
 * Run with:  npm run spend
 */

import '../pipeline/env'
import { desc, eq, sql } from 'drizzle-orm'
import { db } from '../db/index'
import { evalRuns, evalSamples, processingRuns, sources } from '../db/schema'
import { checkBudget, describeBudget } from '../pipeline/budget'

async function main() {
  const status = await checkBudget()

  console.log('Recorded API spend by this application\n')
  console.log(`  ${describeBudget(status)}`)
  if (status.exceeded) {
    console.log('\n  CEILING REACHED — paid stages will refuse to run.')
    console.log('  Raise it in .env.local:  MAX_TOTAL_SPEND_USD=50')
  }
  console.log('')

  /* --- collection, by source ----------------------------------------- */

  const bySource = await db
    .select({
      name: sources.name,
      runs: sql<number>`count(*)::int`,
      notModified: sql<number>`count(*) filter (where ${processingRuns.notModified} = true)::int`,
      published: sql<number>`coalesce(sum(${processingRuns.itemsPublished}), 0)::int`,
      cost: sql<number>`coalesce(sum(${processingRuns.costUsd}), 0)::float`,
    })
    .from(processingRuns)
    .leftJoin(sources, eq(processingRuns.sourceId, sources.id))
    .groupBy(sources.name)
    .orderBy(desc(sql`coalesce(sum(${processingRuns.costUsd}), 0)`))

  if (bySource.length === 0) {
    console.log('  Collection: never run.')
  } else {
    console.log('  Collection, by source:')
    console.log('    ' + 'source'.padEnd(46) + 'runs   304s  published      cost')
    for (const row of bySource) {
      console.log(
        '    ' +
          (row.name ?? '(unknown)').slice(0, 45).padEnd(46) +
          String(row.runs).padStart(4) +
          String(row.notModified).padStart(7) +
          String(row.published).padStart(11) +
          ('$' + row.cost.toFixed(4)).padStart(10),
      )
    }
    const total = bySource.reduce((sum, r) => sum + r.cost, 0)
    const freeRuns = bySource.reduce((sum, r) => sum + r.notModified, 0)
    console.log(`\n    ${freeRuns} of those runs were 304 Not Modified and cost nothing.`)
    console.log(`    Collection total: $${total.toFixed(4)}`)
  }

  /* --- evaluation ----------------------------------------------------- */

  const evals = await db
    .select({
      label: evalSamples.label,
      model: evalRuns.model,
      ranAt: evalRuns.ranAt,
      passed: evalRuns.passed,
      cost: sql<number>`coalesce(${evalRuns.costUsd}, 0)::float`,
    })
    .from(evalRuns)
    .innerJoin(evalSamples, eq(evalRuns.sampleId, evalSamples.id))
    .orderBy(desc(evalRuns.ranAt))
    .limit(20)

  console.log('')
  if (evals.length === 0) {
    console.log('  Evaluation: never run. (npm run eval)')
  } else {
    console.log('  Evaluation runs (most recent 20):')
    for (const row of evals) {
      console.log(
        `    ${row.passed ? 'pass' : 'FAIL'}  ${row.label.slice(0, 40).padEnd(41)}` +
          `${row.model.padEnd(18)}$${row.cost.toFixed(4)}`,
      )
    }
    const total = evals.reduce((sum, r) => sum + r.cost, 0)
    console.log(`\n    Evaluation total (shown): $${total.toFixed(4)}`)
  }

  /* --- what things cost ----------------------------------------------- */

  console.log('\n  For reference:')
  console.log('    check:key       ~$0.0004')
  console.log('    collect:dry      $0        (no AI calls at all)')
  console.log('    collect:one     ~$0.10')
  console.log('    eval            ~$0.60     (six documents)')
  console.log('    collect         ~$1-2      (up to 25 articles)')
  console.log('    hourly, ongoing ~$25/month')

  console.log('\n  Note: this counts only what THIS application recorded. It cannot see')
  console.log('  other usage on the same account.')
  console.log('\nDone.')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\nFailed:', error instanceof Error ? error.message : error)
    process.exit(1)
  })
