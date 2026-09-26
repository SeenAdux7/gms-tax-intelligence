'use client'

/**
 * Save / difficulty toggles
 * =========================
 *
 * Both use `useOptimistic` so the tap registers instantly and then reconciles
 * with whatever the server actually did. If the write fails the state snaps
 * back rather than leaving a button that claims something untrue — a bookmark
 * that looks saved but isn't is worse than one that visibly failed.
 */

import { useOptimistic, useTransition } from 'react'
import { toggleDifficult, toggleSaved, type SavableType } from '../actions'

export function SaveButton({
  entityType,
  entityId,
  initialSaved,
  revalidate,
  label = 'Save',
  savedLabel = 'Saved',
}: {
  entityType: SavableType
  entityId: string
  initialSaved: boolean
  revalidate?: string
  label?: string
  savedLabel?: string
}) {
  const [pending, startTransition] = useTransition()
  const [saved, setSaved] = useOptimistic(initialSaved)

  return (
    <button
      type="button"
      aria-pressed={saved}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          setSaved(!saved)
          await toggleSaved(entityType, entityId, revalidate)
        })
      }
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium ring-1 transition-colors disabled:opacity-60 ${
        saved
          ? 'bg-accent/10 text-accent ring-accent/40'
          : 'bg-surface text-foreground/75 ring-line hover:ring-accent/40'
      }`}
    >
      <BookmarkGlyph filled={saved} />
      {saved ? savedLabel : label}
    </button>
  )
}

/**
 * "I find this hard."
 *
 * Distinct from saving, and the label says what it does rather than being a
 * bare icon: flagging a term brings it back in the review queue tomorrow, so
 * the user should know they are changing what they get asked, not just
 * decorating a card.
 */
export function DifficultButton({
  termId,
  initialDifficult,
  revalidate,
}: {
  termId: string
  initialDifficult: boolean
  revalidate?: string
}) {
  const [pending, startTransition] = useTransition()
  const [difficult, setDifficult] = useOptimistic(initialDifficult)

  return (
    <button
      type="button"
      aria-pressed={difficult}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          setDifficult(!difficult)
          await toggleDifficult(termId, revalidate)
        })
      }
      title={
        difficult
          ? 'Flagged as difficult — this term comes back sooner in Review'
          : 'Flag as difficult to see this term more often'
      }
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium ring-1 transition-colors disabled:opacity-60 ${
        difficult
          ? 'bg-amber-500/12 text-amber-800 ring-amber-500/40 dark:text-amber-200'
          : 'bg-surface text-foreground/75 ring-line hover:ring-amber-500/40'
      }`}
    >
      {difficult ? 'Marked difficult' : 'Find this hard?'}
    </button>
  )
}

function BookmarkGlyph({ filled }: { filled: boolean }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={filled ? 1 : 2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6 3.5h12a.5.5 0 0 1 .5.5v16.2a.4.4 0 0 1-.63.33L12 16.5l-5.87 4.03a.4.4 0 0 1-.63-.33V4a.5.5 0 0 1 .5-.5z" />
    </svg>
  )
}
