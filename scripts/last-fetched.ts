/** What did the pipeline most recently fetch? Costs nothing. */
import '../pipeline/env'
import { desc } from 'drizzle-orm'
import { db } from '../db/index'
import { rawDocuments } from '../db/schema'

async function main() {
  const docs = await db
    .select({
      title: rawDocuments.title,
      url: rawDocuments.url,
      text: rawDocuments.rawText,
      seen: rawDocuments.retrievedAt,
    })
    .from(rawDocuments)
    .orderBy(desc(rawDocuments.retrievedAt))
    .limit(3)

  for (const d of docs) {
    console.log(`- ${d.title ?? '(no title)'}`)
    console.log(`  ${d.url}`)
    console.log(`  ${(d.text ?? '').length} chars`)
    console.log(`  ${(d.text ?? '').slice(0, 220).replace(/\s+/g, ' ')}`)
    console.log('')
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
