/**
 * Shared timed-grid helpers for Week & Day views.
 * Hours outside visibleHours are not mounted (virtualized band).
 */

import type { NormalizedEvent, ViewContext } from '../types'
import { eventEditableAttr, isEventEditable } from '../utils/eventEditable'
import { addDays, dayKey, eachDayKey, formatTime, parseDayKey, startOfWeek } from '../utils/date'
import { escapeAttr, escapeHtml } from '../utils/dom'

export const HOUR_PX = 48
export const ALL_DAY_ROW_PX = 32
/** Cap for Week / Day / Timeline — shrinks to hour content when smaller */
export const TIMEGRID_MAX_PX = 680

export interface LayoutBlock {
  event: NormalizedEvent
  dayIndex: number
  top: number
  height: number
  col: number
  colCount: number
}

interface TimedItem {
  event: NormalizedEvent
  top: number
  height: number
  endMs: number
}

/** Pack overlapping events into columns within a day — per collision group */
export function layoutDayBlocks(
  events: NormalizedEvent[],
  day: Date,
  hourStart: number,
  hourEnd: number
): LayoutBlock[] {
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hourStart, 0, 0, 0)
  const dayEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hourEnd, 0, 0, 0)
  const items: TimedItem[] = events
    .filter((e) => e.start < dayEnd && e.end > dayStart && !e.allDay)
    .map((e) => {
      const start = e.start < dayStart ? dayStart : e.start
      const end = e.end > dayEnd ? dayEnd : e.end
      const top = ((start.getHours() + start.getMinutes() / 60) - hourStart) * HOUR_PX
      const height = Math.max(18, ((end.getTime() - start.getTime()) / 36e5) * HOUR_PX)
      return { event: e, top, height, endMs: end.getTime() }
    })
    .sort((a, b) => a.top - b.top || b.height - a.height)

  return layoutCollisionGroups(items)
}

/** Split items into collision groups and lay out each independently */
export function layoutCollisionGroups(items: TimedItem[]): LayoutBlock[] {
  if (!items.length) return []

  const groups: TimedItem[][] = []
  let group: TimedItem[] = []
  let groupEnd = 0

  for (const it of items) {
    if (!group.length || it.top >= groupEnd - 0.5) {
      if (group.length) groups.push(group)
      group = [it]
      groupEnd = it.top + it.height
    } else {
      group.push(it)
      groupEnd = Math.max(groupEnd, it.top + it.height)
    }
  }
  if (group.length) groups.push(group)

  const placed: LayoutBlock[] = []
  for (const g of groups) {
    placed.push(...layoutGroup(g))
  }
  return placed
}

function layoutGroup(items: TimedItem[]): LayoutBlock[] {
  const colEnds: number[] = []
  const placed: LayoutBlock[] = []
  for (const it of items) {
    let col = colEnds.findIndex((end) => end <= it.top + 0.5)
    if (col === -1) {
      col = colEnds.length
      colEnds.push(it.top + it.height)
    } else {
      colEnds[col] = it.top + it.height
    }
    placed.push({
      event: it.event,
      dayIndex: 0,
      top: it.top,
      height: it.height,
      col,
      colCount: 1
    })
  }
  const maxCol = Math.max(1, ...placed.map((p) => p.col + 1))
  for (const p of placed) p.colCount = maxCol
  return placed
}

export function visibleSegment(
  start: Date,
  end: Date,
  day: Date,
  hourStart: number,
  hourEnd: number
): { start: Date; end: Date } | null {
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hourStart, 0, 0, 0)
  const dayEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hourEnd, 0, 0, 0)
  const s = start < dayStart ? dayStart : new Date(start)
  const e = end > dayEnd ? dayEnd : new Date(end)
  if (e <= s) return null
  return { start: s, end: e }
}

export function eventSegments(
  start: Date,
  end: Date,
  hourStart: number,
  hourEnd: number
): { start: Date; end: Date }[] {
  const out: { start: Date; end: Date }[] = []
  for (const key of eachDayKey(start, end)) {
    const seg = visibleSegment(start, end, parseDayKey(key), hourStart, hourEnd)
    if (seg) out.push(seg)
  }
  return out
}

/** Working time inside visible hours — overnight gap is not part of the duration. */
export function visibleWorkMs(
  start: Date,
  end: Date,
  hourStart: number,
  hourEnd: number
): number {
  return eventSegments(start, end, hourStart, hourEnd).reduce(
    (sum, seg) => sum + (seg.end.getTime() - seg.start.getTime()),
    0
  )
}

export function placeVisibleWork(
  start: Date,
  workMs: number,
  hourStart: number,
  hourEnd: number
): { start: Date; end: Date } {
  const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), hourStart, 0, 0, 0)
  const dayEnd = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), hourEnd, 0, 0, 0)
  let cursor = new Date(start)
  if (cursor < dayStart(cursor)) cursor = dayStart(cursor)
  while (cursor >= dayEnd(cursor)) cursor = addDays(dayStart(cursor), 1)
  const begin = new Date(cursor)
  let left = Math.max(0, workMs)
  if (!left) return { start: begin, end: new Date(begin.getTime() + 15 * 6e4) }
  while (left > 0) {
    const avail = dayEnd(cursor).getTime() - cursor.getTime()
    if (avail >= left) return { start: begin, end: new Date(cursor.getTime() + left) }
    left -= Math.max(0, avail)
    cursor = addDays(dayStart(cursor), 1)
  }
  return { start: begin, end: cursor }
}

/** Visible portion of a timed event inside one day's hour band. */
export function clipTimedBox(
  start: Date,
  end: Date,
  day: Date,
  hourStart: number,
  hourEnd: number
): { top: number; height: number } | null {
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hourStart, 0, 0, 0)
  const dayEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hourEnd, 0, 0, 0)
  const s = start < dayStart ? dayStart : start
  const e = end > dayEnd ? dayEnd : end
  if (e <= s) return null
  const top = (s.getHours() + s.getMinutes() / 60 - hourStart) * HOUR_PX
  const height = Math.max(18, ((e.getTime() - s.getTime()) / 36e5) * HOUR_PX)
  return { top, height }
}

export function blockBoxStyle(b: LayoutBlock): { top: string; height: string; left: string; width: string } {
  const width = 100 / Math.max(1, b.colCount)
  const left = b.col * width
  return {
    top: `${b.top}px`,
    height: `${b.height}px`,
    left: `calc(${left}% + 2px)`,
    width: `calc(${width}% - 4px)`
  }
}

export function allDayEventsForDay(events: NormalizedEvent[], day: Date): NormalizedEvent[] {
  const key = dayKey(day)
  return events.filter((e) => {
    if (!e.allDay) return false
    return key >= dayKey(e.start) && key <= dayKey(e.end)
  })
}

export function renderAllDayHtml(
  events: NormalizedEvent[],
  locale: string,
  calendarEditable = false
): string {
  if (!events.length) {
    return '<div class="rde-allday rde-allday--empty"></div>'
  }
  const chips = events
    .map((ev) => {
      const id = String(ev.occurrenceId || ev.id)
      const color = ev.color || 'var(--rde-event-default)'
      return `<button type="button" class="rde-allday__chip" data-event-id="${escapeAttr(id)}" data-editable="${eventEditableAttr(ev, calendarEditable)}" style="--rde-event-color:${escapeAttr(color)}" title="${escapeAttr(ev.title)}">${escapeHtml(ev.title)}</button>`
    })
    .join('')
  return `<div class="rde-allday">${chips}</div>`
}

export function renderHourLabels(hourStart: number, hourEnd: number): string {
  const rows: string[] = []
  for (let h = hourStart; h < hourEnd; h++) {
    const label = `${String(h).padStart(2, '0')}:00`
    rows.push(`<div class="rde-tg-label" style="height:${HOUR_PX}px">${label}</div>`)
  }
  return rows.join('')
}

export function resizeHandlesHtml(axis: 'ns' | 'ew'): string {
  return (
    `<span class="rde-resize rde-resize--${axis} rde-resize--start" data-resize="start" aria-hidden="true"></span>` +
    `<span class="rde-resize rde-resize--${axis} rde-resize--end" data-resize="end" aria-hidden="true"></span>`
  )
}

export function renderBlocksHtml(
  blocks: LayoutBlock[],
  locale: string,
  calendarEditable = false
): string {
  return blocks
    .map((b) => {
      const id = String(b.event.occurrenceId || b.event.id)
      const color = b.event.color || 'var(--rde-event-default)'
      const width = 100 / b.colCount
      const left = b.col * width
      const time = formatTime(b.event.start, locale)
      const handles = isEventEditable(b.event, calendarEditable) ? resizeHandlesHtml('ns') : ''
      return `<button type="button" class="rde-block" data-event-id="${escapeAttr(id)}" data-editable="${eventEditableAttr(b.event, calendarEditable)}" style="--rde-event-color:${escapeAttr(color)};top:${b.top}px;height:${b.height}px;left:calc(${left}% + 2px);width:calc(${width}% - 4px)" title="${escapeAttr(b.event.title)}"><span class="rde-block__title">${escapeHtml(b.event.title)}</span><small>${escapeHtml(time)}${b.event.location ? ' · ' + escapeHtml(b.event.location) : ''}</small>${handles}</button>`
    })
    .join('')
}

export function eventsForDayKey(events: NormalizedEvent[], key: string): NormalizedEvent[] {
  return events.filter((e) => {
    const s = dayKey(e.start)
    const en = dayKey(e.end)
    return key >= s && key <= en
  })
}

export function weekDates(cursor: Date, firstDayOfWeek: 0 | 1): Date[] {
  const start = startOfWeek(cursor, firstDayOfWeek)
  return Array.from({ length: 7 }, (_, i) => addDays(start, i))
}
