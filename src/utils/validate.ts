/**
 * Lightweight validation + normalization for events and options.
 */

import type { Event, NormalizedEvent, RollDateEventsOptions } from '../types'
import { clampHour, endOfDay, startOfDay, toDate } from './date'
import { devWarn } from './devWarn'

declare const __PRO__: boolean

export function validateOptions(options: RollDateEventsOptions): void {
  if (options.visibleHours) {
    const { start, end } = options.visibleHours
    const cs = clampHour(start)
    const ce = clampHour(end)
    if (cs !== start || ce !== end || end <= start) {
      devWarn(
        'opts-visibleHours',
        `[RollDateEvents] invalid visibleHours (${JSON.stringify(options.visibleHours)}); expected start < end, hours 0–23.`
      )
    }
  }

  if (options.minDate && options.maxDate) {
    const min = startOfDay(toDate(options.minDate))
    const max = endOfDay(toDate(options.maxDate))
    if (min.getTime() > max.getTime()) {
      devWarn(
        'opts-min-max',
        '[RollDateEvents] minDate is after maxDate; navigation bounds may behave unexpectedly.'
      )
    }
  }
}

export function normalizeEvent(event: Event, seenIds?: Set<string>): NormalizedEvent {
  let start: Date
  let end: Date

  try {
    start = toDate(event.start)
  } catch {
    devWarn(`ev-start-${String(event.id)}`, `[RollDateEvents] Event "${String(event.id)}" has invalid start date.`)
    start = new Date()
  }

  try {
    end = toDate(event.end)
  } catch {
    devWarn(`ev-end-${String(event.id)}`, `[RollDateEvents] Event "${String(event.id)}" has invalid end date.`)
    end = new Date(start)
  }

  if (end.getTime() < start.getTime()) {
    devWarn(
      `ev-range-${String(event.id)}`,
      `[RollDateEvents] Event "${String(event.id)}" has end before start; using start as end.`
    )
    end = new Date(start)
  }

  const id = String(event.id)
  if (seenIds) {
    if (seenIds.has(id)) {
      devWarn(`ev-dup-${id}`, `[RollDateEvents] duplicate event id "${id}".`)
    }
    seenIds.add(id)
  }

  return { ...event, start, end }
}
