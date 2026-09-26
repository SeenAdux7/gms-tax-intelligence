/**
 * Seed: the synthetic assignment population
 * =========================================
 *
 * "Use clearly labelled synthetic data to demonstrate how a development could
 * be connected to a company's mobile workforce."
 *
 * Every row here is invented. `isSynthetic` defaults to true, there is no code
 * path that sets it false, and `checkAssignmentIsSynthetic()` rejects an
 * employee reference that looks like a person's name. The point is to protect
 * against real employee data ever entering this app, which is a requirement in
 * the brief and a genuinely bad thing to get wrong.
 *
 * NOTE ON SCOPE: there are no salary figures anywhere in this file, and that is
 * deliberate. "The first version does not need to calculate actual tax
 * liabilities. Its purpose is to identify records and work areas that may
 * require professional review." Storing a salary would invite the app to
 * compute an answer it has no business computing — so a match explanation says
 * "review whether base salary falls in the affected band" rather than deciding.
 *
 * The population is shaped to exercise the matcher, not to look plausible on a
 * spreadsheet: corridors that hit each of the six seeded developments, at least
 * one assignment that matches nothing, payroll locations that differ from the
 * host country (the shadow-payroll case), and a mix of planned/active/ended so
 * date-range matching has something to do.
 *
 * Run with:  npm run db:seed:assignments
 */

// MUST be the first import. db/index.ts decides between Neon and PGlite by
// reading DATABASE_URL at module load, so the env file has to be loaded before
// that module is evaluated. Without this the script silently writes to the
// LOCAL database and reports success — which is exactly what happened: the
// schema went to Neon (drizzle.config.ts loads .env.local itself) while every
// seeded row went to PGlite.
import '../pipeline/env'
import { db } from './index'
import { assignmentDeadlines, assignments } from './schema'
import { checkAssignmentIsSynthetic, formatViolations, hasBlockingError } from './invariants'

type AssignmentSeed = Omit<typeof assignments.$inferInsert, 'id' | 'createdAt'> & {
  /** Compliance items for this assignment. */
  deadlines?: { label: string; dueDate: string; status?: 'open' | 'under_review' | 'completed' | 'overdue' }[]
  /** Why this row exists in the fixture — for whoever reads this file next. */
  note: string
}

const ASSIGNMENTS: AssignmentSeed[] = [
  {
    employeeRef: 'EMP-0101',
    homeJurisdiction: 'US',
    hostJurisdiction: 'GB',
    startDate: '2025-09-01',
    endDate: '2028-08-31',
    type: 'long_term',
    status: 'active',
    // Paid from the US, reported in the UK — the classic shadow payroll setup.
    payrollLocations: ['US', 'GB'],
    compensationCategories: ['base_salary', 'bonus', 'equity'],
    benefits: ['housing', 'schooling', 'home_leave'],
    note: 'Long-term US→UK with split payroll. Should match the UK PAYE development on jurisdiction, population and payroll location.',
    deadlines: [
      { label: 'UK self assessment return 2026/27', dueDate: '2028-01-31' },
      { label: 'Annual UK workday reconciliation', dueDate: '2027-05-31', status: 'under_review' },
    ],
  },
  {
    employeeRef: 'EMP-0102',
    homeJurisdiction: 'US',
    hostJurisdiction: 'IE',
    startDate: '2025-03-15',
    endDate: '2028-03-14',
    type: 'long_term',
    status: 'active',
    payrollLocations: ['US', 'IE'],
    compensationCategories: ['base_salary', 'bonus'],
    benefits: ['housing', 'relocation'],
    note: 'Already-arrived Irish assignee — the grandfathered SARP case. Arrived before 2027, so the threshold change should NOT be presented as affecting them.',
    deadlines: [{ label: 'Irish Form 11 filing', dueDate: '2027-10-31' }],
  },
  {
    employeeRef: 'EMP-0103',
    homeJurisdiction: 'US',
    hostJurisdiction: 'IE',
    startDate: '2027-04-01',
    type: 'long_term',
    status: 'planned',
    payrollLocations: ['US'],
    compensationCategories: ['base_salary', 'bonus', 'equity'],
    benefits: ['housing', 'schooling'],
    note: 'Irish arrival AFTER 1 January 2027 — the SARP threshold case. Payroll not yet set up in Ireland, which is itself a review point.',
    deadlines: [
      { label: 'SARP employer certification (90 days of arrival)', dueDate: '2027-06-30' },
      { label: 'Irish payroll registration', dueDate: '2027-03-31' },
    ],
  },
  {
    employeeRef: 'EMP-0104',
    homeJurisdiction: 'US',
    hostJurisdiction: 'CA',
    startDate: '2026-10-05',
    endDate: '2026-11-20',
    type: 'business_traveler',
    status: 'planned',
    // No Canadian payroll — the Regulation 102 waiver case.
    payrollLocations: ['US'],
    compensationCategories: ['base_salary'],
    benefits: ['per_diem'],
    note: 'Short-notice Canadian trip on US payroll only. Should match the Reg 102 waiver development, and the short lead time is the finding.',
    deadlines: [{ label: 'Regulation 102 waiver application', dueDate: '2026-09-05' }],
  },
  {
    employeeRef: 'EMP-0105',
    homeJurisdiction: 'GB',
    hostJurisdiction: 'US',
    startDate: '2026-01-12',
    type: 'remote_worker',
    status: 'active',
    payrollLocations: ['GB'],
    compensationCategories: ['base_salary', 'equity'],
    benefits: [],
    note: 'UK employee with regular US workdays, UK payroll only. Should match the US day-counting development — and holds equity, which that source explicitly does not address.',
  },
  {
    employeeRef: 'EMP-0106',
    homeJurisdiction: 'US-NJ',
    hostJurisdiction: 'US-NY',
    startDate: '2025-06-02',
    type: 'remote_worker',
    status: 'active',
    payrollLocations: ['US-NY'],
    compensationCategories: ['base_salary', 'bonus'],
    benefits: [],
    note: 'New Jersey resident working for a New York employer, partly from home. The convenience-of-the-employer case.',
  },
  {
    employeeRef: 'EMP-0107',
    homeJurisdiction: 'US-WA',
    hostJurisdiction: 'US-CA',
    startDate: '2026-02-01',
    type: 'business_traveler',
    status: 'active',
    payrollLocations: ['US-WA'],
    compensationCategories: ['base_salary'],
    benefits: ['per_diem'],
    note: 'Seattle-based consultant with short California trips — the day-one withholding burden the California discussion paper describes.',
  },
  {
    employeeRef: 'EMP-0108',
    homeJurisdiction: 'IE',
    hostJurisdiction: 'GB',
    startDate: '2026-04-06',
    type: 'commuter',
    status: 'active',
    payrollLocations: ['IE', 'GB'],
    compensationCategories: ['base_salary'],
    benefits: ['travel'],
    note: 'Ireland→UK commuter. Matches UK developments; also exercises a corridor where both ends are seeded jurisdictions.',
    deadlines: [{ label: 'A1 / certificate of coverage renewal', dueDate: '2027-04-05' }],
  },
  {
    employeeRef: 'EMP-0109',
    homeJurisdiction: 'CA',
    hostJurisdiction: 'US',
    startDate: '2024-01-15',
    endDate: '2025-12-31',
    type: 'short_term',
    status: 'ended',
    payrollLocations: ['CA', 'US'],
    compensationCategories: ['base_salary', 'bonus'],
    benefits: ['housing'],
    note: 'ENDED assignment. Should be excluded from date-range matching on forward-looking developments — if it shows up as affected, the date logic is wrong.',
    deadlines: [
      { label: 'Final US tax settlement', dueDate: '2026-06-30', status: 'completed' },
      { label: 'Canadian departure filing', dueDate: '2026-04-30', status: 'overdue' },
    ],
  },
  {
    employeeRef: 'EMP-0110',
    homeJurisdiction: 'US',
    hostJurisdiction: 'US-CA',
    startDate: '2026-08-01',
    type: 'domestic_transfer',
    status: 'active',
    payrollLocations: ['US-CA'],
    compensationCategories: ['base_salary'],
    benefits: ['relocation'],
    note: 'Domestic US transfer into California. Matches California items but not any international development.',
  },
]

/* --------------------------------------------------------------------------
 * Extra jurisdictions needed by this fixture
 *
 * New Jersey and Washington appear as HOME locations only. They are not polled
 * for developments, so they are seeded disabled — the source list and the
 * jurisdiction list are deliberately separate concerns, and an assignment can
 * perfectly well involve a place we do not monitor. Pretending otherwise would
 * mean either dropping realistic corridors or implying coverage we do not have.
 * -------------------------------------------------------------------------- */

const EXTRA_JURISDICTIONS = [
  { code: 'US-NJ', name: 'New Jersey', kind: 'us_state' as const, parentCode: 'US', enabled: false },
  { code: 'US-WA', name: 'Washington', kind: 'us_state' as const, parentCode: 'US', enabled: false },
]

async function main() {
  console.log('Seeding synthetic assignments...\n')
  console.log('  Reminder: stop `npm run dev` first (PGlite is single-process).')
  console.log('  All rows are INVENTED. No real employee data is used anywhere in this app.\n')

  const { jurisdictions } = await import('./schema')
  await db.insert(jurisdictions).values(EXTRA_JURISDICTIONS).onConflictDoNothing()

  await db.delete(assignments)

  for (const seed of ASSIGNMENTS) {
    // `deadlines` and `note` are fixture metadata, not columns.
    const row = { ...seed } as Partial<AssignmentSeed> & typeof assignments.$inferInsert
    const deadlines = seed.deadlines
    delete row.deadlines
    delete row.note

    // Same gate the app would apply to any assignment write.
    const violations = checkAssignmentIsSynthetic(row)
    if (hasBlockingError(violations)) {
      throw new Error(`Assignment '${row.employeeRef}' rejected:\n${formatViolations(violations)}`)
    }

    const [inserted] = await db
      .insert(assignments)
      .values(row)
      .returning({ id: assignments.id })

    if (deadlines?.length) {
      await db.insert(assignmentDeadlines).values(
        deadlines.map((d) => ({
          assignmentId: inserted.id,
          label: d.label,
          dueDate: d.dueDate,
          status: d.status ?? ('open' as const),
        })),
      )
    }

    console.log(
      `  ${row.employeeRef}  ${row.homeJurisdiction.padEnd(6)} -> ${row.hostJurisdiction.padEnd(6)} ` +
        `${row.type.padEnd(18)} ${row.status.padEnd(8)} ${deadlines?.length ?? 0} deadline(s)`,
    )
  }

  const corridors = new Set(ASSIGNMENTS.map((a) => `${a.homeJurisdiction}->${a.hostJurisdiction}`))
  console.log(`\n  ${ASSIGNMENTS.length} synthetic assignments across ${corridors.size} corridors`)
  console.log(`  ${ASSIGNMENTS.filter((a) => a.status === 'active').length} active, ` +
    `${ASSIGNMENTS.filter((a) => a.status === 'planned').length} planned, ` +
    `${ASSIGNMENTS.filter((a) => a.status === 'ended').length} ended`)
  console.log('\nDone.')
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // Print the `cause` too. Drizzle wraps the underlying Postgres error there,
    // and reporting only `err.message` hides the actual constraint or type
    // failure behind a generic "Failed query" — which cost real debugging time.
    console.error('\nSeed failed:', err instanceof Error ? err.message : err)
    if (err instanceof Error && err.cause) console.error('\nCause:', err.cause)
    process.exit(1)
  })
