import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getLesson } from '../../lib/lesson-queries'
import { LessonFlow } from './LessonFlow'

export async function generateMetadata(props: PageProps<'/learn/[slug]'>): Promise<Metadata> {
  const { slug } = await props.params
  const lesson = await getLesson(slug)
  return { title: lesson ? `Lesson: ${lesson.headline}` : 'Lesson not found' }
}

/**
 * Loads the lesson on the server, hands it to the interactive flow.
 *
 * `getLesson` returns null for an unvalidated lesson as well as a missing one,
 * so a lesson whose questions failed the evidence check 404s rather than being
 * served with a caveat.
 */
export default async function LessonPage(props: PageProps<'/learn/[slug]'>) {
  const { slug } = await props.params
  const lesson = await getLesson(slug)
  if (!lesson) notFound()

  return <LessonFlow lesson={lesson} />
}
