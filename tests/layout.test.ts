/**
 * @vitest-environment jsdom
 */

import { describe, expect, it } from 'vitest'
import {
  clipTimedBox,
  layoutCollisionGroups,
  layoutDayBlocks,
  placeVisibleWork,
  visibleWorkMs
} from '../src/views/timeGrid'
import type { NormalizedEvent } from '../src/types'

function timed(
  id: string,
  startH: number,
  startM: number,
  endH: number,
  endM: number
): NormalizedEvent {
  return {
    id,
    title: id,
    start: new Date(2026, 7, 20, startH, startM),
    end: new Date(2026, 7, 20, endH, endM)
  }
}

describe('layoutDayBlocks', () => {
  const day = new Date(2026, 7, 20)

  it('non-overlapping events use full width', () => {
    const blocks = layoutDayBlocks(
      [timed('A', 9, 0, 10, 0), timed('B', 12, 0, 13, 0)],
      day,
      9,
      18
    )
    expect(blocks).toHaveLength(2)
    expect(blocks.every((b) => b.colCount === 1)).toBe(true)
  })

  it('same-start events share columns instead of stacking full width', () => {
    const blocks = layoutDayBlocks(
      [timed('A', 11, 0, 12, 0), timed('B', 11, 0, 12, 0)],
      day,
      8,
      18
    )
    expect(blocks).toHaveLength(2)
    expect(blocks[0].colCount).toBe(2)
    expect(blocks[1].colCount).toBe(2)
    expect(blocks[0].col).not.toBe(blocks[1].col)
  })

  it('overlapping events share columns within a group', () => {
    const blocks = layoutDayBlocks(
      [timed('A', 9, 0, 10, 0), timed('B', 9, 30, 11, 0)],
      day,
      9,
      18
    )
    expect(blocks).toHaveLength(2)
    expect(blocks[0].colCount).toBe(2)
    expect(blocks[1].colCount).toBe(2)
  })

  it('later non-overlapping group is not narrowed by earlier overlap', () => {
    const blocks = layoutDayBlocks(
      [
        timed('A', 9, 0, 10, 0),
        timed('B', 9, 30, 11, 0),
        timed('C', 12, 0, 13, 0)
      ],
      day,
      9,
      18
    )
    const c = blocks.find((b) => b.event.id === 'C')!
    expect(c.colCount).toBe(1)
    expect(c.col).toBe(0)
  })
})

describe('placeVisibleWork', () => {
  it('keeps a 3-hour task on the same day when it still fits', () => {
    const placed = placeVisibleWork(new Date(2026, 8, 14, 13, 0), 3 * 36e5, 8, 18)
    expect(placed.start.getHours()).toBe(13)
    expect(placed.end.getHours()).toBe(16)
    expect(placed.end.getDate()).toBe(14)
  })

  it('overflows the leftover hour onto the next morning', () => {
    const placed = placeVisibleWork(new Date(2026, 8, 14, 16, 0), 3 * 36e5, 8, 18)
    expect(placed.start.getHours()).toBe(16)
    expect(placed.end.getDate()).toBe(15)
    expect(placed.end.getHours()).toBe(9)
    expect(visibleWorkMs(placed.start, placed.end, 8, 18)).toBe(3 * 36e5)
  })
})

describe('clipTimedBox', () => {
  it('clips an overnight event to the visible hours of each day', () => {
    const start = new Date(2026, 8, 14, 16, 0)
    const end = new Date(2026, 8, 15, 11, 0)
    const first = clipTimedBox(start, end, new Date(2026, 8, 14), 8, 18)
    const second = clipTimedBox(start, end, new Date(2026, 8, 15), 8, 18)
    expect(first?.top).toBe(384)
    expect(first?.height).toBe(96)
    expect(second?.top).toBe(0)
    expect(second?.height).toBe(144)
  })
})

describe('layoutCollisionGroups', () => {
  it('splits independent overlap groups', () => {
    const placed = layoutCollisionGroups([
      { event: timed('A', 9, 0, 10, 0), top: 0, height: 48, endMs: 0 },
      { event: timed('B', 9, 30, 11, 0), top: 24, height: 72, endMs: 0 },
      { event: timed('C', 12, 0, 13, 0), top: 144, height: 48, endMs: 0 }
    ])
    const c = placed.find((p) => p.event.id === 'C')!
    expect(c.colCount).toBe(1)
  })
})
