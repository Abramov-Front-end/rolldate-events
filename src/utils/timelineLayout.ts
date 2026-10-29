import type { NormalizedEvent } from '../types'
import { addDays, diffCalendarDays, startOfDay } from './date'
import { TIMELINE_DAY_PAD } from './timelineRange'

export const TIMELINE_LANE_PX = 32
export const TIMELINE_LANE_GAP = 4
export const TIMELINE_ROW_PAD = 6

export interface TimelineDaySpan {
  start: Date
  endExclusive: Date
}

export interface TimelineLaneBlock {
  event: NormalizedEvent
  left: number
  width: number
  lane: number
  lanes: number
  continuesStart: boolean
  continuesEnd: boolean
  daySpan: boolean
}

/** Exclusive calendar-day span on the day axis (timed noon ≠ half-day offset). */
export function timelineEventSpan(event: NormalizedEvent): TimelineDaySpan {
  const start = startOfDay(event.start)
  if (event.allDay) {
    const end = startOfDay(event.end)
    return { start, endExclusive: end > start ? end : addDays(start, 1) }
  }
  const endDay = startOfDay(event.end)
  const endExclusive =
    event.end.getTime() <= endDay.getTime() ? endDay : addDays(endDay, 1)
  return { start, endExclusive: endExclusive > start ? endExclusive : addDays(start, 1) }
}

export function isTimelineDaySpan(event: NormalizedEvent): boolean {
  const span = timelineEventSpan(event)
  return diffCalendarDays(span.endExclusive, span.start) > 1
}

export function timelineRank(event: NormalizedEvent): number {
  const t = event.start.getTime()
  return event.allDay ? t - 1e15 : t
}

export function sortTimelineEvents(events: NormalizedEvent[]): NormalizedEvent[] {
  return [...events].sort((a, b) => {
    const rank = timelineRank(a) - timelineRank(b)
    if (rank) return rank
    if (!!a.allDay !== !!b.allDay) return a.allDay ? -1 : 1
    const t = a.start.getTime() - b.start.getTime()
    if (t) return t
    return String(a.id).localeCompare(String(b.id))
  })
}

export function timelineLaneAtY(clientY: number, rowTop: number, count: number): number {
  const n = Math.max(1, count)
  const y = clientY - rowTop - TIMELINE_ROW_PAD
  return Math.min(n - 1, Math.max(0, Math.floor(y / (TIMELINE_LANE_PX + TIMELINE_LANE_GAP))))
}

export function timelineOrderForInsert(
  group: NormalizedEvent[],
  movingId: string,
  lane: number
): number {
  const others = sortTimelineEvents(
    group.filter((ev) => String(ev.occurrenceId || ev.id) !== movingId)
  )
  const idx = Math.min(Math.max(0, lane), others.length)
  if (!others.length) return 0
  if (idx === 0) return timelineRank(others[0]) - 1
  if (idx >= others.length) return timelineRank(others[others.length - 1]) + 1
  return (timelineRank(others[idx - 1]) + timelineRank(others[idx])) / 2
}

export function insertTimelineLane(
  blocks: TimelineLaneBlock[],
  id: string,
  lane: number
): TimelineLaneBlock[] {
  const mine = blocks.find((b) => String(b.event.occurrenceId || b.event.id) === id)
  if (!mine) return blocks
  const group = blocks.filter(
    (b) => b === mine || (b.left < mine.left + mine.width && mine.left < b.left + b.width)
  )
  const rest = blocks.filter((b) => !group.includes(b))
  const others = group
    .filter((b) => b !== mine)
    .sort((a, b) => a.lane - b.lane || timelineRank(a.event) - timelineRank(b.event))
  const idx = Math.min(Math.max(0, lane), others.length)
  const ordered = [...others.slice(0, idx), mine, ...others.slice(idx)]
  const lanes = ordered.length
  return [...rest, ...ordered.map((b, i) => ({ ...b, lane: i, lanes }))]
}

export function timelineDayBox(
  event: NormalizedEvent,
  rangeStart: Date,
  rangeEnd: Date,
  dayPx: number,
  pad = TIMELINE_DAY_PAD
): { left: number; width: number; continuesStart: boolean; continuesEnd: boolean } {
  const span = timelineEventSpan(event)
  const clipStart = span.start < rangeStart ? rangeStart : span.start
  const clipEnd = span.endExclusive > rangeEnd ? rangeEnd : span.endExclusive
  const startIdx = diffCalendarDays(clipStart, rangeStart)
  const endIdx = Math.max(startIdx + 1, diffCalendarDays(clipEnd, rangeStart))
  return {
    left: startIdx * dayPx + pad,
    width: Math.max(pad * 2, (endIdx - startIdx) * dayPx - pad * 2),
    continuesStart: span.start < rangeStart,
    continuesEnd: span.endExclusive > rangeEnd
  }
}

export function timelineDayIndexAtScroll(
  clientX: number,
  scrollerLeft: number,
  scrollLeft: number,
  labelPx: number,
  dayPx: number,
  dayCount: number
): number {
  const contentX = scrollLeft + clientX - scrollerLeft - labelPx
  const index = Math.floor(contentX / Math.max(1, dayPx))
  return Math.min(Math.max(dayCount - 1, 0), Math.max(0, index))
}

export function timelineMoveToDay(
  origStart: Date,
  origEnd: Date,
  targetDay: Date
): { start: Date; end: Date } {
  const start = new Date(
    targetDay.getFullYear(),
    targetDay.getMonth(),
    targetDay.getDate(),
    origStart.getHours(),
    origStart.getMinutes(),
    0,
    0
  )
  const duration = Math.max(0, origEnd.getTime() - origStart.getTime())
  return { start, end: new Date(start.getTime() + duration) }
}

export function timelineResizeToDay(
  origStart: Date,
  origEnd: Date,
  edge: 'start' | 'end',
  pointerDay: Date
): { start: Date; end: Date } {
  const day = startOfDay(pointerDay)
  if (edge === 'end') {
    let end = addDays(day, 1)
    const minEnd = addDays(startOfDay(origStart), 1)
    if (end.getTime() <= origStart.getTime() || end < minEnd) end = minEnd
    return { start: new Date(origStart), end }
  }
  let start = day
  const maxStart = addDays(startOfDay(origEnd), -1)
  if (start.getTime() >= origEnd.getTime() || start > maxStart) start = maxStart
  return { start, end: new Date(origEnd) }
}

export function layoutTimelineLane(
  events: NormalizedEvent[],
  rangeStart: Date,
  rangeEnd: Date,
  dayPx: number
): TimelineLaneBlock[] {
  const items = events
    .filter((ev) => {
      const span = timelineEventSpan(ev)
      return span.start < rangeEnd && span.endExclusive > rangeStart
    })
    .map((ev) => {
      const box = timelineDayBox(ev, rangeStart, rangeEnd, dayPx)
      return { event: ev, box }
    })

  const groups = overlapComponents(items)
  const out: TimelineLaneBlock[] = []
  for (const group of groups) {
    const ordered = [...group].sort(
      (a, b) => timelineRank(a.event) - timelineRank(b.event) || String(a.event.id).localeCompare(String(b.event.id))
    )
    const colEnds: number[] = []
    const placed = ordered.map((it) => {
      let lane = colEnds.findIndex((end) => end <= it.box.left + 0.5)
      if (lane === -1) {
        lane = colEnds.length
        colEnds.push(it.box.left + it.box.width)
      } else {
        colEnds[lane] = it.box.left + it.box.width
      }
      return { it, lane }
    })
    const lanes = Math.max(1, colEnds.length)
    for (const p of placed) {
      out.push({
        event: p.it.event,
        left: p.it.box.left,
        width: p.it.box.width,
        lane: p.lane,
        lanes,
        continuesStart: p.it.box.continuesStart,
        continuesEnd: p.it.box.continuesEnd,
        daySpan: isTimelineDaySpan(p.it.event)
      })
    }
  }
  return out
}

function overlapComponents<T extends { box: { left: number; width: number } }>(items: T[]): T[][] {
  const n = items.length
  if (!n) return []
  const parent = items.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  const unite = (a: number, b: number): void => {
    const i = find(a)
    const j = find(b)
    if (i !== j) parent[i] = j
  }
  for (let i = 0; i < n; i++) {
    const a = items[i].box
    const aRight = a.left + a.width
    for (let j = i + 1; j < n; j++) {
      const b = items[j].box
      if (a.left < b.left + b.width && b.left < aRight) unite(i, j)
    }
  }
  const buckets = new Map<number, T[]>()
  items.forEach((it, i) => {
    const root = find(i)
    const list = buckets.get(root)
    if (list) list.push(it)
    else buckets.set(root, [it])
  })
  return [...buckets.values()]
}

export function timelineRowHeight(lanes: number): number {
  const n = Math.max(1, lanes)
  return TIMELINE_ROW_PAD * 2 + n * TIMELINE_LANE_PX + (n - 1) * TIMELINE_LANE_GAP
}

export function timelineBlockTop(lane: number): number {
  return TIMELINE_ROW_PAD + lane * (TIMELINE_LANE_PX + TIMELINE_LANE_GAP)
}
