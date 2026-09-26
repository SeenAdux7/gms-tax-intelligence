/**
 * Seed: demonstration developments and the vocabulary library
 * ===========================================================
 *
 * WHY THIS FILE EXISTS
 *
 * The brief asks for "seed data so the complete experience can be demonstrated
 * even when a source is temporarily unavailable". That is an interview-safety
 * requirement: if the IRS website is down, or the hourly job hasn't run, the app
 * must still look complete.
 *
 * These developments are ILLUSTRATIVE. They are modelled on real mechanisms a
 * GMS team actually deals with — UK PAYE special arrangements, New York's
 * convenience-of-the-employer rule, Irish SARP, Canadian Regulation 102
 * waivers — but the specific documents, dates, and wording are written for this
 * demo and are not real published guidance. Every row carries
 * `isSeedData: true`, and the UI renders a "Demonstration data" badge from that
 * flag. Nothing here should ever be read as tax advice or as a real rule.
 *
 * WHAT THIS FILE IS ALSO PROVING
 *
 * Each development is built through the same provenance discipline the real
 * pipeline will use, so the UI is developed against realistically-shaped data
 * rather than a convenient simplification:
 *
 *   - Evidence offsets are COMPUTED, never hand-written. `evidence()` searches
 *     the document text for the quote and throws if it isn't found verbatim.
 *     That makes it impossible to seed a quote that doesn't actually appear in
 *     its source — the same guarantee we need from the model later.
 *
 *   - Some developments deliberately have NULL facts. `us-remote-work-presence`
 *     has no effective date and `us-ca-nonresident-threshold` has no status,
 *     because their sources genuinely don't state one. These are the most
 *     important rows in the file: they exercise the "Not stated in source"
 *     rendering path, which is the part of the UI most likely to be quietly
 *     skipped otherwise.
 *
 *   - Verification levels respect the source-tier ceiling from
 *     db/invariants.ts. The discussion-stage California item is `unverified`,
 *     not `official_confirmed`, even though it sits on an official domain.
 *
 * Run with:  npm run db:seed:content
 */

import { eq } from 'drizzle-orm'
import { db } from './index'
import {
  developmentJurisdictions,
  developmentPopulations,
  developments,
  developmentSources,
  developmentTerms,
  developmentTopics,
  evidenceSpans,
  interpretationEvidence,
  interpretations,
  rawDocuments,
  sources,
  vocabRelations,
  vocabTerms,
} from './schema'
import {
  checkDevelopmentEvidence,
  checkInterpretationGrounding,
  formatViolations,
  hasBlockingError,
} from './invariants'

/* ==========================================================================
 * Types for the seed definitions
 * ========================================================================== */

type Quote = string

type SeedDevelopment = {
  slug: string
  headline: string
  /** Matches `sources.name` — the document is attributed to a real feed. */
  sourceName: string
  document: {
    url: string
    title: string
    publishedAt: string
    language?: string
    /** The full text. Every quote below must appear in here verbatim. */
    text: string
  }
  facts: {
    /** NULL where the source genuinely doesn't say. Each present value needs a quote. */
    status: { value: (typeof developments.$inferInsert)['status']; quote: Quote } | null
    publishedAt: { value: string; quote: Quote } | null
    effectiveAt: { value: string; quote: Quote } | null
    actionDeadlineAt: { value: string; quote: Quote } | null
    primaryTopic: { value: (typeof developments.$inferInsert)['primaryTopic']; quote: Quote } | null
  }
  verification: (typeof developments.$inferInsert)['verification']
  confidence: (typeof developments.$inferInsert)['confidence']
  uncertaintyNote?: string
  jurisdictions: { code: string; role: 'affected' | 'home' | 'host'; quote?: Quote }[]
  topics: { topic: (typeof developmentTopics.$inferInsert)['topic']; quote?: Quote }[]
  populations: {
    population: (typeof developmentPopulations.$inferInsert)['population']
    quote?: Quote
  }[]
  /** AI-style interpretation. Stored separately from facts, always labelled. */
  interpretation: {
    learn_summary: string
    professional_summary: string
    employee_effect: string
    employer_effect: string
    gms_effect: string
    review_actions: string
    uncertainty?: string
  }
  /** Quotes each interpretation is grounded in. */
  interpretationEvidence: Quote[]
  /**
   * Vocabulary terms a learner should follow up from this update, by slug.
   *
   * These are EDITORIAL, alongside the deterministic text scan in
   * `linkDevelopmentTerms()`. Both are needed, and the reason is a genuine
   * tension in the brief: the interpretations are written in deliberately
   * plain language ("beginner first — explain unfamiliar language instead of
   * assuming prior tax knowledge"), so they systematically avoid the jargon
   * that the vocabulary section exists to teach. A pure text scan therefore
   * finds almost nothing — measured at 5 links across all six developments.
   *
   * A development about Canadian withholding waivers is genuinely about
   * shadow payroll and business travellers whether or not those exact words
   * appear, and that is what a learner needs pointed at.
   */
  terms: string[]
}

/* ==========================================================================
 * The developments
 *
 * Spread deliberately across all five status values, several jurisdictions, and
 * a range of verification levels, so the feed's filters have something real to
 * filter and the status badges are all exercised.
 * ========================================================================== */

const DEVELOPMENTS: SeedDevelopment[] = [
  /* ---------------------------------------------------------------- 1. UK */
  {
    slug: 'gb-paye-short-term-business-visitors',
    headline: 'UK updates PAYE special arrangement for short-term business visitors',
    sourceName: 'GOV.UK — HMRC publications',
    document: {
      url: 'https://www.gov.uk/government/publications/paye-special-arrangements-short-term-business-visitors',
      title: 'PAYE special arrangements for short-term business visitors',
      publishedAt: '2026-08-14',
      text: [
        'HM Revenue & Customs has published updated guidance on PAYE special arrangements for short-term business visitors to the United Kingdom.',
        'The guidance sets out the circumstances in which an employer may apply to operate an annual PAYE scheme for employees who spend fewer than 60 UK workdays in a tax year, rather than reporting each payment in real time.',
        'Employers must apply in writing before 6 April of the relevant tax year, and must retain a record of UK workdays for every employee covered by the arrangement.',
        'The updated guidance takes effect for the 2027 to 2028 tax year.',
        'Arrangements already approved for earlier years remain valid and do not need to be re-applied for.',
        'Where an employee exceeds 60 UK workdays during the year, the employer must notify HMRC within 30 days and revert to standard reporting from the date the threshold was exceeded.',
        'This guidance does not change the tax residence position of any employee, which continues to be determined by the statutory residence test.',
      ].join(' '),
    },
    facts: {
      status: {
        value: 'official_guidance',
        quote: 'HM Revenue & Customs has published updated guidance on PAYE special arrangements for short-term business visitors',
      },
      publishedAt: { value: '2026-08-14', quote: 'HM Revenue & Customs has published updated guidance' },
      effectiveAt: {
        value: '2027-04-06',
        quote: 'The updated guidance takes effect for the 2027 to 2028 tax year.',
      },
      actionDeadlineAt: {
        value: '2027-04-06',
        quote: 'Employers must apply in writing before 6 April of the relevant tax year',
      },
      primaryTopic: {
        value: 'payroll',
        quote: 'an employer may apply to operate an annual PAYE scheme',
      },
    },
    verification: 'official_confirmed',
    confidence: 'high',
    jurisdictions: [
      { code: 'GB', role: 'affected', quote: 'short-term business visitors to the United Kingdom' },
      { code: 'GB', role: 'host', quote: 'employees who spend fewer than 60 UK workdays in a tax year' },
    ],
    topics: [
      { topic: 'payroll', quote: 'rather than reporting each payment in real time' },
      { topic: 'withholding', quote: 'operate an annual PAYE scheme' },
      { topic: 'reporting', quote: 'must retain a record of UK workdays for every employee covered by the arrangement' },
    ],
    populations: [
      { population: 'business_travelers', quote: 'short-term business visitors to the United Kingdom' },
      { population: 'employers', quote: 'an employer may apply to operate an annual PAYE scheme' },
    ],
    interpretation: {
      learn_summary:
        'If a company sends employees to the UK for short work trips, it normally has to run UK payroll and report every payment as it happens. This guidance keeps an easier option available: apply in advance, and the employer can report once a year instead — as long as each employee stays under 60 UK workdays. The catch is that the employer has to apply before the tax year starts and has to track workdays carefully.',
      professional_summary:
        'HMRC guidance on PAYE special arrangements for short-term business visitors, effective for 2027/28. Annual rather than RTI reporting is permitted where UK workdays are below 60 per employee per tax year. Application required in writing before 6 April; existing approvals carry over. Breach of the 60-day threshold triggers a 30-day notification obligation and reversion to standard reporting from the breach date. No change to statutory residence test outcomes.',
      employee_effect:
        'Little to no direct change for the employee. Their UK tax position and residence status are unaffected — the guidance changes how the employer reports, not what the employee owes.',
      employer_effect:
        'The administrative saving is real but conditional. It depends on applying before the tax year begins and on workday tracking being accurate enough to catch someone approaching 60 days. An employer without reliable travel data may find the 30-day notification obligation harder to meet than standard reporting would have been.',
      gms_effect:
        'Two pieces of work: confirm whether existing arrangements are in place and carried over, and check that the travel-day data feeding the 60-day test is actually complete. Business-traveller tracking is frequently based on expense claims, which miss trips that were not expensed.',
      review_actions:
        'Review UK workday records for the coming tax year; identify employees approaching 60 days; confirm whether a written application is needed or an existing approval applies; check that the process for notifying HMRC within 30 days of a breach exists and has an owner.',
    },
    interpretationEvidence: [
      'The guidance sets out the circumstances in which an employer may apply to operate an annual PAYE scheme for employees who spend fewer than 60 UK workdays in a tax year, rather than reporting each payment in real time.',
      'Employers must apply in writing before 6 April of the relevant tax year, and must retain a record of UK workdays for every employee covered by the arrangement.',
      'Where an employee exceeds 60 UK workdays during the year, the employer must notify HMRC within 30 days and revert to standard reporting from the date the threshold was exceeded.',
      'This guidance does not change the tax residence position of any employee, which continues to be determined by the statutory residence test.',
    ],
    terms: ['business-traveler', 'withholding', 'shadow-payroll', 'tax-residency', 'host-country'],
  },

  /* ------------------------------------- 2. US — deliberately NO effective date */
  {
    slug: 'us-remote-work-presence-guidance',
    headline: 'US guidance addresses counting workdays for employees working temporarily across borders',
    sourceName: 'IRS Newsroom',
    document: {
      url: 'https://www.irs.gov/newsroom/guidance-on-counting-days-of-presence-for-cross-border-remote-work',
      title: 'Guidance on counting days of presence for cross-border remote work',
      publishedAt: '2026-09-02',
      text: [
        'The Internal Revenue Service has issued guidance describing how days of presence are counted for employees who perform services in the United States on a temporary basis while remaining on a foreign payroll.',
        'The guidance confirms that a day on which an employee performs any services within the United States is counted as a day of presence for the purposes of the substantial presence test, regardless of the number of hours worked.',
        'The guidance further states that travel days on which no services are performed are not counted, provided the employer maintains contemporaneous records supporting that determination.',
        'Employers are reminded that the existence of a foreign payroll arrangement does not by itself remove a US withholding obligation.',
        'The guidance does not address the treatment of equity compensation earned partly within and partly outside the United States.',
        'Further guidance on that point is expected but no date has been announced.',
      ].join(' '),
    },
    facts: {
      status: {
        value: 'official_guidance',
        quote: 'The Internal Revenue Service has issued guidance describing how days of presence are counted',
      },
      publishedAt: {
        value: '2026-09-02',
        quote: 'The Internal Revenue Service has issued guidance',
      },
      // The source states no effective date. We do NOT infer one from the
      // publication date — that inference is exactly what the brief forbids.
      effectiveAt: null,
      actionDeadlineAt: null,
      primaryTopic: {
        value: 'tax_residency',
        quote: 'counted as a day of presence for the purposes of the substantial presence test',
      },
    },
    verification: 'official_confirmed',
    confidence: 'medium',
    uncertaintyNote:
      'The source states no effective date, so it is not known whether this applies to the current tax year or prospectively only. It also explicitly leaves equity compensation unaddressed — a significant gap for assignees with vesting awards.',
    jurisdictions: [
      { code: 'US', role: 'affected', quote: 'employees who perform services in the United States on a temporary basis' },
      { code: 'US', role: 'host', quote: 'a day on which an employee performs any services within the United States' },
    ],
    topics: [
      { topic: 'tax_residency', quote: 'for the purposes of the substantial presence test' },
      { topic: 'withholding', quote: 'does not by itself remove a US withholding obligation' },
      { topic: 'reporting', quote: 'provided the employer maintains contemporaneous records supporting that determination' },
    ],
    populations: [
      { population: 'business_travelers', quote: 'perform services in the United States on a temporary basis' },
      { population: 'remote_workers', quote: 'while remaining on a foreign payroll' },
      { population: 'employers', quote: 'Employers are reminded that the existence of a foreign payroll arrangement does not by itself remove a US withholding obligation.' },
    ],
    interpretation: {
      learn_summary:
        'If someone works in the US even briefly while staying on their home-country payroll, those days count towards US tax residency — and a day counts whether they worked one hour or ten. Pure travel days do not count, but only if the employer wrote it down at the time. The guidance also says plainly that being paid from abroad does not remove the US withholding question.',
      professional_summary:
        'IRS guidance on day-counting for the substantial presence test where services are performed in the US on a temporary basis under a foreign payroll. Any services performed in-country on a given day constitutes a day of presence irrespective of hours. Non-service travel days are excluded subject to contemporaneous records. Foreign payroll does not extinguish US withholding obligations. Equity compensation sourcing is expressly out of scope. No effective date stated.',
      employee_effect:
        'Short trips may push an employee closer to US tax residency than expected, because part-days count in full. Employees whose trips are recorded only in expense systems may find their day count understated.',
      employer_effect:
        'The "contemporaneous records" condition is the operative constraint. Reconstructing travel days after the fact will not satisfy it, which makes this a data-capture problem rather than a tax-computation one.',
      gms_effect:
        'Review how travel days are captured and whether the record is contemporaneous. Identify employees near a substantial-presence threshold. Note that the equity question is left open, so any advice on award sourcing should be flagged as unresolved rather than answered.',
      review_actions:
        'Review travel-day data sources and whether they are recorded at the time; identify employees on foreign payroll with US workdays; confirm withholding positions are not being relied on solely because payroll sits offshore; monitor for the follow-up guidance on equity compensation.',
      uncertainty:
        'No effective date is stated in the source, so whether this applies to the current tax year is unknown. Equity compensation is explicitly not addressed. Before advising on an award with a US workday component, the actual vesting and workday history would be needed, and the open guidance point should be disclosed.',
    },
    interpretationEvidence: [
      'The guidance confirms that a day on which an employee performs any services within the United States is counted as a day of presence for the purposes of the substantial presence test, regardless of the number of hours worked.',
      'The guidance further states that travel days on which no services are performed are not counted, provided the employer maintains contemporaneous records supporting that determination.',
      'Employers are reminded that the existence of a foreign payroll arrangement does not by itself remove a US withholding obligation.',
      'The guidance does not address the treatment of equity compensation earned partly within and partly outside the United States.',
    ],
    terms: ['tax-residency', 'withholding', 'business-traveler', 'shadow-payroll', 'host-country'],
  },

  /* ----------------------------------------------- 3. New York — proposed */
  {
    slug: 'us-ny-convenience-employer-proposal',
    headline: 'New York proposes narrowing the convenience-of-the-employer rule for remote workdays',
    sourceName: 'New York State Department of Taxation and Finance',
    document: {
      url: 'https://www.tax.ny.gov/press/convenience-of-the-employer-proposed-amendment',
      title: 'Proposed amendment: allocation of nonresident wages for remote workdays',
      publishedAt: '2026-07-21',
      text: [
        'The New York State Department of Taxation and Finance has released a proposed amendment concerning the allocation of wages earned by nonresident employees who work remotely.',
        'Under the current convenience-of-the-employer rule, a day worked outside New York at the employee\'s own convenience is generally treated as a New York workday.',
        'The proposed amendment would introduce a limited exception where the employer establishes a bona fide office location outside New York and the employee is assigned to it.',
        'The proposal sets out factors that would be considered in determining whether an office is bona fide, including whether the employer reimburses the cost of the location and whether the employee\'s duties require presence there.',
        'The amendment is subject to a public comment period and has not been adopted.',
        'No effective date has been proposed.',
      ].join(' '),
    },
    facts: {
      status: {
        value: 'proposed',
        quote: 'The amendment is subject to a public comment period and has not been adopted.',
      },
      publishedAt: {
        value: '2026-07-21',
        quote: 'The New York State Department of Taxation and Finance has released a proposed amendment',
      },
      effectiveAt: null,
      actionDeadlineAt: null,
      primaryTopic: {
        value: 'individual_income_tax',
        quote: 'the allocation of wages earned by nonresident employees who work remotely',
      },
    },
    verification: 'official_confirmed',
    confidence: 'medium',
    uncertaintyNote:
      'This is a proposal in a public comment period, not a rule. It may be amended or dropped entirely, and no effective date has been proposed. It should be monitored, not acted on.',
    // Tagged US-NY only, NOT US.
    //
    // Tagging the parent country on a state-level development is tempting —
    // the source does talk about nonresident employees generally — but it is
    // both redundant and harmful. Redundant because the feed filter already
    // walks the hierarchy, so filtering by "US" picks up New York items via
    // `parent_code`. Harmful because the matcher treats a parent jurisdiction
    // as covering all its children, so tagging US made this New York proposal
    // match 9 of 10 assignments, including ones in California and Washington
    // that it cannot possibly affect.
    //
    // Rule: tag the jurisdiction the development actually applies to. Let the
    // hierarchy do the rest.
    jurisdictions: [
      { code: 'US-NY', role: 'affected', quote: 'nonresident employees who work remotely' },
      { code: 'US-NY', role: 'host', quote: 'a day worked outside New York at the employee\'s own convenience is generally treated as a New York workday' },
    ],
    topics: [
      { topic: 'individual_income_tax', quote: 'allocation of wages earned by nonresident employees who work remotely' },
      { topic: 'payroll', quote: 'Under the current convenience-of-the-employer rule, a day worked outside New York at the employee\'s own convenience is generally treated as a New York workday.' },
      { topic: 'assignment_policy', quote: 'the employer establishes a bona fide office location outside New York and the employee is assigned to it' },
    ],
    populations: [
      { population: 'domestic_state_workers', quote: 'nonresident employees who work remotely' },
      { population: 'remote_workers', quote: 'employees who work remotely' },
      { population: 'employers', quote: 'whether the employer reimburses the cost of the location' },
    ],
    interpretation: {
      learn_summary:
        'New York currently treats a day a nonresident chooses to work from home as a New York workday, and taxes it accordingly. This proposal would carve out an exception when the employer genuinely maintains an office elsewhere and assigns the employee there. It is only a proposal — nothing has changed yet, and there is no date for when it might.',
      professional_summary:
        'Proposed amendment to New York nonresident wage allocation under the convenience-of-the-employer rule. Would introduce a bona fide employer office exception, with factors including employer reimbursement of the location and duty-driven presence. In public comment; not adopted; no proposed effective date.',
      employee_effect:
        'None yet. If adopted, nonresidents assigned to a genuine out-of-state employer office could see fewer workdays allocated to New York, and a correspondingly lower New York liability.',
      employer_effect:
        'None yet. If adopted, the practical question becomes evidentiary: whether a given location meets the bona fide factors, and whether reimbursement arrangements are documented well enough to demonstrate it.',
      gms_effect:
        'Monitor rather than act. It is worth identifying which nonresident populations would be affected if this is adopted, so the impact can be sized quickly, but no cost projection should be revised on the basis of a proposal.',
      review_actions:
        'Track the comment period and any adopted version; identify nonresident employees with substantial out-of-state remote workdays; note which locations might qualify as bona fide offices and what documentation exists. Do not change withholding on the basis of this proposal.',
      uncertainty:
        'A proposal in a comment period is not a rule and may change substantially or be withdrawn. No effective date has been proposed. Any assessment of impact is contingent on a final text that does not yet exist.',
    },
    interpretationEvidence: [
      'Under the current convenience-of-the-employer rule, a day worked outside New York at the employee\'s own convenience is generally treated as a New York workday.',
      'The proposed amendment would introduce a limited exception where the employer establishes a bona fide office location outside New York and the employee is assigned to it.',
      'The amendment is subject to a public comment period and has not been adopted.',
      'No effective date has been proposed.',
    ],
    terms: ['withholding', 'tax-residency', 'home-country', 'host-country'],
  },

  /* -------------------------------------------------- 4. Ireland — enacted */
  {
    slug: 'ie-sarp-extension',
    headline: 'Ireland extends Special Assignee Relief Programme with a higher income threshold',
    sourceName: 'Irish Revenue — eBriefs',
    document: {
      url: 'https://www.revenue.ie/en/tax-professionals/ebrief/2026/no-1482026.aspx',
      title: 'eBrief No. 148/26 — Special Assignee Relief Programme',
      publishedAt: '2026-06-30',
      text: [
        'Revenue has updated the Tax and Duty Manual to reflect the extension of the Special Assignee Relief Programme, known as SARP, enacted in the Finance Act.',
        'SARP provides relief from income tax on a portion of the employment income of an employee assigned to work in the State by a relevant employer.',
        'The relief has been extended to arrivals up to and including 31 December 2029.',
        'The minimum annual basic salary required to qualify has been increased from 100,000 euro to 125,000 euro for employees arriving on or after 1 January 2027.',
        'Employers must certify an employee\'s arrival to Revenue within 90 days of that arrival in order for a claim to be made.',
        'The updated manual confirms that employees already certified under the previous threshold retain their existing entitlement for the remainder of the relief period.',
      ].join(' '),
    },
    facts: {
      status: {
        value: 'enacted',
        quote: 'the extension of the Special Assignee Relief Programme, known as SARP, enacted in the Finance Act',
      },
      publishedAt: {
        value: '2026-06-30',
        quote: 'Revenue has updated the Tax and Duty Manual',
      },
      effectiveAt: {
        value: '2027-01-01',
        quote: 'increased from 100,000 euro to 125,000 euro for employees arriving on or after 1 January 2027',
      },
      actionDeadlineAt: {
        value: '2027-01-01',
        quote: 'Employers must certify an employee\'s arrival to Revenue within 90 days of that arrival',
      },
      primaryTopic: {
        value: 'compensation',
        quote: 'relief from income tax on a portion of the employment income',
      },
    },
    verification: 'official_confirmed',
    confidence: 'high',
    jurisdictions: [
      { code: 'IE', role: 'affected', quote: 'an employee assigned to work in the State by a relevant employer' },
      { code: 'IE', role: 'host', quote: 'assigned to work in the State' },
    ],
    topics: [
      { topic: 'compensation', quote: 'relief from income tax on a portion of the employment income' },
      { topic: 'individual_income_tax', quote: 'SARP provides relief from income tax' },
      { topic: 'assignment_policy', quote: 'The relief has been extended to arrivals up to and including 31 December 2029.' },
    ],
    populations: [
      { population: 'expatriates', quote: 'an employee assigned to work in the State by a relevant employer' },
      { population: 'employers', quote: 'Employers must certify an employee\'s arrival to Revenue within 90 days of that arrival' },
    ],
    interpretation: {
      learn_summary:
        'Ireland has a relief that exempts part of an assignee\'s salary from Irish income tax, and it has been extended to people arriving up to the end of 2029. But the salary you need to qualify is going up from €100,000 to €125,000 for anyone arriving from 2027. People already certified keep what they have. The 90-day certification deadline is the thing most likely to be missed.',
      professional_summary:
        'SARP extended to arrivals through 31 December 2029 per Finance Act. Minimum qualifying basic salary rises from €100,000 to €125,000 for arrivals on or after 1 January 2027. Existing certified employees grandfathered at the prior threshold for the remainder of their relief period. Employer certification to Revenue required within 90 days of arrival.',
      employee_effect:
        'An assignee arriving from 2027 on a salary between €100,000 and €125,000 would no longer qualify, which raises their Irish tax cost materially. Assignees already certified are unaffected.',
      employer_effect:
        'Cost projections for Irish inbound assignments starting in 2027 need revisiting where base salary sits in the affected band. There is also a timing incentive: an arrival before 1 January 2027 is treated under the old threshold.',
      gms_effect:
        'Identify planned Irish arrivals with base salary between €100,000 and €125,000 and reforecast. Confirm the 90-day certification process is being met for current arrivals, as a missed certification forfeits the claim regardless of eligibility.',
      review_actions:
        'Review pipeline of Irish inbound assignments for 2027 onward; flag salaries in the €100,000–€125,000 band; re-run affected cost projections; audit that arrival certifications are filed within 90 days; confirm grandfathered employees are correctly identified.',
    },
    interpretationEvidence: [
      'The relief has been extended to arrivals up to and including 31 December 2029.',
      'The minimum annual basic salary required to qualify has been increased from 100,000 euro to 125,000 euro for employees arriving on or after 1 January 2027.',
      'Employers must certify an employee\'s arrival to Revenue within 90 days of that arrival in order for a claim to be made.',
      'The updated manual confirms that employees already certified under the previous threshold retain their existing entitlement for the remainder of the relief period.',
    ],
    terms: [
      'expatriate',
      'assignment-allowance',
      'tax-equalization',
      'host-country',
      'home-country',
      'tax-settlement',
    ],
  },

  /* ---------------------------------------------- 5. Canada — now effective */
  {
    slug: 'ca-reg-102-waiver-process',
    headline: 'Canada streamlines Regulation 102 withholding waivers for short-term assignees',
    sourceName: 'Canada Revenue Agency — newsroom',
    document: {
      url: 'https://www.canada.ca/en/revenue-agency/news/2026/05/regulation-102-waiver-streamlined-process.html',
      title: 'Streamlined process for Regulation 102 withholding waivers',
      publishedAt: '2026-05-19',
      text: [
        'The Canada Revenue Agency has implemented a streamlined process for Regulation 102 waiver applications submitted by non-resident employers.',
        'Regulation 102 requires withholding on employment income earned in Canada by a non-resident employee, unless a waiver is granted or the employer is a certified non-resident employer.',
        'Under the streamlined process, applications submitted at least 30 days before the employee begins work in Canada will receive a decision before the work start date.',
        'Applications submitted with less than 30 days notice will continue to be processed, but the Agency states that withholding must be applied until a waiver is issued.',
        'The streamlined process is in effect for applications received on or after 1 June 2026.',
        'The Agency has also confirmed that the certified non-resident employer regime is unchanged by this announcement.',
      ].join(' '),
    },
    facts: {
      status: {
        value: 'effective',
        quote: 'The streamlined process is in effect for applications received on or after 1 June 2026.',
      },
      publishedAt: {
        value: '2026-05-19',
        quote: 'The Canada Revenue Agency has implemented a streamlined process',
      },
      effectiveAt: {
        value: '2026-06-01',
        quote: 'in effect for applications received on or after 1 June 2026',
      },
      actionDeadlineAt: null,
      primaryTopic: {
        value: 'withholding',
        quote: 'Regulation 102 requires withholding on employment income earned in Canada by a non-resident employee',
      },
    },
    verification: 'official_confirmed',
    confidence: 'high',
    jurisdictions: [
      { code: 'CA', role: 'affected', quote: 'employment income earned in Canada by a non-resident employee' },
      { code: 'CA', role: 'host', quote: 'before the employee begins work in Canada' },
    ],
    topics: [
      { topic: 'withholding', quote: 'Regulation 102 requires withholding on employment income earned in Canada' },
      { topic: 'payroll', quote: 'withholding must be applied until a waiver is issued' },
      { topic: 'reporting', quote: 'waiver applications submitted by non-resident employers' },
    ],
    populations: [
      { population: 'business_travelers', quote: 'before the employee begins work in Canada' },
      { population: 'expatriates', quote: 'employment income earned in Canada by a non-resident employee' },
      { population: 'employers', quote: 'waiver applications submitted by non-resident employers' },
    ],
    interpretation: {
      learn_summary:
        'When a foreign employer sends someone to work in Canada, Canada normally expects tax to be withheld from their pay. You can apply for a waiver to avoid that. Canada has now promised a decision before the work starts — but only if you apply at least 30 days ahead. Apply later and you must withhold until the waiver actually arrives.',
      professional_summary:
        'CRA streamlined Regulation 102 waiver process, effective for applications received on or after 1 June 2026. Applications filed 30+ days before the Canadian work start date receive a decision before commencement. Late applications are still processed but withholding applies until issuance. Certified non-resident employer regime unchanged.',
      employee_effect:
        'Where a waiver is obtained in time, the employee avoids Canadian withholding on income they may not ultimately owe tax on, and avoids having to reclaim it through a return. Late applications mean cash is withheld in the meantime.',
      employer_effect:
        'This turns a tax outcome into a scheduling problem. The 30-day lead time has to be built into assignment initiation, because the consequence of missing it is a withholding obligation that is inconvenient rather than avoidable.',
      gms_effect:
        'Check whether the assignment initiation process gives 30 days of notice before Canadian work starts. Short-notice business travel to Canada is the likely failure point. Where notice is short, withholding should be set up rather than assumed away.',
      review_actions:
        'Review lead times between assignment approval and Canadian work start; identify upcoming Canadian trips inside the 30-day window; confirm whether the certified non-resident employer route applies instead; ensure payroll is instructed to withhold where a waiver is not yet issued.',
    },
    interpretationEvidence: [
      'Under the streamlined process, applications submitted at least 30 days before the employee begins work in Canada will receive a decision before the work start date.',
      'Applications submitted with less than 30 days notice will continue to be processed, but the Agency states that withholding must be applied until a waiver is issued.',
      'The streamlined process is in effect for applications received on or after 1 June 2026.',
      'The Agency has also confirmed that the certified non-resident employer regime is unchanged by this announcement.',
    ],
    terms: [
      'withholding',
      'business-traveler',
      'shadow-payroll',
      'tax-treaty',
      'social-security-agreement',
    ],
  },

  /* ------------------------ 6. California — discussion stage, NO status quote */
  {
    slug: 'us-ca-nonresident-withholding-discussion',
    headline: 'California discussion paper raises nonresident withholding threshold for short visits',
    sourceName: 'California Franchise Tax Board — newsroom',
    document: {
      url: 'https://www.ftb.ca.gov/about-ftb/newsroom/discussion-paper-nonresident-wage-withholding.html',
      title: 'Discussion paper: nonresident wage withholding for short-duration work',
      publishedAt: '2026-09-11',
      text: [
        'The Franchise Tax Board has published a discussion paper inviting comment on the administration of wage withholding for nonresident employees performing short-duration work in California.',
        'The paper notes that employers currently face withholding obligations from the first California workday, and that this creates administrative burden disproportionate to the tax at stake for very short visits.',
        'The paper describes, without recommending, a possible de minimis threshold below which withholding would not be required.',
        'Several possible threshold designs are discussed, including a fixed number of workdays and a compensation-based test.',
        'The paper states that it does not represent the position of the Board and that no legislative or regulatory proposal has been made.',
      ].join(' '),
    },
    facts: {
      // Genuinely ambiguous: a discussion paper that disclaims the Board's own
      // position does not clearly establish a lifecycle status. Rather than
      // guess 'discussion', we leave it NULL and say so. This row exists to
      // exercise that rendering path.
      status: null,
      publishedAt: {
        value: '2026-09-11',
        quote: 'The Franchise Tax Board has published a discussion paper',
      },
      effectiveAt: null,
      actionDeadlineAt: null,
      primaryTopic: {
        value: 'withholding',
        quote: 'the administration of wage withholding for nonresident employees',
      },
    },
    // Official domain, but the document disclaims the Board's position and
    // proposes nothing. The verification ceiling permits 'official_confirmed'
    // here on tier alone; we deliberately claim less, because what is confirmed
    // is only that a discussion paper exists.
    verification: 'single_source',
    confidence: 'low',
    uncertaintyNote:
      'This is a discussion paper that explicitly disclaims the Board\'s position and makes no proposal. Its lifecycle status is not stated and has been left blank rather than guessed. Nothing here should be acted on; it is included because a de minimis threshold would be significant for US state-to-state travel if it ever materialised.',
    jurisdictions: [
      { code: 'US-CA', role: 'affected', quote: 'nonresident employees performing short-duration work in California' },
      { code: 'US-CA', role: 'host', quote: 'from the first California workday' },
    ],
    topics: [
      { topic: 'withholding', quote: 'the administration of wage withholding for nonresident employees' },
      { topic: 'payroll', quote: 'employers currently face withholding obligations from the first California workday' },
    ],
    populations: [
      { population: 'domestic_state_workers', quote: 'nonresident employees performing short-duration work in California' },
      { population: 'business_travelers', quote: 'disproportionate to the tax at stake for very short visits' },
      { population: 'employers', quote: 'employers currently face withholding obligations from the first California workday' },
    ],
    interpretation: {
      learn_summary:
        'California currently expects withholding from an employee\'s very first workday in the state, even for a one-day trip. This paper asks whether there should be a minimum below which employers do not have to bother. It is a conversation, not a plan — the paper says outright that it is not the Board\'s position and proposes nothing.',
      professional_summary:
        'FTB discussion paper on nonresident wage withholding for short-duration California work. Observes disproportionate administrative burden given withholding applies from day one. Canvasses a possible de minimis threshold, including day-count and compensation-based designs, without recommendation. Expressly not the Board\'s position; no legislative or regulatory proposal made. Lifecycle status not stated in source.',
      employee_effect:
        'None. Nothing has changed and nothing has been proposed.',
      employer_effect:
        'None currently. Worth noting only because a de minimis threshold, if one were ever adopted, would remove a well-known source of administrative burden for short California visits.',
      gms_effect:
        'No action. This is a monitoring item, and a useful signal about where a state administrator sees friction. It should not appear in any client cost projection or advice.',
      review_actions:
        'No review action required. Monitor for a subsequent proposal. If tracking, note current California day-one withholding exposure for short visits so any future threshold can be assessed quickly.',
      uncertainty:
        'The document disclaims the Board\'s position and makes no proposal, so no conclusion about future California withholding rules is supportable. Its lifecycle status is not stated in the source and has been left blank. Before drawing any inference, an actual proposal with a text and an effective date would be needed.',
    },
    interpretationEvidence: [
      'The paper notes that employers currently face withholding obligations from the first California workday, and that this creates administrative burden disproportionate to the tax at stake for very short visits.',
      'The paper describes, without recommending, a possible de minimis threshold below which withholding would not be required.',
      'The paper states that it does not represent the position of the Board and that no legislative or regulatory proposal has been made.',
    ],
    terms: ['withholding', 'business-traveler', 'home-country', 'host-country'],
  },
]

/* ==========================================================================
 * Vocabulary — the foundational terms named in the brief
 * ========================================================================== */

type VocabSeed = Omit<typeof vocabTerms.$inferInsert, 'id'> & { related?: string[] }

const VOCAB: VocabSeed[] = [
  {
    slug: 'home-country',
    term: 'Home country',
    definition: 'The country an employee normally lives and works in before going on assignment.',
    whyItMatters:
      'Almost every mobility question is really a question about two countries at once. The home country is the baseline you compare everything against — pay, tax, social security, benefits.',
    example:
      'An employee based in Chicago is sent to work in Dublin for two years. The United States is the home country.',
    commonMisunderstanding:
      'Home country is not the same as nationality. A French citizen who has lived and worked in Canada for years has Canada as their home country for assignment purposes.',
    category: 'assignments',
    related: ['host-country', 'expatriate'],
  },
  {
    slug: 'host-country',
    term: 'Host country',
    definition: 'The country an employee is sent to work in during an assignment.',
    whyItMatters:
      'The host country usually gets the first claim to tax the work performed there, which is what creates most of the compliance work.',
    example: 'For a Chicago-based employee assigned to Dublin, Ireland is the host country.',
    commonMisunderstanding:
      'An employee can work in a country without it being a host country in the assignment sense — a three-day business trip is normally business travel, not an assignment.',
    category: 'assignments',
    related: ['home-country', 'business-traveler'],
  },
  {
    slug: 'expatriate',
    term: 'Expatriate',
    definition:
      'An employee sent by their employer to live and work in another country, usually for a fixed period.',
    whyItMatters:
      'Expatriates are the classic global mobility population: long enough abroad to trigger tax residency, payroll, social security, and benefits questions all at once.',
    example:
      'An engineer relocated from Toronto to London for three years, with housing and schooling provided, is an expatriate.',
    commonMisunderstanding:
      '"Expatriate" describes the working arrangement, not the person\'s seniority or salary. It is also not the same as an immigrant, who moves permanently and on their own initiative.',
    category: 'assignments',
    related: ['business-traveler', 'assignment-allowance', 'tax-equalization'],
  },
  {
    slug: 'business-traveler',
    term: 'Business traveler',
    definition:
      'An employee who works in another country for short periods without relocating there.',
    whyItMatters:
      'Business travelers are the hardest population to get right, because the trips are short, frequent, booked at short notice, and often invisible to the tax team until they add up to a problem.',
    example:
      'A sales director based in New York who spends eight days a month in the United Kingdom is a business traveler.',
    commonMisunderstanding:
      'Short trips are not automatically tax-free. Many countries count any day on which work is performed, and some create withholding obligations from the very first day.',
    category: 'assignments',
    related: ['expatriate', 'withholding', 'tax-residency'],
  },
  {
    slug: 'tax-residency',
    term: 'Tax residency',
    definition:
      'The status that determines which country can tax a person on their worldwide income, rather than only on income earned there.',
    whyItMatters:
      'It is the single biggest lever in an assignment\'s tax cost. Becoming resident somewhere can expose income that has nothing to do with the assignment.',
    example:
      'An employee who spends enough days in the United States may meet the substantial presence test and become a US tax resident, even while remaining on a foreign payroll.',
    commonMisunderstanding:
      'Tax residency is not the same as immigration status or citizenship. Someone can hold a work visa without being tax resident, and can be tax resident without any visa at all.',
    category: 'residency',
    related: ['home-country', 'business-traveler', 'tax-treaty'],
  },
  {
    slug: 'withholding',
    term: 'Withholding',
    definition:
      'Tax that an employer deducts from an employee\'s pay and sends to the tax authority on their behalf.',
    whyItMatters:
      'Withholding is the employer\'s own legal obligation, not the employee\'s. Getting it wrong creates exposure for the company regardless of what the employee eventually owes.',
    example:
      'A non-resident employer sending someone to work in Canada may have to withhold Canadian tax from their pay unless a waiver is granted first.',
    commonMisunderstanding:
      'Withholding is not the final tax bill. It is a prepayment — the employee may owe more or get a refund when they file.',
    category: 'payroll',
    related: ['shadow-payroll', 'business-traveler', 'tax-settlement'],
  },
  {
    slug: 'shadow-payroll',
    term: 'Shadow payroll',
    definition:
      'A second, reporting-only payroll run in the host country for an employee who is actually paid from their home country.',
    whyItMatters:
      'It is how a company meets host-country reporting and withholding obligations without moving the employee off their home payroll — one of the most common mobility payroll setups.',
    example:
      'An employee stays on the US payroll while working in Ireland. A shadow payroll is run in Ireland to report the income and pay Irish tax, even though no cash is paid from Ireland.',
    commonMisunderstanding:
      'The employee is not paid twice. No money leaves the shadow payroll to the employee — it exists to report income and remit tax.',
    category: 'payroll',
    related: ['withholding', 'reconciliation', 'hypothetical-tax'],
  },
  {
    slug: 'hypothetical-tax',
    term: 'Hypothetical tax',
    definition:
      'An estimated amount deducted from an assignee\'s pay representing the tax they would have paid had they stayed at home.',
    whyItMatters:
      'It is the mechanism that makes tax equalization work in practice: the employee keeps contributing their normal tax cost while the company handles the actual foreign bills.',
    example:
      'An assignee who would have paid $30,000 of US tax at home has hypothetical tax deducted through payroll, while the company pays the real US and Irish liabilities.',
    commonMisunderstanding:
      'Hypothetical tax is not sent to any tax authority. It is an internal deduction retained by the employer to offset the actual taxes it pays.',
    category: 'tax',
    related: ['tax-equalization', 'tax-protection', 'tax-settlement'],
  },
  {
    slug: 'tax-equalization',
    term: 'Tax equalization',
    definition:
      'A policy under which an assignee ends up in roughly the same after-tax position as if they had never left home, with the employer absorbing the difference.',
    whyItMatters:
      'It removes tax from the employee\'s decision about whether to accept an assignment, which is why most large assignment programmes use it. It also makes the employer bear the cost volatility.',
    example:
      'An employee moving from the US to a higher-tax country pays hypothetical US tax; the employer pays the actual, higher foreign tax.',
    commonMisunderstanding:
      'Equalization does not mean the employee pays nothing. They continue to bear a home-country-equivalent tax cost through hypothetical tax.',
    category: 'policy',
    related: ['tax-protection', 'hypothetical-tax', 'tax-settlement'],
  },
  {
    slug: 'tax-protection',
    term: 'Tax protection',
    definition:
      'A policy under which an assignee pays their actual taxes but is reimbursed if the total exceeds what they would have paid at home.',
    whyItMatters:
      'It is the main alternative to equalization, and it behaves differently: the employee keeps any windfall from moving to a lower-tax country, whereas under equalization the company does.',
    example:
      'An assignee in a lower-tax country pays less tax overall and keeps the benefit. Under tax equalization, that saving would have gone to the employer.',
    commonMisunderstanding:
      'Tax protection and tax equalization are often used interchangeably, but they allocate upside differently — that distinction drives real cost differences.',
    category: 'policy',
    related: ['tax-equalization', 'hypothetical-tax'],
  },
  {
    slug: 'tax-treaty',
    term: 'Tax treaty',
    definition:
      'An agreement between two countries that decides which of them may tax particular income, to prevent the same income being taxed twice.',
    whyItMatters:
      'Treaties often provide the relief that makes an assignment affordable, but the relief usually has conditions — day counts, who pays the salary, whether there is a permanent establishment.',
    example:
      'A treaty may exempt a short-term visitor\'s employment income from host-country tax if they spend under 183 days there and are paid by a non-resident employer.',
    commonMisunderstanding:
      'Treaty relief is rarely automatic. It usually must be claimed, and it can be lost by a fact as mundane as who recharges the salary cost.',
    category: 'treaties',
    related: ['permanent-establishment', 'tax-residency', 'social-security-agreement'],
  },
  {
    slug: 'permanent-establishment',
    term: 'Permanent establishment',
    definition:
      'A taxable business presence that a company can create in another country, exposing it to corporate tax there.',
    whyItMatters:
      'It is the mobility risk that is not about the employee at all. One senior person working abroad can create a corporate tax exposure far larger than their own tax bill.',
    example:
      'A sales employee habitually concluding contracts in a country where the company has no office may create a permanent establishment there.',
    commonMisunderstanding:
      'It does not require an office or any premises. Activity carried out by a person can be enough on its own.',
    category: 'treaties',
    related: ['tax-treaty', 'business-traveler'],
  },
  {
    slug: 'social-security-agreement',
    term: 'Social security agreement',
    definition:
      'An agreement between two countries that stops an employee having to pay social security in both, and protects their benefit entitlements. Also called a totalization agreement.',
    whyItMatters:
      'Social security is frequently a bigger cost than income tax, and double contributions are a pure waste. These agreements are also a common source of missed savings.',
    example:
      'A US employee assigned to Ireland can stay in the US social security system and be exempt from Irish contributions, with a certificate of coverage as proof.',
    commonMisunderstanding:
      'It is separate from the income tax treaty and has to be claimed separately, usually with a certificate. Having a tax treaty does not mean there is a social security agreement.',
    category: 'social_security',
    related: ['tax-treaty', 'assignment-allowance'],
  },
  {
    slug: 'assignment-allowance',
    term: 'Assignment allowance',
    definition:
      'Extra payments or benefits given to an employee because of an assignment, such as housing, schooling, cost-of-living, or relocation support.',
    whyItMatters:
      'Allowances are usually taxable in the host country, often at the employer\'s cost under equalization, so they drive assignment cost far more than base salary changes do.',
    example: 'A company pays an assignee\'s rent in London and covers school fees for two children.',
    commonMisunderstanding:
      'Allowances are rarely tax-free just because they are reimbursements. Most are treated as employment income, and the treatment varies by country.',
    category: 'benefits',
    related: ['tax-equalization', 'expatriate'],
  },
  {
    slug: 'tax-settlement',
    term: 'Tax settlement',
    definition:
      'The year-end calculation that works out what the employee and employer each actually owe once real tax returns are filed.',
    whyItMatters:
      'It is where the estimates used during the year get trued up. Until settlement, an assignment\'s cost is a forecast, not a number.',
    example:
      'After filing, the hypothetical tax withheld from an assignee is compared with the actual taxes paid, and the difference is settled between employee and employer.',
    commonMisunderstanding:
      'Settlement is not the tax return itself. The return is filed with the authority; the settlement is the internal reconciliation between employee and employer.',
    category: 'compliance',
    related: ['hypothetical-tax', 'reconciliation', 'tax-equalization'],
  },
  {
    slug: 'reconciliation',
    term: 'Reconciliation',
    definition:
      'Checking that the compensation, tax, and payroll figures recorded across different systems and countries actually agree.',
    whyItMatters:
      'Mobility data lives in several places at once — home payroll, shadow payroll, the tax provider, the accrual. When they disagree, the tax filings and the assignment cost are both wrong.',
    example:
      'The compensation reported on an Irish shadow payroll is reconciled against the amounts actually paid from the US payroll for the same employee.',
    commonMisunderstanding:
      'It is not just a year-end task. Errors caught in a quarterly reconciliation are much cheaper to fix than ones found after filing.',
    category: 'compliance',
    related: ['shadow-payroll', 'tax-settlement'],
  },
]

/* ==========================================================================
 * Insert
 * ========================================================================== */

/**
 * Creates an evidence span by LOCATING the quote in the document text.
 *
 * The offsets are derived, never asserted — so a quote that isn't a verbatim
 * substring of the source is a hard failure rather than a silently wrong
 * citation. This is the same check the real extraction pipeline will apply to
 * model output, which is why the seed data goes through it too.
 */
async function createEvidence(rawDocumentId: string, documentText: string, quote: string) {
  const charStart = documentText.indexOf(quote)
  if (charStart === -1) {
    throw new Error(
      `Quote not found verbatim in source text.\n  Quote: "${quote}"\n  This must be an exact substring of the document.`,
    )
  }
  if (documentText.indexOf(quote, charStart + 1) !== -1) {
    throw new Error(`Quote is ambiguous (appears more than once): "${quote}"`)
  }

  const [row] = await db
    .insert(evidenceSpans)
    .values({
      rawDocumentId,
      quote,
      charStart,
      charEnd: charStart + quote.length,
    })
    .returning({ id: evidenceSpans.id })

  return row.id
}

async function clearExistingContent() {
  // Order matters: developments hold FKs into evidence_spans, and evidence_spans
  // hold FKs into raw_documents. Cascades handle the join tables and
  // interpretations. Only seed rows are removed.
  await db.delete(developments).where(eq(developments.isSeedData, true))
  await db.delete(evidenceSpans)
  await db.delete(rawDocuments)
  await db.delete(vocabRelations)
  await db.delete(vocabTerms)
}

async function seedVocabulary() {
  // `related` is seed-only wiring (slugs), not a column — strip it before insert.
  const termRows = VOCAB.map((term) => {
    const row = { ...term }
    delete row.related
    return row
  })

  const inserted = await db
    .insert(vocabTerms)
    .values(termRows)
    .returning({ id: vocabTerms.id, slug: vocabTerms.slug })

  const bySlug = new Map(inserted.map((t) => [t.slug, t.id]))

  const relationRows: (typeof vocabRelations.$inferInsert)[] = []
  for (const term of VOCAB) {
    const termId = bySlug.get(term.slug)
    if (!termId) continue
    for (const relatedSlug of term.related ?? []) {
      const relatedId = bySlug.get(relatedSlug)
      if (!relatedId) {
        throw new Error(`Term '${term.slug}' references unknown related term '${relatedSlug}'`)
      }
      relationRows.push({ termId, relatedTermId: relatedId })
    }
  }
  if (relationRows.length > 0) {
    await db.insert(vocabRelations).values(relationRows)
  }

  return { terms: inserted.length, relations: relationRows.length }
}

async function seedDevelopment(seed: SeedDevelopment) {
  const [source] = await db.select().from(sources).where(eq(sources.name, seed.sourceName))
  if (!source) {
    throw new Error(`Unknown source '${seed.sourceName}'. Run db:seed:sources first.`)
  }

  const text = seed.document.text

  const [doc] = await db
    .insert(rawDocuments)
    .values({
      sourceId: source.id,
      url: seed.document.url,
      title: seed.document.title,
      publisher: source.publisher,
      publishedAt: new Date(seed.document.publishedAt),
      language: seed.document.language ?? 'en',
      rawText: text,
      httpStatus: 200,
    })
    .returning({ id: rawDocuments.id })

  // Cache spans so a quote reused across fields creates one row, not several.
  const spanCache = new Map<string, string>()
  const ev = async (quote: string) => {
    const cached = spanCache.get(quote)
    if (cached) return cached
    const id = await createEvidence(doc.id, text, quote)
    spanCache.set(quote, id)
    return id
  }

  const row: typeof developments.$inferInsert = {
    slug: seed.slug,
    headline: seed.headline,
    status: seed.facts.status?.value ?? null,
    statusEvidenceId: seed.facts.status ? await ev(seed.facts.status.quote) : null,
    publishedAt: seed.facts.publishedAt?.value ?? null,
    publishedAtEvidenceId: seed.facts.publishedAt ? await ev(seed.facts.publishedAt.quote) : null,
    effectiveAt: seed.facts.effectiveAt?.value ?? null,
    effectiveAtEvidenceId: seed.facts.effectiveAt ? await ev(seed.facts.effectiveAt.quote) : null,
    actionDeadlineAt: seed.facts.actionDeadlineAt?.value ?? null,
    actionDeadlineEvidenceId: seed.facts.actionDeadlineAt
      ? await ev(seed.facts.actionDeadlineAt.quote)
      : null,
    primaryTopic: seed.facts.primaryTopic?.value ?? null,
    primaryTopicEvidenceId: seed.facts.primaryTopic ? await ev(seed.facts.primaryTopic.quote) : null,
    verification: seed.verification,
    confidence: seed.confidence,
    uncertaintyNote: seed.uncertaintyNote ?? null,
    reviewState: 'approved',
    isSeedData: true,
  }

  // The same gate the pipeline will run. Seed data does not get a free pass —
  // if a fact here lacked its quote, this would refuse to insert it.
  const violations = checkDevelopmentEvidence(row as Record<string, unknown>)
  if (hasBlockingError(violations)) {
    throw new Error(`Seed '${seed.slug}' violates the evidence rule:\n${formatViolations(violations)}`)
  }

  const [development] = await db.insert(developments).values(row).returning({ id: developments.id })

  await db.insert(developmentSources).values({
    developmentId: development.id,
    rawDocumentId: doc.id,
    role: 'primary',
  })

  for (const j of seed.jurisdictions) {
    await db.insert(developmentJurisdictions).values({
      developmentId: development.id,
      jurisdictionCode: j.code,
      role: j.role,
      evidenceId: j.quote ? await ev(j.quote) : null,
    })
  }

  for (const t of seed.topics) {
    await db.insert(developmentTopics).values({
      developmentId: development.id,
      topic: t.topic,
      evidenceId: t.quote ? await ev(t.quote) : null,
    })
  }

  for (const p of seed.populations) {
    await db.insert(developmentPopulations).values({
      developmentId: development.id,
      population: p.population,
      evidenceId: p.quote ? await ev(p.quote) : null,
    })
  }

  // Resolve the quotes this development's interpretation reasons from, once.
  const groundingIds = await Promise.all(seed.interpretationEvidence.map((quote) => ev(quote)))

  for (const [kind, body] of Object.entries(seed.interpretation)) {
    const isUncertain = kind === 'uncertainty'

    // Rule 4: interpretation must be grounded in quotes, or explicitly marked
    // uncertain. Checked before insert, same as the pipeline will.
    const violations = checkInterpretationGrounding({
      kind,
      body,
      isUncertain,
      evidenceIds: groundingIds,
    })
    if (hasBlockingError(violations)) {
      throw new Error(
        `Seed '${seed.slug}' interpretation '${kind}' is ungrounded:\n${formatViolations(violations)}`,
      )
    }

    const [row] = await db
      .insert(interpretations)
      .values({
        developmentId: development.id,
        kind: kind as (typeof interpretations.$inferInsert)['kind'],
        body,
        // Seed prose is hand-written, so there is no model to attribute. The
        // real pipeline records the model id here; leaving it null is honest.
        model: null,
        promptVersion: 'seed-v1',
        isUncertain,
      })
      .returning({ id: interpretations.id })

    // Link the interpretation to the quotes it rests on, so the UI can show
    // "what this is based on" rather than asking the reader to take it on trust.
    if (groundingIds.length > 0) {
      await db.insert(interpretationEvidence).values(
        groundingIds.map((evidenceId) => ({ interpretationId: row.id, evidenceId })),
      )
    }
  }

  return {
    slug: seed.slug,
    spans: spanCache.size,
    nullFacts: Object.entries(seed.facts).filter(([, v]) => v === null).length,
  }
}

/**
 * Links each development to the vocabulary terms it actually mentions.
 *
 * "Terms mentioned in an update should be tappable and linked to their
 * vocabulary cards."
 *
 * Done by scanning text for each term, not by hand-listing them and not by
 * asking a model. It is a string search over a controlled 16-term list, so a
 * deterministic pass is both cheaper and more reliable — and it keeps working
 * when new terms are added without anyone revisiting the seed data.
 *
 * Two details that matter:
 *
 *   - Word-boundary matching, so "expatriate" does not match inside a longer
 *     word and "tax" does not light up on "taxable" or "syntax".
 *   - Plural tolerance via an optional trailing "s", which covers
 *     "business travelers" / "business traveler" without a stemmer.
 */
async function linkDevelopmentTerms() {
  const terms = await db
    .select({ id: vocabTerms.id, term: vocabTerms.term, slug: vocabTerms.slug })
    .from(vocabTerms)

  const termIdBySlug = new Map(terms.map((t) => [t.slug, t.id]))
  const editorialBySlug = new Map(DEVELOPMENTS.map((d) => [d.slug, d.terms]))

  const allDevelopments = await db
    .select({ id: developments.id, slug: developments.slug, headline: developments.headline })
    .from(developments)

  let linkCount = 0
  let scanHits = 0

  for (const development of allDevelopments) {
    // Scan exactly the text the reader is actually shown on the update page:
    // the headline, every interpretation body, and the evidence quotes (which
    // are displayed, expandable, next to each fact).
    //
    // Deliberately NOT the full raw document. A term buried in a paragraph the
    // reader never sees is not something they encountered, and linking it would
    // put a tappable term on a page where the term never appears.
    const [interpretationRows, quoteRows] = await Promise.all([
      db
        .select({ body: interpretations.body })
        .from(interpretations)
        .where(eq(interpretations.developmentId, development.id)),
      db
        .select({ quote: evidenceSpans.quote })
        .from(evidenceSpans)
        .innerJoin(rawDocuments, eq(evidenceSpans.rawDocumentId, rawDocuments.id))
        .innerJoin(developmentSources, eq(developmentSources.rawDocumentId, rawDocuments.id))
        .where(eq(developmentSources.developmentId, development.id)),
    ])

    const haystack = [
      development.headline,
      ...interpretationRows.map((i) => i.body),
      ...quoteRows.map((q) => q.quote),
    ]
      .join('\n')
      .toLowerCase()

    const scanned = terms.filter((t) => {
      const escaped = t.term.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      return new RegExp(`\\b${escaped}s?\\b`).test(haystack)
    })
    scanHits += scanned.length

    // Union of literal mentions and the editorial list. Deduped by id, so a
    // term found both ways produces one link.
    const editorialIds = (editorialBySlug.get(development.slug) ?? []).map((slug) => {
      const id = termIdBySlug.get(slug)
      if (!id) throw new Error(`Development '${development.slug}' references unknown term '${slug}'`)
      return id
    })

    const ids = [...new Set([...scanned.map((t) => t.id), ...editorialIds])]
    if (ids.length === 0) continue

    await db
      .insert(developmentTerms)
      .values(ids.map((termId) => ({ developmentId: development.id, termId })))
      .onConflictDoNothing()

    linkCount += ids.length
  }

  return { linkCount, scanHits }
}

async function main() {
  console.log('Seeding demonstration content...\n')
  console.log('  Reminder: stop `npm run dev` first. PGlite is single-process, so a running')
  console.log('            dev server will not see anything written here until it restarts.\n')
  console.log('  NOTE: these developments are ILLUSTRATIVE, modelled on real mechanisms but')
  console.log('        not real published guidance. Every row is flagged isSeedData: true.\n')

  await clearExistingContent()

  const vocab = await seedVocabulary()
  console.log(`  vocabulary:  ${vocab.terms} terms, ${vocab.relations} related-term links`)

  console.log(`\n  developments:`)
  let totalSpans = 0
  let totalNulls = 0
  for (const seed of DEVELOPMENTS) {
    const result = await seedDevelopment(seed)
    totalSpans += result.spans
    totalNulls += result.nullFacts
    console.log(
      `    ${result.slug.padEnd(44)} ${String(result.spans).padStart(2)} quotes` +
        (result.nullFacts > 0 ? `, ${result.nullFacts} fact(s) not stated in source` : ''),
    )
  }

  const { linkCount, scanHits } = await linkDevelopmentTerms()

  console.log(`\n  ${DEVELOPMENTS.length} developments, ${totalSpans} evidence spans, all quotes verified verbatim`)
  console.log(`  ${totalNulls} fact fields left NULL because the source does not state them`)
  console.log(`  ${linkCount} vocabulary links (${scanHits} from literal text matches, rest editorial)`)
  console.log('\nDone.')
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nSeed failed:', err instanceof Error ? err.message : err)
    process.exit(1)
  })
