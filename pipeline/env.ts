/**
 * Loads .env.local for command-line scripts
 * =========================================
 *
 * Next.js loads `.env.local` automatically. Standalone scripts run through
 * `tsx` do NOT — so without this, a key sitting correctly in `.env.local` is
 * invisible to `npm run collect`, `npm run eval`, and `npm run check:key`, and
 * the failure looks exactly like "the key is wrong".
 *
 * Imported for its side effect, before anything reads `process.env`:
 *
 *     import './env'
 *
 * Done in code rather than with a `--env-file` flag on each npm script because
 * the flag differs by Node version (`--env-file` errors when the file is
 * missing; `--env-file-if-exists` is newer) and because a script that silently
 * depends on how it was invoked is a trap.
 *
 * A real environment variable always wins: `process.loadEnvFile` does not
 * overwrite what is already set, so CI and production hosts are unaffected.
 */

import { existsSync } from 'node:fs'

const CANDIDATES = ['.env.local', '.env']

for (const file of CANDIDATES) {
  if (!existsSync(file)) continue
  try {
    process.loadEnvFile(file)
    break
  } catch {
    // Node older than 20.12 has no loadEnvFile. Not fatal — the variable may
    // already be set in the shell, and the caller reports a missing key
    // clearly. Staying silent here avoids a confusing warning on a machine
    // where the environment is provided some other way.
    break
  }
}
