/**
 * Which database am I about to touch?
 *
 * "Did I just migrate production or my laptop?" is not a question to answer by
 * guessing, and the two commands look identical. Prints the target, with the
 * credentials redacted.
 */
import '../pipeline/env'

const url = process.env.DATABASE_URL

if (!url) {
  console.log('TARGET: local PGlite  (./.pglite)')
  console.log('        DATABASE_URL is not set.')
  console.log('        Stop `npm run dev` before any db: command — PGlite is single-process.')
} else {
  try {
    const parsed = new URL(url)
    console.log('TARGET: Neon (REMOTE)')
    console.log(`        host     ${parsed.hostname}`)
    console.log(`        database ${parsed.pathname.replace(/^\//, '')}`)
    console.log(`        user     ${parsed.username}`)
    console.log('        password [redacted]')
    console.log('')
    console.log('        This is the deployed database. Changes affect the live app.')
  } catch {
    console.log('TARGET: DATABASE_URL is set but is not a valid URL.')
    process.exit(1)
  }
}
