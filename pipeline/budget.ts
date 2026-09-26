/**
 * Spend ceiling, enforced in code
 * ===============================
 *
 * WHY THIS EXISTS
 *
 * The usual place to cap API spending is the provider's console. That is not
 * always available: on a shared or institutional plan you may hold a key
 * without the billing role needed to set a limit, and you may not even be able
 * to see the balance. Spending someone else's credits with no visible ceiling
 * is not a situation to leave to good intentions.
 *
 * So the ceiling lives here. Before every paid call the pipeline adds up what
 * it has already spent — from `processing_runs.cost_usd` and
 * `eval_runs.cost_usd`, which are written from real token counts, not
 * estimates — and refuses to continue past the limit.
 *
 * WHAT THIS IS AND IS NOT
 *
 * It is a brake on THIS APPLICATION. It counts only spending this code did.
 * It cannot see anything else on the account, so it is not a substitute for a
 * provider-side limit where one is available — it is what you have when one is
 * not.
 *
 * It fails CLOSED. If the total cannot be read, the run stops rather than
 * proceeding blind: a budget check that silently passes when it cannot measure
 * anything is worse than no budget check, because it is believed.
 *
 * Default: $20 lifetime. Override with MAX_TOTAL_SPEND_USD in .env.local.
 * Deliberately low — enough for the full test sequence and a month of hourly
 * collection, low enough that a runaway loop is an annoyance rather than an
 * incident. Raise it deliberately, once you know what normal looks like.
 */

import { sql } from 'drizzle-orm'
import { db } from '../db/index'
import { evalRuns, processingRuns } from '../db/schema'

const DEFAULT_LIMIT_USD = 20

export function spendLimit(): number {
  const raw = process.env.MAX_TOTAL_SPEND_USD
  if (!raw) return DEFAULT_LIMIT_USD
  const parsed = Number(raw)
  // A malformed limit falls back to the default rather than to Infinity.
  // `Number('') === 0` and `Number('abc') === NaN`, and either silently
  // becoming "no limit" is exactly the failure this module exists to prevent.
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT_USD
  return parsed
}

/** Everything this application has ever spent, from recorded token counts. */
export async function totalSpentUsd(): Promise<number> {
  const [collection] = await db
    .select({ total: sql<number>`coalesce(sum(${processingRuns.costUsd}), 0)::float` })
    .from(processingRuns)

  const [evaluation] = await db
    .select({ total: sql<number>`coalesce(sum(${evalRuns.costUsd}), 0)::float` })
    .from(evalRuns)

  return (collection?.total ?? 0) + (evaluation?.total ?? 0)
}

export type BudgetStatus = {
  spent: number
  limit: number
  remaining: number
  exceeded: boolean
}

export async function checkBudget(): Promise<BudgetStatus> {
  const limit = spendLimit()

  let spent: number
  try {
    spent = await totalSpentUsd()
  } catch (error) {
    // Fail closed.
    throw new Error(
      `Could not read recorded spend, so the budget cannot be enforced. Stopping rather than ` +
        `spending blind. (${error instanceof Error ? error.message : String(error)})`,
    )
  }

  return {
    spent,
    limit,
    remaining: Math.max(limit - spent, 0),
    exceeded: spent >= limit,
  }
}

/**
 * Throws if the ceiling has been reached.
 *
 * Called before each paid stage rather than once per run, so a single long run
 * cannot sail past the limit between checks.
 */
export async function assertWithinBudget(context: string): Promise<BudgetStatus> {
  const status = await checkBudget()

  if (status.exceeded) {
    throw new Error(
      `Spend ceiling reached: $${status.spent.toFixed(4)} of $${status.limit.toFixed(2)} used ` +
        `(stopped before ${context}).\n\n` +
        `  This is an application-level brake, not your account balance.\n` +
        `  To continue, raise it in .env.local:  MAX_TOTAL_SPEND_USD=50\n` +
        `  To see where it went:                 npm run spend`,
    )
  }

  return status
}

/** Human-readable summary, for the CLI and the spend report. */
export function describeBudget(status: BudgetStatus): string {
  const pct = status.limit > 0 ? Math.round((status.spent / status.limit) * 100) : 0
  return `$${status.spent.toFixed(4)} of $${status.limit.toFixed(2)} used (${pct}%), $${status.remaining.toFixed(4)} left`
}
