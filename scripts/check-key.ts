/**
 * Is the API key working?
 * =======================
 *
 * Makes one deliberately tiny Haiku call — a few tokens in, a word out — to
 * confirm the key is valid, the account has credits, and the network path
 * works. Costs a fraction of a cent, well under $0.001.
 *
 * This exists so the first thing that can go wrong (a mistyped key, no credits,
 * a blocked network) costs nothing to discover. Finding out during `npm run
 * eval` would mean a confusing failure partway through six documents.
 *
 * It also reports what the real runs will cost, so there are no surprises.
 *
 * Run with:  npm run check:key
 */

// Must come first: loads .env.local before anything reads process.env.
import '../pipeline/env'
import Anthropic from '@anthropic-ai/sdk'
import { costOf } from '../pipeline/ai'

async function main() {
  const key = process.env.ANTHROPIC_API_KEY

  /* --- checks that need no network ---------------------------------- */

  if (!key) {
    console.error('NOT SET — ANTHROPIC_API_KEY is empty or missing.\n')
    console.error('  Open this file:')
    console.error('    C:\\Users\\senay\\dev\\gms-app\\.env.local')
    console.error('  and paste your key after "ANTHROPIC_API_KEY=" (no quotes, no spaces).')
    process.exit(1)
  }

  if (!key.startsWith('sk-ant-')) {
    console.error('WRONG SHAPE — the key does not start with "sk-ant-".\n')
    console.error(`  It starts with: ${key.slice(0, 8)}...`)
    console.error('  Check you copied the whole key from platform.claude.com -> API keys.')
    process.exit(1)
  }

  if (key.includes(' ') || key.includes('"') || key.includes("'")) {
    console.error('STRAY CHARACTERS — the key contains a space or a quote mark.\n')
    console.error('  In .env.local the line should look exactly like:')
    console.error('    ANTHROPIC_API_KEY=sk-ant-...')
    console.error('  with no quotes around it and no space after the = sign.')
    process.exit(1)
  }

  console.log(`Key found: ${key.slice(0, 11)}...${key.slice(-4)}`)
  console.log('Making one tiny test call...\n')

  /* --- the actual call ----------------------------------------------- */

  try {
    const client = new Anthropic()
    const response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 5,
      messages: [{ role: 'user', content: 'Reply with the single word: working' }],
    })

    const text = response.content.find((block) => block.type === 'text')
    const input = response.usage.input_tokens
    const output = response.usage.output_tokens
    const cost = costOf('claude-haiku-4-5', input, output)

    console.log(`  Model replied: "${text?.type === 'text' ? text.text.trim() : '(no text)'}"`)
    console.log(`  Tokens: ${input} in, ${output} out`)
    console.log(`  This call cost: $${cost.toFixed(6)}`)
    console.log('\nYOUR KEY WORKS.\n')

    console.log('What the real commands will cost:')
    console.log('  npm run collect:dry    $0        (no AI at all)')
    console.log('  npm run collect:one    ~$0.10    (one article, both AI stages)')
    console.log('  npm run eval           ~$0.60    (six documents — the one that matters)')
    console.log('  npm run collect        ~$1-2     (up to 25 articles)')
  } catch (error) {
    console.error('THE CALL FAILED.\n')

    const message = error instanceof Error ? error.message : String(error)

    // Translate the common failures into something actionable, rather than
    // leaving a raw API error for someone who has never seen one.
    if (message.includes('401') || message.toLowerCase().includes('authentication')) {
      console.error('  Reason: the key was rejected.')
      console.error('  - Check for a typo, or a missing character at either end.')
      console.error('  - If you regenerated the key, paste the new one.')
    } else if (message.includes('credit') || message.includes('billing') || message.includes('402')) {
      console.error('  Reason: no credits on the account.')
      console.error('  - Go to platform.claude.com -> Settings -> Billing -> Buy credits.')
    } else if (message.includes('429')) {
      console.error('  Reason: rate limited. Wait a minute and try again.')
    } else if (message.includes('ENOTFOUND') || message.includes('fetch failed')) {
      console.error('  Reason: could not reach the API. Check your internet connection.')
    } else {
      console.error(`  ${message}`)
    }

    process.exit(1)
  }
}

main()
