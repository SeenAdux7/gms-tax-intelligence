/**
 * Compute development-to-assignment matches
 * =========================================
 *
 * Runs the deterministic matcher over every approved development against every
 * synthetic assignment and stores the results.
 *
 * Precomputed rather than evaluated per page load, for three reasons that all
 * matter more than the saved milliseconds:
 *
 *   1. The dashboard needs to COUNT potentially affected employees across the
 *      whole population. Doing that live would mean matching everything on
 *      every page view.
 *   2. A stored match can carry a review status ("open", "under review",
 *      "completed"), which is a compliance workflow the brief asks for. A
 *      match recomputed on each request has nowhere to keep that.
 *   3. It is reproducible and auditable. The stored explanation is the one the
 *      user actually saw, which matters when the rules later change.
 *
 * Idempotent: clears and recomputes. Cheap, because it is pure set arithmetic
 * with no API calls — 6 developments x 10 assignments is 60 comparisons.
 *
 * Run with:  npm run db:match
 */

// MUST be the first import. db/index.ts decides between Neon and PGlite by
// reading DATABASE_URL at module load, so the env file has to be loaded before
// that module is evaluated. Without this the script silently writes to the
// LOCAL database and reports success — which is exactly what happened: the
// schema went to Neon (drizzle.config.ts loads .env.local itself) while every
// seeded row went to PGlite.
import '../pipeline/env'
import { eq } from 'drizzle-orm'
import { db } from './index'
import {
  assignments,
  developmentAssignmentMatches,
  developmentJurisdictions,
  developmentPopulations,
  developments,
  developmentTopics,
} from './schema'
import { matchAssignments, type MatchableAssignment, type MatchableDevelopment } from '../app/lib/matching'
import type { AffectedPopulation, DevelopmentStatus, Topic } from '../app/lib/labels'

async function main() {
  console.log('Computing development-to-assignment matches...\n')
  console.log('  Reminder: stop `npm run dev` first (PGlite is single-process).\n')

  const developmentRows = await db
    .select({
      id: developments.id,
      slug: developments.slug,
      headline: developments.headline,
      status: developments.status,
      effectiveAt: developments.effectiveAt,
    })
    .from(developments)
    .where(eq(developments.reviewState, 'approved'))

  const assignmentRows = await db.select().from(assignments)

  if (developmentRows.length === 0 || assignmentRows.length === 0) {
    console.log('  Nothing to match. Run db:seed:content and db:seed:assignments first.')
    return
  }

  const population: MatchableAssignment[] = assignmentRows.map((a) => ({
    employeeRef: a.employeeRef,
    homeJurisdiction: a.homeJurisdiction,
    hostJurisdiction: a.hostJurisdiction,
    startDate: a.startDate,
    endDate: a.endDate,
    type: a.type,
    status: a.status,
    payrollLocations: a.payrollLocations,
    compensationCategories: a.compensationCategories,
    benefits: a.benefits,
  }))

  const assignmentIdByRef = new Map(assignmentRows.map((a) => [a.employeeRef, a.id]))

  await db.delete(developmentAssignmentMatches)

  let totalMatches = 0
  const affectedRefs = new Set<string>()

  for (const development of developmentRows) {
    const [jurisdictionRows, topicRows, populationRows] = await Promise.all([
      db
        .select({ code: developmentJurisdictions.jurisdictionCode })
        .from(developmentJurisdictions)
        .where(eq(developmentJurisdictions.developmentId, development.id)),
      db
        .select({ topic: developmentTopics.topic })
        .from(developmentTopics)
        .where(eq(developmentTopics.developmentId, development.id)),
      db
        .select({ population: developmentPopulations.population })
        .from(developmentPopulations)
        .where(eq(developmentPopulations.developmentId, development.id)),
    ])

    const matchable: MatchableDevelopment = {
      slug: development.slug,
      headline: development.headline,
      status: development.status as DevelopmentStatus | null,
      jurisdictionCodes: [...new Set(jurisdictionRows.map((j) => j.code))],
      topics: [...new Set(topicRows.map((t) => t.topic as Topic))],
      populations: [...new Set(populationRows.map((p) => p.population as AffectedPopulation))],
      effectiveAt: development.effectiveAt,
    }

    const matches = matchAssignments(matchable, population)

    for (const match of matches) {
      const assignmentId = assignmentIdByRef.get(match.employeeRef)
      if (!assignmentId) continue

      await db.insert(developmentAssignmentMatches).values({
        developmentId: development.id,
        assignmentId,
        reasons: match.reasons,
        // The unknowns are appended to the stored explanation so the record of
        // what the user saw is complete — a match explanation without its
        // caveats is not the thing that was shown.
        explanation:
          match.unknowns.length > 0
            ? `${match.explanation}\n\nStill unknown: ${match.unknowns.join(' ')}`
            : match.explanation,
        reviewStatus: 'open',
      })

      affectedRefs.add(match.employeeRef)
      totalMatches += 1
    }

    const byConfidence = matches.reduce<Record<string, number>>((acc, m) => {
      acc[m.confidence] = (acc[m.confidence] ?? 0) + 1
      return acc
    }, {})

    console.log(
      `  ${development.slug.padEnd(44)} ${String(matches.length).padStart(2)} match(es)` +
        (matches.length > 0
          ? `  [${Object.entries(byConfidence).map(([k, n]) => `${k}:${n}`).join(' ')}]`
          : ''),
    )
  }

  const unmatched = assignmentRows
    .filter((a) => !affectedRefs.has(a.employeeRef))
    .map((a) => a.employeeRef)

  console.log(`\n  ${totalMatches} potential review items across ${affectedRefs.size} of ${assignmentRows.length} assignments`)
  if (unmatched.length > 0) {
    // Worth printing: an assignment matching nothing is the expected outcome
    // for corridors we do not monitor, and silence would look like a bug.
    console.log(`  not affected by anything: ${unmatched.join(', ')}`)
  }
  console.log('\n  All matches are potential review items, not legal determinations.')
  console.log('\nDone.')
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nMatching failed:', err instanceof Error ? err.message : err)
    process.exit(1)
  })
