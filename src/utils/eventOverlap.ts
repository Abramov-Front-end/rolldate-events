/**
 * Global allowOverlap. Default true.
 * Intervals are `[start, end)` — touching ends is not a conflict.
 */

import { normalizeResourceId } from './eventResource'

export function intervalsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime()
}

export function isSameMovedEvent(
  moving: { id: string | number; occurrenceId?: string },
  other: { id: string | number; occurrenceId?: string }
): boolean {
  return String(moving.occurrenceId || moving.id) === String(other.occurrenceId || other.id)
}

export interface OverlapCandidate {
  id: string | number
  occurrenceId?: string
  resourceId?: string
  start: Date
  end: Date
}

export function isOverlapAllowed(args: {
  allowOverlap?: boolean
  view?: string
  moving: { id: string | number; occurrenceId?: string; resourceId?: string }
  start: Date
  end: Date
  resourceId?: string
  others: readonly OverlapCandidate[]
}): boolean {
  if (args.allowOverlap !== false) return true
  const nextRes = args.resourceId !== undefined ? args.resourceId : args.moving.resourceId
  const sameResourceOnly = args.view === 'timeline'
  for (const other of args.others) {
    if (isSameMovedEvent(args.moving, other)) continue
    if (sameResourceOnly && normalizeResourceId(nextRes) !== normalizeResourceId(other.resourceId)) {
      continue
    }
    if (intervalsOverlap(args.start, args.end, other.start, other.end)) return false
  }
  return true
}
