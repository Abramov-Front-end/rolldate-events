import { describe, expect, it } from 'vitest'
import type { NormalizedEvent } from '../src/types'
import {
  agendaDominantDayKey,
  agendaDominantDayKeyFromRects,
  agendaEventsForDay,
  agendaSegHeight,
  agendaTopAnchorDayKey,
  agendaVisibleDayKeys,
  sortAgendaDayEvents
} from '../src/utils/agendaLayout'

function ev(
  id: number,
  start: string,
  opts: { allDay?: boolean; title?: string } = {}
): NormalizedEvent {
  const d = new Date(start)
  return {
    id,
    title: opts.title ?? `Event ${id}`,
    start: d,
    end: d,
    allDay: opts.allDay
  }
}

describe('agendaLayout', () => {
  it('empty day has compact height', () => {
    expect(agendaSegHeight(0)).toBeGreaterThan(40)
  })

  it('height grows with event count', () => {
    expect(agendaSegHeight(5)).toBeGreaterThan(agendaSegHeight(2))
    expect(agendaSegHeight(10)).toBeGreaterThan(agendaSegHeight(5))
  })

  it('sorts all-day before timed events', () => {
    const sorted = sortAgendaDayEvents([
      ev(1, '2026-08-05T10:00:00'),
      ev(2, '2026-08-05T00:00:00', { allDay: true, title: 'All-day A' }),
      ev(3, '2026-08-05T09:00:00')
    ])
    expect(sorted[0].allDay).toBe(true)
    expect(sorted[1].start.getHours()).toBe(9)
    expect(sorted[2].start.getHours()).toBe(10)
  })

  it('returns all events for a day without truncation', () => {
    const byDay = new Map<string, NormalizedEvent[]>()
    const list = Array.from({ length: 8 }, (_, i) => ev(i + 1, '2026-08-05T09:00:00'))
    byDay.set('2026-08-05', list)
    expect(agendaEventsForDay(byDay, '2026-08-05')).toHaveLength(8)
  })

  it('picks the day with the largest visible area in the viewport', () => {
    const segs = [
      { dayKey: '2026-07-22', offsetTop: 0, height: 80 },
      { dayKey: '2026-07-23', offsetTop: 80, height: 400 },
      { dayKey: '2026-07-24', offsetTop: 480, height: 300 }
    ]
    expect(agendaDominantDayKey(90, 300, segs)).toBe('2026-07-23')
    expect(agendaDominantDayKey(10, 300, segs)).toBe('2026-07-23')
    expect(agendaDominantDayKey(0, 60, segs)).toBe('2026-07-22')
  })

  it('picks dominant day from live layout rects', () => {
    const segs = [
      { dayKey: '2026-07-22', top: 100, bottom: 180 },
      { dayKey: '2026-07-23', top: 180, bottom: 580 },
      { dayKey: '2026-07-24', top: 580, bottom: 880 }
    ]
    expect(agendaDominantDayKeyFromRects(200, 500, segs)).toBe('2026-07-23')
    expect(agendaDominantDayKeyFromRects(120, 200, segs)).toBe('2026-07-22')
  })

  it('top anchor follows sticky header, not largest visible block', () => {
    const segs = [
      { dayKey: '2026-07-22', top: 100, bottom: 900 },
      { dayKey: '2026-07-23', top: 900, bottom: 1020 }
    ]
    // Day 23 occupies more pixels, but its header has not reached the top yet.
    expect(agendaDominantDayKeyFromRects(880, 980, segs)).toBe('2026-07-23')
    expect(agendaTopAnchorDayKey(880, segs)).toBe('2026-07-22')
    expect(agendaTopAnchorDayKey(895, segs)).toBe('2026-07-23')
  })

  it('highlights every day with visible area in the viewport', () => {
    const segs = [
      { dayKey: '2026-07-22', top: 100, bottom: 900 },
      { dayKey: '2026-07-23', top: 900, bottom: 1020 }
    ]
    expect(agendaVisibleDayKeys(880, 980, segs)).toEqual(['2026-07-22', '2026-07-23'])
    expect(agendaVisibleDayKeys(910, 980, segs)).toEqual(['2026-07-23'])
    expect(agendaVisibleDayKeys(50, 90, segs)).toEqual([])
  })
})
