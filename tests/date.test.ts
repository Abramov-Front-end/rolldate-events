import { describe, expect, it } from 'vitest'
import {
  addDays,
  clampDate,
  exclusiveEndOfBoundDay,
  isDayInRange,
  isIntervalInBounds,
  primaryMonthForWeek,
  startOfDay,
  startOfWeek,
  weekTitle
} from '../src/utils/date'
import { dateToDayIndex, dateToWeekIndex, dayIndexToDate } from '../src/utils/infiniteScroll'

describe('date utils', () => {
  it('day index round-trip', () => {
    const d = new Date(2026, 7, 20)
    const idx = dateToDayIndex(d)
    const back = dayIndexToDate(idx)
    expect(back.getFullYear()).toBe(2026)
    expect(back.getMonth()).toBe(7)
    expect(back.getDate()).toBe(20)
  })

  it('week index is stable for same week', () => {
    const d = new Date(2026, 7, 20)
    const a = dateToWeekIndex(d, 1)
    const b = dateToWeekIndex(startOfWeek(d, 1), 1)
    expect(a).toBe(b)
  })

  it('clampDate respects min/max by day', () => {
    const min = startOfDay(new Date(2026, 0, 10))
    const max = startOfDay(new Date(2026, 0, 20))
    const low = clampDate(new Date(2026, 0, 5), min, max)
    const high = clampDate(new Date(2026, 0, 25), min, max)
    expect(low.getDate()).toBe(10)
    expect(high.getDate()).toBe(20)
  })

  it('exclusiveEndOfBoundDay is the next local midnight, including DST', () => {
    const max = startOfDay(new Date(2026, 2, 28))
    const end = exclusiveEndOfBoundDay(max)
    expect(end.getFullYear()).toBe(2026)
    expect(end.getMonth()).toBe(2)
    expect(end.getDate()).toBe(29)
    expect(end.getHours()).toBe(0)
    const across = exclusiveEndOfBoundDay(new Date(2026, 2, 29))
    expect(across.getDate()).toBe(30)
    expect(across.getHours()).toBe(0)
  })

  describe('isIntervalInBounds [start, end)', () => {
    const min = new Date(2026, 8, 10)
    const max = new Date(2026, 8, 20)
    const rangeStart = startOfDay(min)
    const rangeEndExclusive = exclusiveEndOfBoundDay(max)

    it('allows start === rangeStart', () => {
      expect(
        isIntervalInBounds(rangeStart, new Date(2026, 8, 10, 1, 0), min, max)
      ).toBe(true)
    })

    it('rejects start < rangeStart', () => {
      expect(
        isIntervalInBounds(new Date(2026, 8, 9, 23, 0), new Date(2026, 8, 10, 1, 0), min, max)
      ).toBe(false)
    })

    it('allows end === rangeEndExclusive', () => {
      expect(
        isIntervalInBounds(new Date(2026, 8, 20, 22, 0), rangeEndExclusive, min, max)
      ).toBe(true)
    })

    it('rejects end > rangeEndExclusive', () => {
      expect(
        isIntervalInBounds(new Date(2026, 8, 20, 22, 0), new Date(2026, 8, 21, 0, 1), min, max)
      ).toBe(false)
    })

    it('rejects a multi-day [start, end) whose start is in range but end is past rangeEndExclusive', () => {
      expect(
        isIntervalInBounds(new Date(2026, 8, 19, 10, 0), new Date(2026, 8, 21, 0, 1), min, max)
      ).toBe(false)
    })

    it('keeps navigation days inclusive through maxDate', () => {
      expect(isDayInRange(new Date(2026, 8, 20), min, max)).toBe(true)
      expect(isDayInRange(addDays(startOfDay(max), 1), min, max)).toBe(false)
    })
  })

  it('isDayInRange is inclusive', () => {
    const min = new Date(2026, 7, 10)
    const max = new Date(2026, 7, 20)
    expect(isDayInRange(new Date(2026, 7, 10), min, max)).toBe(true)
    expect(isDayInRange(new Date(2026, 7, 20), min, max)).toBe(true)
    expect(isDayInRange(new Date(2026, 7, 9), min, max)).toBe(false)
    expect(isDayInRange(new Date(2026, 7, 21), min, max)).toBe(false)
  })

  it('primaryMonthForWeek prefers month when 1st is in row', () => {
    // Mon-start week Feb 23 – Mar 1 2026; Mar 1 is Sunday
    const weekStart = startOfWeek(new Date(2026, 2, 1), 1)
    const month = primaryMonthForWeek(weekStart)
    expect(month.getFullYear()).toBe(2026)
    expect(month.getMonth()).toBe(2)
  })

  it('primaryMonthForWeek uses Thursday when no 1st in row', () => {
    const weekStart = startOfWeek(new Date(2026, 1, 18), 1)
    const month = primaryMonthForWeek(weekStart)
    expect(month.getMonth()).toBe(1)
  })

  it('weekTitle spans short months when the week crosses a boundary', () => {
    const cross = startOfWeek(new Date(2026, 2, 1), 1) // Feb 23 – Mar 1
    const label = weekTitle(cross, 'en').toLowerCase()
    expect(label).toMatch(/feb/)
    expect(label).toMatch(/mar/)
    expect(label).toMatch(/2026/)

    const single = startOfWeek(new Date(2026, 5, 10), 1)
    expect(weekTitle(single, 'en').toLowerCase()).toMatch(/june 2026/)
  })
})
