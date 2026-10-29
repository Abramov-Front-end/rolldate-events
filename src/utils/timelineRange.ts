import { addDays, startOfDay, startOfWeek } from './date'

/** ~7 days in the viewport; day width does not shrink with the loaded buffer. */
export const TIMELINE_VISIBLE_DAYS = 7
export const TIMELINE_BUFFER_DAYS = 7
export const TIMELINE_EXTEND_DAYS = 7
export const TIMELINE_MAX_DAYS = 35
export const TIMELINE_MIN_DAY_PX = 128
export const TIMELINE_DAY_PAD = 4
export const TIMELINE_LABEL_PX = 140
export const TIMELINE_LABEL_COMPACT_PX = 96
export const TIMELINE_EDGE_PX = 48

export function timelineRangeStart(cursor: Date, firstDayOfWeek: 0 | 1): Date {
  return startOfWeek(cursor, firstDayOfWeek)
}

export function timelineRange(
  cursor: Date,
  firstDayOfWeek: 0 | 1
): { start: Date; end: Date } {
  const start = startOfDay(cursor)
  return { start, end: addDays(start, TIMELINE_VISIBLE_DAYS) }
}

export function timelineBufferRange(
  cursor: Date,
  _firstDayOfWeek: 0 | 1
): { start: Date; end: Date; days: number } {
  const visible = startOfDay(cursor)
  const start = addDays(visible, -TIMELINE_BUFFER_DAYS)
  const days = TIMELINE_BUFFER_DAYS + TIMELINE_VISIBLE_DAYS + TIMELINE_BUFFER_DAYS
  return { start, end: addDays(start, days), days }
}

export function shiftTimelineRange(start: Date, dir: 1 | -1): Date {
  return addDays(startOfDay(start), TIMELINE_VISIBLE_DAYS * dir)
}

export function timelineLabelPx(compact: boolean): number {
  return compact ? TIMELINE_LABEL_COMPACT_PX : TIMELINE_LABEL_PX
}

/** Fixed readable day width from the viewport, not from how many dates are mounted. */
export function timelineDayPx(layoutWidth: number, compact: boolean): number {
  const inner = Math.max(280, layoutWidth - timelineLabelPx(compact))
  return Math.max(TIMELINE_MIN_DAY_PX, Math.round(inner / TIMELINE_VISIBLE_DAYS))
}

export function timelineAxisWidth(dayPx: number, days: number): number {
  return dayPx * days
}

export function timelineVisibleFromScroll(
  bufferStart: Date,
  scrollLeft: number,
  dayPx: number,
  viewportInner: number
): { start: Date; end: Date } {
  const first = Math.max(0, Math.floor((scrollLeft + 1) / Math.max(1, dayPx)))
  const count = Math.max(
    1,
    Math.round(viewportInner / Math.max(1, dayPx)) || TIMELINE_VISIBLE_DAYS
  )
  const start = addDays(bufferStart, first)
  return { start, end: addDays(start, count) }
}

export function adjustScrollAfterPrepend(
  scrollLeft: number,
  addedDays: number,
  dayPx: number
): number {
  return scrollLeft + addedDays * dayPx
}

export function formatTimelineTitle(start: Date, endExclusive: Date, locale: string): string {
  const last = addDays(endExclusive, -1)
  const sameYear = start.getFullYear() === last.getFullYear()
  const sameMonth = sameYear && start.getMonth() === last.getMonth()
  if (sameMonth) {
    const month = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(start)
    return `${start.getDate()}–${last.getDate()} ${month}`
  }
  const a = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(start)
  const b = new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(last)
  return `${a} – ${b}`
}
