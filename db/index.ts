/**
 * Database connection
 * ===================
 *
 * Local development runs PGlite — real Postgres compiled to WebAssembly, stored
 * in a folder. That choice matters for a specific reason: it is the SAME SQL
 * dialect we'll run in production on Neon, so there is no "works locally,
 * breaks deployed" class of bug, and no account signup or database install
 * needed to work on the app. Phases 0-5 are meant to cost nothing and require
 * nothing.
 *
 * Production (phase 6 onward) swaps the driver for Neon serverless Postgres.
 * The schema, queries, and migrations are identical either way — see the
 * comment at the bottom for the swap.
 */

import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import * as schema from './schema'

/** Where PGlite keeps its data on disk. Gitignored; safe to delete to reset. */
const LOCAL_DATA_DIR = process.env.PGLITE_DATA_DIR ?? './.pglite'

/**
 * Next.js hot-reloads modules in development, which would otherwise open a new
 * database handle on every file save until the process runs out of them. Cache
 * the client on `globalThis` so reloads reuse one connection.
 */
const globalForDb = globalThis as unknown as {
  __gmsPglite?: PGlite
}

function getClient(): PGlite {
  if (!globalForDb.__gmsPglite) {
    globalForDb.__gmsPglite = new PGlite(LOCAL_DATA_DIR)
  }
  return globalForDb.__gmsPglite
}

export const db = drizzle(getClient(), { schema })

export type Db = typeof db
export { schema }

/**
 * Production swap (phase 6):
 *
 *   import { neon } from '@neondatabase/serverless'
 *   import { drizzle } from 'drizzle-orm/neon-http'
 *   export const db = drizzle(neon(process.env.DATABASE_URL!), { schema })
 *
 * Kept as a comment rather than a live branch so that local development has no
 * dependency on an environment variable being set correctly.
 */
