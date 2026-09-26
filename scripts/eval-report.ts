/** Last recorded evaluation results. Reads stored rows; costs nothing. */
import '../pipeline/env'
import { desc, eq } from 'drizzle-orm'
import { db } from '../db/index'
import { evalRuns, evalSamples } from '../db/schema'

type FieldScore = { field: string; verdict: string; expected: unknown; actual: unknown }

async function main() {
  const rows = await db
    .select({
      label: evalSamples.label,
      notes: evalSamples.notes,
      model: evalRuns.model,
      ranAt: evalRuns.ranAt,
      passed: evalRuns.passed,
      fieldScores: evalRuns.fieldScores,
      cost: evalRuns.costUsd,
    })
    .from(evalRuns)
    .innerJoin(evalSamples, eq(evalRuns.sampleId, evalSamples.id))
    .orderBy(desc(evalRuns.ranAt))

  if (rows.length === 0) {
    console.log('No evaluation runs recorded.')
    return
  }

  const latest = new Map<string, (typeof rows)[number]>()
  for (const r of rows) if (!latest.has(r.label)) latest.set(r.label, r)

  const tally: Record<string, number> = {}
  let cost = 0

  for (const r of latest.values()) {
    console.log(`${r.passed ? 'PASS' : 'FAIL'}  ${r.label}`)
    for (const f of r.fieldScores as FieldScore[]) {
      tally[f.verdict] = (tally[f.verdict] ?? 0) + 1
      if (f.verdict === 'correct' || f.verdict === 'correct_abstention') continue
      console.log(
        `        ${f.verdict.toUpperCase().padEnd(10)} ${f.field}`,
      )
      console.log(`          expected ${JSON.stringify(f.expected)}`)
      console.log(`          got      ${JSON.stringify(f.actual)}`)
    }
    cost += Number(r.cost ?? 0)
  }

  console.log('')
  console.log(`samples                ${latest.size}`)
  console.log(`passed                 ${[...latest.values()].filter((r) => r.passed).length}/${latest.size}`)
  console.log(`fields correct         ${tally.correct ?? 0}`)
  console.log(`correct abstentions    ${tally.correct_abstention ?? 0}  <- said "not stated" when it was not stated`)
  console.log(`FABRICATIONS           ${tally.fabricated ?? 0}  <- invented a fact the source lacks`)
  console.log(`missed                 ${tally.missed ?? 0}`)
  console.log(`wrong                  ${tally.wrong ?? 0}`)
  console.log(`cost                   $${cost.toFixed(4)}`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
