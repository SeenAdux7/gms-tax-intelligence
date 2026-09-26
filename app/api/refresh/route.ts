import { NextResponse, type NextRequest } from 'next/server'
import { runCollection } from '../../../pipeline/run'

/**
 * Collection trigger
 * ==================
 *
 * Two callers:
 *
 *   - The hourly GitHub Actions workflow (`.github/workflows/collect.yml`),
 *     which authenticates with a shared secret.
 *   - A developer, manually. The brief asks for "a scheduled collection
 *     process plus a manual refresh option for development and testing".
 *
 * AUTHENTICATION
 *
 * This endpoint spends money — each call can run Opus over several articles —
 * so it is not open. In production a `COLLECT_SECRET` must be set and matched
 * via a bearer token. If the secret is not configured, the endpoint refuses in
 * production rather than defaulting to open: an unauthenticated endpoint that
 * bills the owner is the kind of thing that must fail closed.
 *
 * In development it is open, because there is no key to spend against unless
 * one is deliberately set.
 */

// Collection can take minutes over several sources.
export const maxDuration = 300

function authorise(request: NextRequest): { ok: true } | { ok: false; reason: string; status: number } {
  if (process.env.NODE_ENV === 'development') return { ok: true }

  const secret = process.env.COLLECT_SECRET
  if (!secret) {
    return {
      ok: false,
      status: 503,
      reason:
        'COLLECT_SECRET is not configured. This endpoint spends money and will not run ' +
        'unauthenticated in production.',
    }
  }

  const header = request.headers.get('authorization')
  if (header !== `Bearer ${secret}`) {
    return { ok: false, status: 401, reason: 'Unauthorised.' }
  }

  return { ok: true }
}

export async function POST(request: NextRequest) {
  const auth = authorise(request)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status })
  }

  const params = request.nextUrl.searchParams
  const dryRun = params.get('dry') === '1'
  const limit = Number(params.get('limit') ?? 5)
  const total = Number(params.get('total') ?? 25)

  const started = Date.now()

  try {
    const summary = await runCollection({
      dryRun,
      limit: Number.isFinite(limit) ? limit : 5,
      total: Number.isFinite(total) ? total : 25,
      trigger: 'scheduled',
    })

    return NextResponse.json({
      ok: true,
      dryRun,
      elapsedMs: Date.now() - started,
      ...summary,
      // Rounded for readability; the exact figure is on each processing_runs row.
      costUsd: Number(summary.costUsd.toFixed(4)),
    })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        elapsedMs: Date.now() - started,
      },
      { status: 500 },
    )
  }
}

/** Convenience for a browser check during development. */
export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Use POST.' }, { status: 405 })
  }
  return POST(request)
}
