/**
 * Agenda layout helpers — sorting and segment height estimates.
 */

import type { NormalizedEvent } from '../types'

export const AGENDA_ITEM_PX = 34
export const AGENDA_HEADER_PX = 36
export const AGENDA_SEG_PAD = 20
export const AGENDA_EMPTY_PX = 28
export const AGENDA_ITEM_GAP = 2

/** Estimated day block height from event count (scroll anchoring hint only) */
export function agendaSegHeight(eventCount: number): number {
  if (eventCount <= 0) return AGENDA_HEADER_PX + AGENDA_EMPTY_PX + AGENDA_SEG_PAD
  const gaps = Math.max(0, eventCount - 1) * AGENDA_ITEM_GAP
  return AGENDA_HEADER_PX + eventCount * AGENDA_ITEM_PX + gaps + AGENDA_SEG_PAD
}

/** All-day first, then timed events chronologically */
export function sortAgendaDayEvents(events: NormalizedEvent[]): NormalizedEvent[] {
  const allDay: NormalizedEvent[] = []
  const timed: NormalizedEvent[] = []
  for (const ev of events) {
    if (ev.allDay) allDay.push(ev)
    else timed.push(ev)
  }
  const byTitle = (a: NormalizedEvent, b: NormalizedEvent): number =>
    a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
  allDay.sort((a, b) => byTitle(a, b))
  timed.sort((a, b) => {
    const dt = a.start.getTime() - b.start.getTime()
    return dt !== 0 ? dt : byTitle(a, b)
  })
  return [...allDay, ...timed]
}

/** Events for a day key — sorted, never truncated */
export function agendaEventsForDay(
  byDay: Map<string, NormalizedEvent[]>,
  key: string
): NormalizedEvent[] {
  return sortAgendaDayEvents(byDay.get(key) || [])
}

export interface AgendaSegRect {
  dayKey: string
  offsetTop: number
  height: number
}

/** Day block with the largest visible area in the agenda viewport */
export function agendaDominantDayKey(
  scrollTop: number,
  viewportHeight: number,
  segments: AgendaSegRect[]
): string {
  if (!segments.length) return ''
  const viewTop = scrollTop
  const viewBottom = scrollTop + viewportHeight
  let bestKey = segments[0].dayKey
  let bestVisible = -1
  for (const seg of segments) {
    const segTop = seg.offsetTop
    const segBottom = segTop + seg.height
    const visible = Math.max(
      0,
      Math.min(segBottom, viewBottom) - Math.max(segTop, viewTop)
    )
    if (visible > bestVisible) {
      bestVisible = visible
      bestKey = seg.dayKey
    }
  }
  return bestKey
}

/** Same as agendaDominantDayKey but uses live layout rects (stable after DOM churn). */
export function agendaDominantDayKeyFromRects(
  viewportTop: number,
  viewportBottom: number,
  segments: Array<{ dayKey: string; top: number; bottom: number }>
): string {
  if (!segments.length) return ''
  let bestKey = segments[0].dayKey
  let bestVisible = -1
  for (const seg of segments) {
    const visible = Math.max(
      0,
      Math.min(seg.bottom, viewportBottom) - Math.max(seg.top, viewportTop)
    )
    if (visible > bestVisible) {
      bestVisible = visible
      bestKey = seg.dayKey
    }
  }
  return bestKey
}

const TOP_ANCHOR_SLACK_PX = 12

/**
 * Agenda title — last day whose header has reached the viewport top
 * (sticky-header behaviour; avoids picking a tall previous day still in view).
 */
export function agendaTopAnchorDayKey(
  viewportTop: number,
  segments: Array<{ dayKey: string; top: number; bottom: number }>
): string {
  if (!segments.length) return ''
  const sorted = segments.slice().sort((a, b) => a.top - b.top)
  if (sorted[0].top > viewportTop + TOP_ANCHOR_SLACK_PX) return sorted[0].dayKey
  let anchor = sorted[0].dayKey
  for (const seg of sorted) {
    if (seg.top <= viewportTop + TOP_ANCHOR_SLACK_PX) anchor = seg.dayKey
    else break
  }
  return anchor
}

/** Day keys with meaningful visible area inside the agenda viewport. */
export function agendaVisibleDayKeys(
  viewportTop: number,
  viewportBottom: number,
  segments: Array<{ dayKey: string; top: number; bottom: number }>,
  minVisiblePx = 20
): string[] {
  const keys: string[] = []
  for (const seg of segments) {
    const visible = Math.max(
      0,
      Math.min(seg.bottom, viewportBottom) - Math.max(seg.top, viewportTop)
    )
    if (visible >= minVisiblePx) keys.push(seg.dayKey)
  }
  return keys
}
