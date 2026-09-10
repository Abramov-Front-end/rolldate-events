/**
 * Shared per-day indexing and change detection for views.
 */
import type { NormalizedEvent } from '../types'
import { addDays, dayKey, startOfDay } from './date'

function sameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getDate() === b.getDate() &&
    a.getMonth() === b.getMonth() &&
    a.getFullYear() === b.getFullYear()
  )
}

function push(byDay: Map<string, NormalizedEvent[]>, key: string, ev: NormalizedEvent): void {
  const list = byDay.get(key)
  if (list) list.push(ev)
  else byDay.set(key, [ev])
}

export function indexEventsByDay(events: NormalizedEvent[]): Map<string, NormalizedEvent[]> {
  const byDay = new Map<string, NormalizedEvent[]>()
  for (const ev of events) {
    // Single-day events dominate real datasets — avoid Date allocation for them
    if (sameCalendarDay(ev.start, ev.end)) {
      push(byDay, dayKey(ev.start), ev)
      continue
    }
    let cursor = startOfDay(ev.start)
    const last = startOfDay(ev.end)
    let guard = 0
    while (cursor <= last && guard < 370) {
      push(byDay, dayKey(cursor), ev)
      cursor = addDays(cursor, 1)
      guard++
    }
  }
  for (const list of byDay.values()) {
    list.sort((a, b) => a.start.getTime() - b.start.getTime())
  }
  return byDay
}

/**
 * Cheap sampled signature of a prepared event slice.
 * Used to skip re-indexing / DOM refresh when the slice did not change.
 */
export function eventsFingerprint(events: NormalizedEvent[]): string {
  if (!events.length) return '0'
  const a = events[0]
  const b = events[events.length - 1]
  const m = events[events.length >> 1]
  return `${events.length}:${String(a.id)}:${String(m.id)}:${String(b.id)}:${a.start.getTime()}:${b.end.getTime()}`
}
