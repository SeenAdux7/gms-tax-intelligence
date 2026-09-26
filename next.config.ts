import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  /**
   * PGlite must not be bundled.
   *
   * It ships a WebAssembly build of Postgres plus its own virtual filesystem,
   * and it resolves those assets at runtime relative to its own package
   * location. Bundling rewrites those paths and it fails with
   * `ERR_INVALID_ARG_TYPE: The "path" argument ... Received an instance of URL`.
   *
   * Listing it here keeps it as a plain runtime `require` from node_modules,
   * which is how a native-ish dependency expects to be loaded. `@neondatabase/
   * serverless` (production, phase 6) is pure JS and needs no such treatment.
   */
  serverExternalPackages: ['@electric-sql/pglite'],
}

export default nextConfig
