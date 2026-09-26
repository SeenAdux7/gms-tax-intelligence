import type { Config } from 'drizzle-kit'

/**
 * Drizzle Kit config — generates SQL migrations from db/schema.ts.
 *
 * `dialect: 'postgresql'` with the PGlite driver keeps local migrations
 * byte-identical to what will run on Neon in production.
 */
export default {
  schema: './db/schema.ts',
  out: './db/migrations',
  dialect: 'postgresql',
  driver: 'pglite',
  dbCredentials: {
    url: process.env.PGLITE_DATA_DIR ?? './.pglite',
  },
  verbose: true,
  strict: true,
} satisfies Config
