import { describe, expect, it } from 'vitest'
import {
  COMPACT_BREAKPOINT,
  isCompactWidth,
  maxOverlapColumns,
  monthCompactDaySize,
  monthCompactIndicators,
  monthWeekRowHeight,
  weekDayColumnWidth,
  weekLayoutMetrics
} from '../src/utils/responsive'

describe('responsive utils', () => {
  it('compact breakpoint at 640px', () => {
    expect(isCompactWidth(640)).toBe(true)
    expect(isCompactWidth(641)).toBe(false)
    expect(isCompactWidth(320)).toBe(true)
    expect(COMPACT_BREAKPOINT).toBe(640)
  })

  it('month week row height by mode', () => {
    expect(monthWeekRowHeight(false)).toBe(108)
    expect(monthWeekRowHeight(true, 375)).toBe(monthCompactDaySize(375))
    expect(monthWeekRowHeight(true, 375)).toBe(51)
    expect(monthWeekRowHeight(true, 640)).toBe(89)
  })

  it('compact month day cells are square from container width', () => {
    expect(monthCompactDaySize(375)).toBe(51)
    expect(monthCompactDaySize(390)).toBe(53)
    expect(monthWeekRowHeight(true, 390)).toBe(monthCompactDaySize(390))
  })

  it('month compact indicators cap at 3 dots', () => {
    expect(monthCompactIndicators(0)).toEqual({ dots: 0, more: 0 })
    expect(monthCompactIndicators(2)).toEqual({ dots: 2, more: 0 })
    expect(monthCompactIndicators(3)).toEqual({ dots: 3, more: 0 })
    expect(monthCompactIndicators(7)).toEqual({ dots: 3, more: 4 })
  })

  it('week day column width stays in readable bounds', () => {
    expect(weekDayColumnWidth(375)).toBeGreaterThanOrEqual(110)
    expect(weekDayColumnWidth(375)).toBeLessThanOrEqual(140)
    expect(weekDayColumnWidth(1200)).toBe(140)
  })

  it('desktop week segment equals viewport width', () => {
    const m = weekLayoutMetrics(900, false)
    expect(m.segW).toBe(900)
    expect(m.dayWidth).toBeCloseTo(900 / 7, 1)
  })

  it('compact week segment is 7 × day columns', () => {
    const m = weekLayoutMetrics(375, true)
    expect(m.segW).toBe(m.dayWidth * 7)
    expect(m.segW).toBeGreaterThan(375)
  })

  it('overlap columns limited on compact narrow days', () => {
    expect(maxOverlapColumns(120, true)).toBe(2)
    expect(maxOverlapColumns(900, false)).toBe(12)
  })
})
