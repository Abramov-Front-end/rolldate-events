import { describe, expect, it } from 'vitest'
import { intervalsOverlap, isOverlapAllowed, isSameMovedEvent } from '../src/utils/eventOverlap'

const a = {
  id: 'a',
  start: new Date(2026, 8, 14, 10, 0),
  end: new Date(2026, 8, 14, 11, 0),
  resourceId: 'anna'
}
const b = {
  id: 'b',
  start: new Date(2026, 8, 14, 11, 0),
  end: new Date(2026, 8, 14, 12, 0),
  resourceId: 'anna'
}
const mid = {
  id: 'b',
  start: new Date(2026, 8, 14, 10, 30),
  end: new Date(2026, 8, 14, 11, 30),
  resourceId: 'anna'
}

describe('intervalsOverlap [start, end)', () => {
  it('allows touching edges and rejects a real overlap', () => {
    expect(intervalsOverlap(a.start, a.end, b.start, b.end)).toBe(false)
    expect(intervalsOverlap(a.start, a.end, mid.start, mid.end)).toBe(true)
    expect(intervalsOverlap(a.start, a.end, a.start, a.end)).toBe(true)
  })
})

describe('isOverlapAllowed', () => {
  it('allows overlap when the option is true or omitted', () => {
    expect(
      isOverlapAllowed({
        moving: a,
        start: mid.start,
        end: mid.end,
        others: [a, mid]
      })
    ).toBe(true)
    expect(
      isOverlapAllowed({
        allowOverlap: true,
        moving: a,
        start: mid.start,
        end: mid.end,
        others: [a, mid]
      })
    ).toBe(true)
  })

  it('rejects a [start, end) overlap when allowOverlap is false', () => {
    expect(
      isOverlapAllowed({
        allowOverlap: false,
        moving: a,
        start: new Date(2026, 8, 14, 10, 30),
        end: new Date(2026, 8, 14, 11, 30),
        others: [a, b]
      })
    ).toBe(false)
  })

  it('allows end === other.start', () => {
    expect(
      isOverlapAllowed({
        allowOverlap: false,
        moving: a,
        start: a.start,
        end: a.end,
        others: [a, b]
      })
    ).toBe(true)
  })

  it('does not treat the moving event as a conflict', () => {
    expect(
      isOverlapAllowed({
        allowOverlap: false,
        moving: a,
        start: a.start,
        end: a.end,
        others: [a]
      })
    ).toBe(true)
    expect(isSameMovedEvent({ id: 1, occurrenceId: '1::x' }, { id: 1, occurrenceId: '1::x' })).toBe(
      true
    )
    expect(isSameMovedEvent({ id: 1, occurrenceId: '1::x' }, { id: 1, occurrenceId: '1::y' })).toBe(
      false
    )
  })

  it('lets other recurring occurrences participate', () => {
    expect(
      isOverlapAllowed({
        allowOverlap: false,
        moving: { id: 'series', occurrenceId: 'series::mon' },
        start: new Date(2026, 8, 15, 10, 0),
        end: new Date(2026, 8, 15, 11, 0),
        others: [
          {
            id: 'series',
            occurrenceId: 'series::tue',
            start: new Date(2026, 8, 15, 10, 0),
            end: new Date(2026, 8, 15, 10, 45)
          }
        ]
      })
    ).toBe(false)
  })

  it('on Timeline only compares the same resource', () => {
    const ira = { ...mid, id: 'c', resourceId: 'ira' }
    expect(
      isOverlapAllowed({
        allowOverlap: false,
        view: 'timeline',
        moving: a,
        start: mid.start,
        end: mid.end,
        resourceId: 'ira',
        others: [a, ira]
      })
    ).toBe(false)
    expect(
      isOverlapAllowed({
        allowOverlap: false,
        view: 'timeline',
        moving: a,
        start: mid.start,
        end: mid.end,
        resourceId: 'ira',
        others: [a]
      })
    ).toBe(true)
  })

  it('on Week compares across resources', () => {
    expect(
      isOverlapAllowed({
        allowOverlap: false,
        view: 'week',
        moving: a,
        start: mid.start,
        end: mid.end,
        others: [{ ...mid, id: 'c', resourceId: 'ira' }]
      })
    ).toBe(false)
  })
})
