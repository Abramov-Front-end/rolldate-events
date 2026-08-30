import { describe, expect, it } from 'vitest'
import {
  clampDate,
  isDayInRange,
  primaryMonthForWeek,
  startOfDay,
  startOfWeek
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
})
