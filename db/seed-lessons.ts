/**
 * Seed: the five-stage swipe-through lessons
 * ==========================================
 *
 * One lesson per development, following the brief's stage table exactly:
 *
 *   1 What happened          — plain language; where, status, dates, who, and
 *                              what is still unknown.
 *   2 Think about the impact — two or three beginner-friendly questions.
 *   3 Understand the answer  — why the right answer beats the alternatives.
 *   4 Apply it               — a short fictional client scenario.
 *   5 Professional summary   — client-ready takeaway, dates, review areas.
 *
 * THE CONSTRAINT THAT SHAPES THIS FILE
 *
 * "The system should never invent a definitive legal conclusion merely to
 * create a quiz. If the implication is uncertain, the lesson should say so and
 * ask what information would be needed before reaching a conclusion."
 *
 * A model asked to write a quiz will produce a confident correct answer whether
 * or not the source supports one — which is why this is a structural problem,
 * not a prompting one. So every correct answer here is backed one of two ways,
 * and `checkQuestionValidity()` rejects the lesson if neither holds:
 *
 *   (a) it cites a verbatim quote, or
 *   (b) it is flagged `isInsufficientInfo` — "there isn't enough here to
 *       decide" — which is a legitimate and often the BEST answer.
 *
 * Two questions in this file use (b) with no citation at all, and they are the
 * most important questions in the set:
 *
 *   - "When does the US guidance take effect?" The document is silent. There is
 *     no quote to cite because there is nothing to cite. The correct answer is
 *     that you would have to go and find out.
 *   - "Will California adopt a de minimis threshold?" Unknowable. A discussion
 *     paper that disclaims its own authority supports no prediction.
 *
 * A quiz that forced a confident answer to either would be teaching a beginner
 * the exact habit this product exists to counter.
 *
 * Run with:  npm run db:seed:lessons   (after db:seed:content)
 */

// MUST be the first import. db/index.ts decides between Neon and PGlite by
// reading DATABASE_URL at module load, so the env file has to be loaded before
// that module is evaluated. Without this the script silently writes to the
// LOCAL database and reports success — which is exactly what happened: the
// schema went to Neon (drizzle.config.ts loads .env.local itself) while every
// seeded row went to PGlite.
import '../pipeline/env'
import { and, eq } from 'drizzle-orm'
import { db } from './index'
import {
  developments,
  developmentSources,
  evidenceSpans,
  lessonOptions,
  lessonQuestions,
  lessonStages,
  lessons,
  rawDocuments,
} from './schema'
import { checkQuestionValidity, formatViolations, hasBlockingError } from './invariants'

/* ==========================================================================
 * Seed shapes
 * ========================================================================== */

type SeedOption = {
  label: string
  correct?: boolean
  /** Verbatim quote from the source that makes this option correct. */
  quote?: string
  /** Marks the "not enough information to decide" option. */
  insufficientInfo?: boolean
  whyWeaker?: string
}

type SeedQuestion = {
  kind: 'multiple_choice' | 'select_all' | 'matching' | 'scenario'
  prompt: string
  /** Stage 3 content: why the answer is stronger than the alternatives. */
  explanation: string
  options: SeedOption[]
}

type SeedLesson = {
  developmentSlug: string
  /** Stage 1. */
  whatHappened: string
  questions: SeedQuestion[]
  /** Stage 4 — always a fictional client, always labelled synthetic. */
  applyIt: string
  /** Stage 5. */
  professionalSummary: string
}

/* ==========================================================================
 * The lessons
 * ========================================================================== */

const LESSONS: SeedLesson[] = [
  /* ------------------------------------------------------------------ UK */
  {
    developmentSlug: 'gb-paye-short-term-business-visitors',
    whatHappened: `The UK tax authority (HMRC) has updated its guidance on a shortcut available to employers who send staff to the UK for short work trips.

Normally, if someone works in the UK, their employer has to run UK payroll and report every single payment as it happens. That is a lot of administration for someone who visits for a week.

The shortcut lets an employer report once a year instead — but only for employees who stay under 60 UK workdays in a tax year, and only if the employer applies in writing before the tax year begins.

Status: this is official guidance, meaning HMRC explaining how it will apply existing rules, not a new law. It takes effect for the 2027 to 2028 UK tax year, which starts on 6 April 2027.

What it does NOT change: whether an employee is UK tax resident. That is still decided by a separate test.`,
    questions: [
      {
        kind: 'multiple_choice',
        prompt: 'Which group of employees is this shortcut designed for?',
        explanation:
          'The guidance is aimed squarely at short-term business visitors — the source sets the boundary at fewer than 60 UK workdays in a tax year. Long-term assignees who relocate to the UK blow past that threshold almost immediately, so the annual reporting shortcut is not available for them. Note that the test is workdays, not calendar days: a visitor could be in the UK far longer than 60 days and still qualify if most of those days were not workdays.',
        options: [
          {
            label: 'Employees making short UK work trips, under 60 UK workdays in the tax year',
            correct: true,
            quote:
              'employees who spend fewer than 60 UK workdays in a tax year',
          },
          {
            label: 'Employees who relocate to the UK for a two-year assignment',
            whyWeaker:
              'A two-year assignee would exceed 60 UK workdays within a few months, so the arrangement would not apply.',
          },
          {
            label: 'All employees of any company with a UK office',
            whyWeaker:
              'The arrangement is about specific short-visit employees, not a blanket rule for an employer.',
          },
          {
            label: 'Employees who are already UK tax resident',
            whyWeaker:
              'The guidance explicitly does not change anyone’s residence position; residence is decided by a separate test.',
          },
        ],
      },
      {
        kind: 'multiple_choice',
        prompt:
          'An employer wants to use the annual reporting shortcut for the 2027/28 tax year. What must it do?',
        explanation:
          'The timing is the trap. The application has to be in writing and it has to land before 6 April — before the tax year it covers even starts. An employer that realises in September that it would like the shortcut has already missed it for that year. This is why the practical GMS work here is calendar management, not tax analysis.',
        options: [
          {
            label: 'Apply to HMRC in writing before 6 April 2027',
            correct: true,
            quote: 'Employers must apply in writing before 6 April of the relevant tax year',
          },
          {
            label: 'Apply at the end of the tax year, when the workday totals are known',
            whyWeaker:
              'Too late. The source requires the application before the relevant tax year begins, not after it ends.',
          },
          {
            label: 'Nothing — the arrangement applies automatically once an employee is under 60 workdays',
            whyWeaker:
              'It is an arrangement the employer applies for. There is nothing automatic about it.',
          },
        ],
      },
    ],
    applyIt: `A fictional client, Northwind Systems, sends four engineers from its Toronto office to a customer site in Manchester. Each is expected to spend roughly 25 UK workdays during the 2027/28 tax year. They stay on Canadian payroll throughout.

Northwind's HR team asks whether it can use the annual PAYE reporting arrangement.

What would you want to check before answering?`,
    professionalSummary: `HMRC guidance on PAYE special arrangements for short-term business visitors, effective for 2027/28 (from 6 April 2027).

Annual rather than real-time reporting is permitted where UK workdays are below 60 per employee per tax year. Written application required before 6 April; approvals already in place carry over without reapplication. Exceeding 60 workdays triggers a 30-day notification obligation and reversion to standard reporting from the breach date. No impact on statutory residence test outcomes.

Suggested review areas: completeness of UK workday records; identification of employees approaching the threshold; whether an existing approval covers the population; named owner for the 30-day breach notification.

Uncertainty: none material. Dates and thresholds are stated directly in the source.`,
  },

  /* ---------------------------------- US — the "no effective date" lesson */
  {
    developmentSlug: 'us-remote-work-presence-guidance',
    whatHappened: `The US tax authority (the IRS) has published guidance on how to count days when someone works in the United States temporarily while still being paid from another country.

Two things it makes clear:

First, if an employee performs any work at all in the US on a given day, that whole day counts towards US tax residency. One hour counts the same as ten.

Second, days spent only travelling — with no work done — do not count, but only if the employer wrote that down at the time. A record reconstructed months later does not satisfy this.

It also says something blunt that employers sometimes get wrong: paying someone from a foreign payroll does not, by itself, remove a US withholding obligation.

What is missing: the guidance does not say when it takes effect, and it explicitly does not deal with equity compensation such as share options.`,
    questions: [
      {
        kind: 'multiple_choice',
        prompt:
          'An employee flies to New York and answers work emails for about an hour before going to a personal event. Does that day count towards US tax residency?',
        explanation:
          'Yes, and the "about an hour" is a red herring. The source is explicit that any services performed in the US on a day makes it a day of presence regardless of hours. This matters more than it sounds: mobility teams often estimate day counts from expense claims or calendar entries, which systematically under-count days where only a little work happened.',
        options: [
          {
            label: 'Yes — performing any work in the US makes it a counted day',
            correct: true,
            quote: 'regardless of the number of hours worked',
          },
          {
            label: 'No — an hour is too little to count',
            whyWeaker:
              'There is no minimum-hours threshold in the source. The test is whether any services were performed.',
          },
          {
            label: 'No — it counts as a travel day because they flew in that morning',
            whyWeaker:
              'Travel days are excluded only where NO services are performed. Work was done, so the travel exclusion does not apply.',
          },
          {
            label: 'Only if the employee is paid from a US payroll',
            whyWeaker:
              'Day counting has nothing to do with which payroll pays the employee. The source separately warns that foreign payroll does not remove US obligations.',
          },
        ],
      },
      {
        kind: 'multiple_choice',
        prompt: 'From what date does this guidance apply?',
        explanation:
          'This is the honest answer, and it is worth sitting with. The source announces no effective date, so there is nothing to cite — and guessing would mean inventing a fact. Notice what the wrong answers have in common: each substitutes a date that IS available (publication date, tax year start) for the one that is missing. That substitution is the single most common way a summary quietly becomes untrue. For a real client question, you would go back to the authority or to a practitioner source and confirm; you would not assume.',
        options: [
          {
            label: 'Not enough information — the source does not state an effective date',
            correct: true,
            insufficientInfo: true,
          },
          {
            label: 'From its publication date, 2 September 2026',
            whyWeaker:
              'Publication and effect are different things. Assuming they are the same is exactly the substitution the source does not support.',
          },
          {
            label: 'From the start of the next US tax year, 1 January 2027',
            whyWeaker:
              'A plausible-sounding guess, but the source says nothing about tax-year alignment. Plausible is not the same as stated.',
          },
          {
            label: 'It applies retroactively to all open tax years',
            whyWeaker:
              'Nothing in the source addresses retroactivity in either direction.',
          },
        ],
      },
    ],
    applyIt: `A fictional client, Delta Harbour Ltd, has a UK-based employee who spends roughly two days a month in its New York office. She stays on the UK payroll. Travel is booked centrally, but work locations are not separately recorded — the team estimates US days from expense claims.

Delta Harbour asks whether her US days are a problem.

What would you need before you could answer?`,
    professionalSummary: `IRS guidance on day-counting for the substantial presence test where services are performed in the US on a temporary basis under a foreign payroll.

Any services performed in-country on a given day constitutes a full day of presence, irrespective of hours. Non-service travel days are excluded subject to contemporaneous records. Foreign payroll does not extinguish US withholding obligations.

Suggested review areas: source and timeliness of travel-day data (expense-claim-derived day counts will under-report); identification of employees near a substantial-presence threshold; withholding positions currently justified by payroll location alone.

Uncertainty — material. No effective date is stated, so it is not known whether this applies to the current tax year. Equity compensation sourcing is expressly out of scope and further guidance is expected with no announced date. Any advice on awards with a US workday component should disclose that this point is open.`,
  },

  /* ------------------------------------------------------- New York */
  {
    developmentSlug: 'us-ny-convenience-employer-proposal',
    whatHappened: `New York has a rule that surprises people. If a nonresident employee works for a New York employer but chooses to work from home in another state, New York generally still treats that as a New York workday — and taxes it.

New York has now put forward a proposal to soften this. If the employer genuinely maintains an office outside New York and assigns the employee to it, those days might stop counting as New York days.

The proposal lists factors for deciding whether an office is "genuine" — including whether the employer pays for the location and whether the employee's job actually requires them to be there.

The critical point: this is a proposal in a public comment period. It has not been adopted, and no start date has been put forward. Nothing has changed.`,
    questions: [
      {
        kind: 'multiple_choice',
        prompt:
          'A client asks whether it should stop withholding New York tax on its out-of-state remote workers. What is the right response?',
        explanation:
          'Nothing has changed, so nothing should change. The source states plainly that the amendment is in a comment period and has not been adopted. Acting on a proposal is a real and common error — it exposes the employer to under-withholding penalties for a rule that may never exist, or may arrive in a different form. The useful work right now is identifying who WOULD be affected, so that if it is adopted you can size the impact quickly.',
        options: [
          {
            label: 'No — this is only a proposal and has not been adopted',
            correct: true,
            quote: 'The amendment is subject to a public comment period and has not been adopted.',
          },
          {
            label: 'Yes — start applying the new exception to employees with a genuine out-of-state office',
            whyWeaker:
              'There is no exception to apply yet. The proposal has not been adopted and may change or be dropped.',
          },
          {
            label: 'Yes, but only from the start of the next tax year',
            whyWeaker:
              'This assumes adoption and invents a start date. The source says no effective date has even been proposed.',
          },
          {
            label: 'No — because New York never taxes out-of-state remote work',
            whyWeaker:
              'The opposite is true. Under the current rule those days generally ARE treated as New York workdays, which is why the proposal exists.',
          },
        ],
      },
      {
        kind: 'multiple_choice',
        prompt: 'If this proposal were adopted, when would it start to apply?',
        explanation:
          'Here the absence of a date is itself stated in the source — "No effective date has been proposed" — so unlike a silent document, we can actually cite the gap. That is a useful distinction to notice: sometimes a source tells you it does not know, and sometimes it simply says nothing. Both mean you cannot give a date, but only one of them can be evidenced.',
        options: [
          {
            label: 'Unknown — the source states that no effective date has been proposed',
            correct: true,
            quote: 'No effective date has been proposed.',
          },
          {
            label: 'Immediately on adoption',
            whyWeaker: 'An assumption. The source explicitly declines to propose a date.',
          },
          {
            label: 'At the close of the public comment period',
            whyWeaker:
              'The comment period closing is not the same as the rule taking effect, and no such link is stated.',
          },
        ],
      },
    ],
    applyIt: `A fictional client, Brightwater Media, is headquartered in New York. Eleven employees live in New Jersey and Connecticut and work from home three days a week. Brightwater rents a small shared office in Stamford and reimburses the cost, but nobody is formally assigned to it and attendance is optional.

Brightwater's finance director has read about the New York proposal and asks whether the company can start excluding those work-from-home days.

What would you say, and what would you want to establish?`,
    professionalSummary: `Proposed amendment to New York nonresident wage allocation under the convenience-of-the-employer rule.

Would introduce a bona fide employer office exception, with stated factors including employer reimbursement of the location and duty-driven presence. Currently in public comment; not adopted; no proposed effective date.

Suggested review areas: population of nonresidents with material out-of-state remote workdays; which locations might satisfy the bona fide factors; what documentation of assignment and reimbursement exists. Monitor for an adopted text.

Uncertainty — material. A proposal in comment may be amended substantially or withdrawn. No impact assessment should be relied on, and no withholding change should be made, on the basis of the current text.`,
  },

  /* --------------------------------------------------------- Ireland */
  {
    developmentSlug: 'ie-sarp-extension',
    whatHappened: `Ireland has a relief called SARP that exempts part of an assignee's salary from Irish income tax. It was due to run out; it has now been extended to people arriving up to the end of 2029.

But it has been made harder to qualify for. The minimum basic salary rises from €100,000 to €125,000 for anyone arriving on or after 1 January 2027.

People already certified under the old threshold keep their existing entitlement. They are not pushed out by the change.

One administrative trap: the employer has to certify an employee's arrival to Irish Revenue within 90 days. Miss that window and the claim cannot be made at all, no matter how clearly the employee qualifies.

Status: this was enacted in the Finance Act, so it is law, not a proposal.`,
    questions: [
      {
        kind: 'multiple_choice',
        prompt:
          'An assignee on a basic salary of €110,000 is due to arrive in Ireland in March 2027. Can they claim SARP?',
        explanation:
          '€110,000 sits in the gap created by the change. It cleared the old €100,000 threshold but falls short of the new €125,000 one, and a March 2027 arrival is on the wrong side of the 1 January 2027 cut-off. This is the population worth finding proactively: an assignment costed in 2026 on the assumption of SARP relief becomes materially more expensive, and nobody notices until the tax return.',
        options: [
          {
            label: 'No — from 1 January 2027 the minimum basic salary is €125,000',
            correct: true,
            quote:
              'increased from 100,000 euro to 125,000 euro for employees arriving on or after 1 January 2027',
          },
          {
            label: 'Yes — €110,000 is above the €100,000 minimum',
            whyWeaker:
              '€100,000 is the old threshold. It no longer applies to arrivals from 1 January 2027.',
          },
          {
            label: 'Yes — the relief was extended to 2029, so the old rules continue until then',
            whyWeaker:
              'The extension and the threshold increase are two separate changes. The relief runs longer AND is harder to qualify for.',
          },
          {
            label: 'No — SARP was abolished',
            whyWeaker: 'It was extended, not abolished.',
          },
        ],
      },
      {
        kind: 'multiple_choice',
        prompt:
          'An assignee arrived in Ireland in 2025 on €105,000 and was certified for SARP at the time. What happens to their relief from 2027?',
        explanation:
          'They keep it. The source confirms that employees already certified under the previous threshold retain their entitlement for the remainder of the relief period. The reason this is worth a question is that grandfathering is easy to get wrong in both directions — teams sometimes strip relief from people who are entitled to keep it, and sometimes assume grandfathering exists where it has not been granted.',
        options: [
          {
            label: 'They keep their existing entitlement for the rest of the relief period',
            correct: true,
            quote:
              'The updated manual confirms that employees already certified under the previous threshold retain their existing entitlement for the remainder of the relief period.',
          },
          {
            label: 'They lose relief from 1 January 2027 because they are below €125,000',
            whyWeaker:
              'The new threshold applies to arrivals from 2027, not retrospectively to people already certified.',
          },
          {
            label: 'They must be re-certified against the new threshold',
            whyWeaker:
              'No re-certification is required; the source says existing entitlement is retained.',
          },
        ],
      },
    ],
    applyIt: `A fictional client, Kestrel Life Sciences, has three assignments planned into Dublin for 2027. Base salaries are €98,000, €118,000 and €140,000. One assignee's start date is flexible and could be moved to December 2026.

Kestrel's mobility lead asks you to review the SARP position for all three.

Which ones matter, and what would you tell them?`,
    professionalSummary: `SARP extended to arrivals through 31 December 2029 per Finance Act; minimum qualifying basic salary increases from €100,000 to €125,000 for arrivals on or after 1 January 2027. Employees already certified under the prior threshold are grandfathered for the remainder of their relief period. Employer certification to Revenue required within 90 days of arrival as a condition of claim.

Suggested review areas: 2027+ Irish inbound pipeline with base salary between €100,000 and €125,000; reforecast of affected assignment cost projections; whether flexible start dates before 1 January 2027 are available and appropriate; audit of 90-day certification compliance for current arrivals.

Uncertainty: none material. Thresholds, dates, and grandfathering are stated directly.`,
  },

  /* ---------------------------------------------------------- Canada */
  {
    developmentSlug: 'ca-reg-102-waiver-process',
    whatHappened: `When a foreign employer sends someone to work in Canada, Canada normally expects tax to be withheld from that person's pay — even if they will not ultimately owe Canadian tax. You can apply for a waiver to avoid the withholding.

Canada has now promised faster handling: apply at least 30 days before the employee starts work in Canada, and you will get a decision before they start.

Apply with less notice and the application is still processed, but withholding has to be applied until the waiver actually arrives.

This is already in force — it applies to applications received from 1 June 2026 onwards.

A separate route, the certified non-resident employer regime, is unchanged.`,
    questions: [
      {
        kind: 'multiple_choice',
        prompt:
          'An employee is confirmed on Monday to start work in Canada in twelve days. A waiver application goes in immediately. What should payroll do?',
        explanation:
          'Twelve days is inside the 30-day window, so the guarantee of a pre-start decision does not apply. The source is direct about the consequence: withholding must be applied until a waiver is issued. Notice what kind of problem this actually is — nothing about the employee\'s tax position has changed, only the notice period. Short-notice business travel is where this goes wrong, which makes it a process and scheduling issue rather than a tax one.',
        options: [
          {
            label: 'Withhold Canadian tax until the waiver is actually issued',
            correct: true,
            quote:
              'Applications submitted with less than 30 days notice will continue to be processed, but the Agency states that withholding must be applied until a waiver is issued.',
          },
          {
            label: 'Nothing — the application has been submitted, so the waiver applies',
            whyWeaker:
              'Submitting is not the same as being granted. Withholding applies until issuance.',
          },
          {
            label: 'Delay the start date until the waiver arrives',
            whyWeaker:
              'A commercial option perhaps, but not what the source requires. The stated consequence is withholding, not postponement.',
          },
          {
            label: 'Withhold, but only once the employee exceeds 30 Canadian workdays',
            whyWeaker:
              'The 30 in this development is 30 days of notice before the start date, not 30 workdays in Canada. Two different things.',
          },
        ],
      },
      {
        kind: 'multiple_choice',
        prompt: 'What is the most useful thing to review in response to this change?',
        explanation:
          'The binding constraint is lead time, not tax analysis. The 30-day notice requirement means the outcome is decided by how early the business tells mobility about a Canadian trip — which is an internal process question. Reviewing the tax treaty or the employee population tells you nothing about whether you will hit the deadline.',
        options: [
          {
            label: 'How much notice the business typically gives before Canadian work starts',
            correct: true,
            quote:
              'Under the streamlined process, applications submitted at least 30 days before the employee begins work in Canada will receive a decision before the work start date.',
          },
          {
            label: 'Whether the employees are tax resident in Canada',
            whyWeaker:
              'Relevant to their eventual liability, but it has no bearing on whether a waiver application meets the 30-day deadline.',
          },
          {
            label: 'The corporate tax position of the Canadian entity',
            whyWeaker: 'This development is about employee withholding, not corporate tax.',
          },
        ],
      },
    ],
    applyIt: `A fictional client, Arcadia Freight, has a US-based specialist who travels to Canada at short notice to fix equipment failures — usually with under a week's warning. Over a year this adds up to around 40 Canadian workdays.

Arcadia asks how to stop Canadian tax being withheld from his pay.

What would you explain, and what options would you set out?`,
    professionalSummary: `CRA streamlined Regulation 102 waiver process, in effect for applications received on or after 1 June 2026.

Applications filed 30 or more days before the Canadian work start date receive a decision before commencement. Later applications are still processed, but withholding applies until issuance. The certified non-resident employer regime is unchanged and may be the more appropriate route for unpredictable short-notice travel.

Suggested review areas: typical lead time between assignment or trip approval and Canadian work start; upcoming Canadian travel already inside the 30-day window; whether certified non-resident employer status is available and preferable; payroll instruction to withhold where no waiver has been issued.

Uncertainty: none material on the process itself. Whether the certified non-resident employer route is the better answer for any given client depends on facts not in this source.`,
  },

  /* ---------------------------- California — the "unknowable" lesson */
  {
    developmentSlug: 'us-ca-nonresident-withholding-discussion',
    whatHappened: `California currently expects an employer to withhold tax from a nonresident employee's pay from their very first workday in the state. Even a one-day visit creates an obligation, and the administrative effort is often far larger than the tax involved.

California's tax agency has published a discussion paper asking whether there should be a minimum below which withholding is not required. It sketches a few possible designs — a fixed number of workdays, or a test based on how much the person is paid.

It is important to be clear about what this document is not. It says outright that it does not represent the agency's own position, and it proposes nothing. It is a conversation starter.

This item is in the feed because a minimum threshold would matter a great deal for US state-to-state travel if it ever arrived — not because anything has changed.`,
    questions: [
      {
        kind: 'multiple_choice',
        prompt: 'What does this discussion paper change for an employer today?',
        explanation:
          'Nothing at all. The paper disclaims the agency\'s own position and makes no proposal, so there is nothing to comply with and nothing to plan around. The reason this is worth a question is that documents on official websites carry an air of authority that their contents sometimes do not support — and learning to read for what a document actually claims about itself is a large part of this job.',
        options: [
          {
            label: 'Nothing — it states no position and proposes no change',
            correct: true,
            quote:
              'The paper states that it does not represent the position of the Board and that no legislative or regulatory proposal has been made.',
          },
          {
            label: 'Withholding is no longer required for very short visits',
            whyWeaker:
              'No threshold has been created. Withholding still applies from the first California workday.',
          },
          {
            label: 'Employers should begin tracking California workdays more carefully',
            whyWeaker:
              'Arguably good practice, but it is already required by the existing day-one rule. This paper changes nothing about it.',
          },
          {
            label: 'A de minimis threshold now applies based on compensation',
            whyWeaker:
              'Compensation-based design was one option discussed, not adopted. Discussing an option is not enacting it.',
          },
        ],
      },
      {
        kind: 'multiple_choice',
        prompt: 'Will California adopt a de minimis withholding threshold?',
        explanation:
          'This cannot be answered, and recognising that is the skill being tested. A discussion paper that explicitly disclaims its own authority supports no prediction about outcomes — not a confident yes, not a confident no, and not a hedged "probably". If a client asked this, the honest answer is that there is nothing to forecast from yet, and the useful follow-up is to ask what you would want to see before forming a view: an actual proposal, a text, a comment-period outcome.',
        options: [
          {
            label: 'Not enough information — nothing has been proposed, so there is nothing to forecast',
            correct: true,
            insufficientInfo: true,
          },
          {
            label: 'Yes — the paper identifies the burden, so a change is likely',
            whyWeaker:
              'Identifying a problem is not a commitment to solving it. Tax authorities publish discussion papers that lead nowhere routinely.',
          },
          {
            label: 'No — the paper declines to recommend a threshold, so it will not happen',
            whyWeaker:
              'Declining to recommend at this stage says nothing about the eventual outcome either. This is the same error as the optimistic answer, pointed the other way.',
          },
          {
            label: 'Yes, from the next tax year',
            whyWeaker: 'Invents both an outcome and a date, neither of which appears in the source.',
          },
        ],
      },
    ],
    applyIt: `A fictional client, Vantage Partners, sends consultants from its Seattle office to client sites in California — typically two or three days at a time, perhaps fifteen days a year each. Payroll currently withholds California tax from the first day, which generates a lot of small filings.

Vantage's controller has seen the California discussion paper and asks whether they can stop withholding for these short trips.

What would you tell them?`,
    professionalSummary: `FTB discussion paper on nonresident wage withholding for short-duration California work.

Observes that withholding applies from the first California workday and that the resulting administrative burden can be disproportionate to the tax at stake. Canvasses possible de minimis threshold designs, including day-count and compensation-based tests, without recommendation. Expressly not the Board's position; no legislative or regulatory proposal made. Lifecycle status not stated in the source and deliberately not inferred.

Suggested review areas: none required. Monitoring item only. If tracking, it is worth knowing current California short-visit exposure so that any future threshold can be assessed quickly.

Uncertainty — material. No conclusion about future California withholding rules is supportable from this document. It should not appear in a client cost projection or in advice.`,
  },
]

/* ==========================================================================
 * Insert
 * ========================================================================== */

/**
 * Finds the evidence span for a quote on this development, creating it if the
 * lesson cites a passage the content seed did not already need.
 *
 * Same verbatim guarantee as `db/seed-content.ts`: the quote must appear
 * exactly in the stored document text, or this throws. A lesson cannot cite
 * something the source does not say.
 */
async function findOrCreateEvidence(developmentId: string, quote: string): Promise<string> {
  const [doc] = await db
    .select({ id: rawDocuments.id, text: rawDocuments.rawText })
    .from(developmentSources)
    .innerJoin(rawDocuments, eq(developmentSources.rawDocumentId, rawDocuments.id))
    .where(eq(developmentSources.developmentId, developmentId))

  if (!doc?.text) throw new Error('Development has no source document text')

  const [existing] = await db
    .select({ id: evidenceSpans.id })
    .from(evidenceSpans)
    .where(and(eq(evidenceSpans.rawDocumentId, doc.id), eq(evidenceSpans.quote, quote)))

  if (existing) return existing.id

  const charStart = doc.text.indexOf(quote)
  if (charStart === -1) {
    throw new Error(
      `Lesson quote not found verbatim in the source document.\n  Quote: "${quote}"`,
    )
  }

  const [created] = await db
    .insert(evidenceSpans)
    .values({
      rawDocumentId: doc.id,
      quote,
      charStart,
      charEnd: charStart + quote.length,
      note: 'Cited by a lesson question',
    })
    .returning({ id: evidenceSpans.id })

  return created.id
}

async function seedLesson(seed: SeedLesson) {
  const [development] = await db
    .select({ id: developments.id })
    .from(developments)
    .where(eq(developments.slug, seed.developmentSlug))

  if (!development) {
    throw new Error(`Unknown development '${seed.developmentSlug}'. Run db:seed:content first.`)
  }

  /* --- validate EVERY question before writing anything -----------------
   * All-or-nothing on purpose. A lesson with one unsupported answer is not
   * "mostly fine" — it is a lesson that will teach a beginner a false
   * certainty, so it does not get created at all. */
  const allViolations = seed.questions.flatMap((q) =>
    checkQuestionValidity({
      prompt: q.prompt,
      explanation: q.explanation,
      options: q.options.map((o) => ({
        label: o.label,
        isCorrect: Boolean(o.correct),
        // A placeholder id is enough for the check: it asks whether a citation
        // EXISTS, and the verbatim check that the quote is real happens in
        // findOrCreateEvidence below.
        evidenceId: o.quote ? 'pending' : null,
        isInsufficientInfo: Boolean(o.insufficientInfo),
      })),
    }),
  )

  if (hasBlockingError(allViolations)) {
    throw new Error(
      `Lesson for '${seed.developmentSlug}' has invalid questions:\n${formatViolations(allViolations)}`,
    )
  }

  const [lesson] = await db
    .insert(lessons)
    .values({
      developmentId: development.id,
      model: null,
      promptVersion: 'seed-v1',
      validated: true,
      validationNotes: `${seed.questions.length} questions, all correct answers either cite evidence or are flagged as insufficient information.`,
    })
    .returning({ id: lessons.id })

  /* --- stages 1, 4, 5 (2 and 3 are driven by the questions) ----------- */
  await db.insert(lessonStages).values([
    { lessonId: lesson.id, stage: 1, body: seed.whatHappened },
    { lessonId: lesson.id, stage: 4, body: seed.applyIt, isSyntheticScenario: true },
    { lessonId: lesson.id, stage: 5, body: seed.professionalSummary },
  ])

  let insufficientInfoAnswers = 0
  let citedAnswers = 0

  for (const [index, question] of seed.questions.entries()) {
    const [row] = await db
      .insert(lessonQuestions)
      .values({
        lessonId: lesson.id,
        stage: 2,
        ordinal: index + 1,
        kind: question.kind,
        prompt: question.prompt,
        explanation: question.explanation,
      })
      .returning({ id: lessonQuestions.id })

    for (const [optionIndex, option] of question.options.entries()) {
      const evidenceId = option.quote
        ? await findOrCreateEvidence(development.id, option.quote)
        : null

      if (option.correct) {
        if (option.insufficientInfo) insufficientInfoAnswers += 1
        else citedAnswers += 1
      }

      await db.insert(lessonOptions).values({
        questionId: row.id,
        ordinal: optionIndex + 1,
        label: option.label,
        isCorrect: Boolean(option.correct),
        evidenceId,
        isInsufficientInfo: Boolean(option.insufficientInfo),
        whyWeaker: option.whyWeaker ?? null,
      })
    }
  }

  return {
    slug: seed.developmentSlug,
    questions: seed.questions.length,
    citedAnswers,
    insufficientInfoAnswers,
  }
}

async function main() {
  console.log('Seeding lessons...\n')
  console.log('  Reminder: stop `npm run dev` first (PGlite is single-process).\n')

  // Cascades to stages, questions, and options.
  await db.delete(lessons)

  let totalQuestions = 0
  let totalCited = 0
  let totalInsufficient = 0

  for (const seed of LESSONS) {
    const result = await seedLesson(seed)
    totalQuestions += result.questions
    totalCited += result.citedAnswers
    totalInsufficient += result.insufficientInfoAnswers
    console.log(
      `  ${result.slug.padEnd(44)} ${result.questions} questions` +
        (result.insufficientInfoAnswers > 0
          ? `  (${result.insufficientInfoAnswers} answered "not enough information")`
          : ''),
    )
  }

  console.log(`\n  ${LESSONS.length} lessons, ${totalQuestions} questions, all validated`)
  console.log(`  ${totalCited} correct answers backed by a verbatim quote`)
  console.log(`  ${totalInsufficient} correct answers are "not enough information to decide"`)
  console.log('\nDone.')
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nSeed failed:', err instanceof Error ? err.message : err)
    process.exit(1)
  })
