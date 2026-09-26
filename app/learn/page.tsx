import type { Metadata } from 'next'
import { ComingSoon } from '../components/ui'

export const metadata: Metadata = { title: 'Learn' }

export default function LearnPage() {
  return (
    <ComingSoon section="Learn" phase="phase 2">
      The five-stage swipe-through lesson — what happened, think about the impact, understand the
      answer, apply it to a fictional client, then a professional summary. The lesson content is
      generated from an update and its evidence, so this is built on top of the Updates feed.
    </ComingSoon>
  )
}
