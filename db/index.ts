/**
 * Database connection
 * ===================
 *
 * ONE SWITCH, DECIDED BY WHETHER DATABASE_URL IS SET.
 *
 *   DATABASE_URL set    -> Neon (production, and any local run that wants to
 *                          talk to the deployed database)
 *   DATABASE_URL absent -> PGlite, a folder on disk
 *
 * PGlite is real Postgres compiled to WebAssembly, so it speaks the same SQL
 * dialect as Neon. That is the whole reason it was chosen: there is no
 * "works locally, breaks deployed" class of bug, the same migrations run
 * against both, and nobody needs an account to work on the app.
 *
 * The switch is an environment variable rather than NODE_ENV because the two
 * questions are different. "Am I in production?" and "which database am I
 * pointed at?" come apart constantly — running migrations against Neon from a
 * laptop is the normal case, not an exception.
 *
 * PGLITE IS SINGLE-PROCESS. Only one process may hold its data directory at a
 * time, so `npm run dev` must be stopped before running a `db:*` or `collect`
 * script locally. Hard-killing the dev server can corrupt the directory
 * (`RuntimeError: Aborted()` on the next query); the data is reproducible, so
 * `npm run db:fix` is the recovery. None of this applies to Neon, which is a
 * real networked server many processes can share.
 */

import { drizzle as drizzlePglite } from 'drizzle-orm/pglite'
import { drizzle as drizzleNeon } from 'drizzle-orm/neon-http'
import * as schema from './schema'

/** Where PGlite keeps its data. Gitignored; safe to delete to reset. */
const LOCAL_DATA_DIR = process.env.PGLITE_DATA_DIR ?? './.pglite'

export const usingNeon = Boolean(process.env.DATABASE_URL)

/**
 * Next.js hot-reloads modules in development, which would otherwise open a new
 * database handle on every file save until the process runs out of them. Cache
 * the client on `globalThis` so reloads reuse one connection.
 */
const globalForDb = globalThis as unknown as {
  __gmsDb?: ReturnType<typeof createDb>
}

function createDb() {
  if (process.env.DATABASE_URL) {
    // neon-http sends each query as an HTTP request, which suits serverless
    // hosting: no connection pool to exhaust and no socket to keep warm
    // between invocations. The pooled connection string works fine with it.
    //
    // Imported lazily so a machine with no DATABASE_URL never loads the driver.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { neon } = require('@neondatabase/serverless') as typeof import('@neondatabase/serverless')
    return drizzleNeon(neon(process.env.DATABASE_URL), { schema })
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PGlite } = require('@electric-sql/pglite') as typeof import('@electric-sql/pglite')
  return drizzlePglite(new PGlite(LOCAL_DATA_DIR), { schema })
}

/*
 * The two drivers return structurally different Drizzle instances (one is
 * HTTP-backed, one is in-process), so their types do not unify. Every query in
 * this app uses the common surface — select, insert, update, delete — so the
 * cast is safe in practice, and narrowing to one driver's type is what keeps
 * the rest of the codebase from having to know which is in use.
 */
export const db = (globalForDb.__gmsDb ??= createDb()) as ReturnType<typeof drizzlePglite<typeof schema>>

export type Db = typeof db
export { schema }
