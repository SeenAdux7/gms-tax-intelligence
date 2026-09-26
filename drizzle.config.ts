import { config } from 'dotenv'
import type { Config } from 'drizzle-kit'

// drizzle-kit is a standalone CLI and does not load .env.local the way Next.js
// does, so the connection string has to be read explicitly. Without this,
// `db:migrate` silently targets the local PGlite folder even when
// DATABASE_URL is set — and you discover the production schema was never
// created.
config({ path: '.env.local', quiet: true })

const databaseUrl = process.env.DATABASE_URL

/**
 * Drizzle Kit config — generates and applies SQL migrations.
 *
 * Targets Neon when DATABASE_URL is set, PGlite otherwise, matching the same
 * switch as db/index.ts. The generated SQL is identical either way: PGlite is
 * real Postgres, so one set of migrations serves both.
 *
 * Which one a command is about to touch is printed by `npm run db:target`,
 * because "did I just migrate production or my laptop?" is not a question to
 * answer by guessing.
 */
export default (
  databaseUrl
    ? {
        schema: './db/schema.ts',
        out: './db/migrations',
        dialect: 'postgresql',
        dbCredentials: { url: databaseUrl },
        verbose: true,
        strict: true,
      }
    : {
        schema: './db/schema.ts',
        out: './db/migrations',
        dialect: 'postgresql',
        driver: 'pglite',
        dbCredentials: { url: process.env.PGLITE_DATA_DIR ?? './.pglite' },
        verbose: true,
        strict: true,
      }
) satisfies Config
