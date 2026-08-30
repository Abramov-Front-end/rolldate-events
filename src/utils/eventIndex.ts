/**
 * Shared multi-day indexing — same logic as EventStore.index().
 */
import type { NormalizedEvent } from '../types'
import { addDays, dayKey, startOfDay } from './date'

export function indexEventsByDay(events: NormalizedEvent[]): Map<string, NormalizedEvent[]> {
  const byDay = new Map<string, NormalizedEvent[]>()
  for (const ev of events) {
    let cursor = startOfDay(ev.start)
    const last = startOfDay(ev.end)
    let guard = 0
    while (cursor <= last && guard < 370) {
      const k = dayKey(cursor)
      const list = byDay.get(k) || []
      list.push(ev)
      byDay.set(k, list)
      cursor = addDays(cursor, 1)
      guard++
    }
  }
  for (const list of byDay.values()) {
    list.sort((a, b) => a.start.getTime() - b.start.getTime())
  }
  return byDay
}
