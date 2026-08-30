import { describe, expect, it } from 'vitest'
import { layoutCollisionGroups, layoutDayBlocks } from '../src/views/timeGrid'
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
