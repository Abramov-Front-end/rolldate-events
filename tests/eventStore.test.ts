import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventStore } from '../src/store/EventStore'
import type { Event } from '../src/types'
import { startOfDay } from '../src/utils/date'
import { resetDevWarnings } from '../src/utils/devWarn'

describe('EventStore', () => {
  it('setEvents, add, update, remove', () => {
    const store = new EventStore()
    const a: Event = {
      id: 1,
      title: 'A',
      start: '2026-08-20T09:00:00',
      end: '2026-08-20T10:00:00'
    }
    store.setEvents([a])
    expect(store.getRaw()).toHaveLength(1)

    store.add({ id: 2, title: 'B', start: '2026-08-21T09:00:00', end: '2026-08-21T10:00:00' })
    expect(store.getRaw()).toHaveLength(2)

    expect(store.update(1, { title: 'A2' })).toBe(true)
    expect(store.getRaw()[0].title).toBe('A2')

    expect(store.remove(2)).toBe(true)
    expect(store.getRaw()).toHaveLength(1)
  })

  it('indexes multi-day events on each day', () => {
    const store = new EventStore()
    store.setEvents([
      {
        id: 'm',
        title: 'Trip',
        start: '2026-08-21',
        end: '2026-08-23',
        allDay: true
      }
    ])
    const from = startOfDay(new Date(2026, 7, 20))
    const to = startOfDay(new Date(2026, 7, 25))
    store.prepareRangeSync({ from, to })
    expect(store.forDay(new Date(2026, 7, 21))).toHaveLength(1)
    expect(store.forDay(new Date(2026, 7, 22))).toHaveLength(1)
    expect(store.forDay(new Date(2026, 7, 23))).toHaveLength(1)
    expect(store.forDay(new Date(2026, 7, 24))).toHaveLength(0)
  })

  it('getById returns normalized event', () => {
    const store = new EventStore()
    store.setEvents([{ id: 'x', title: 'X', start: '2026-08-20', end: '2026-08-20' }])
    store.prepareRangeSync({
      from: startOfDay(new Date(2026, 7, 1)),
      to: startOfDay(new Date(2026, 7, 31))
    })
    expect(store.getById('x')?.title).toBe('X')
  })

  it('reports the inclusive day span of stored events', () => {
    const store = new EventStore()
    expect(store.daySpan()).toBeNull()
    store.setEvents([
      { id: 1, title: 'A', start: '2026-08-10T10:00:00', end: '2026-08-10T11:00:00' },
      { id: 2, title: 'B', start: '2026-08-20T10:00:00', end: '2026-08-21T09:00:00' }
    ])
    const span = store.daySpan()
    expect(span).toBeTruthy()
    expect(span!.min.getFullYear()).toBe(2026)
    expect(span!.min.getMonth()).toBe(7)
    expect(span!.min.getDate()).toBe(10)
    expect(span!.max.getDate()).toBe(21)
  })

  it('rebuilds index after timed → all-day update', () => {
    const store = new EventStore()
    store.setEvents([
      {
        id: 'e',
        title: 'E',
        start: '2026-08-20T09:00:00',
        end: '2026-08-20T10:00:00'
      }
    ])
    store.update('e', { allDay: true, start: '2026-08-20', end: '2026-08-22' })
    const from = startOfDay(new Date(2026, 7, 20))
    const to = startOfDay(new Date(2026, 7, 25))
    store.prepareRangeSync({ from, to })
    expect(store.forDay(new Date(2026, 7, 21))).toHaveLength(1)
    expect(store.forDay(new Date(2026, 7, 22))).toHaveLength(1)
  })

  it('clears stale day index when event moves', () => {
    const store = new EventStore()
    store.setEvents([
      { id: 'm', title: 'M', start: '2026-08-20T09:00:00', end: '2026-08-20T10:00:00' }
    ])
    store.prepareRangeSync({
      from: startOfDay(new Date(2026, 7, 19)),
      to: startOfDay(new Date(2026, 7, 22))
    })
    expect(store.forDay(new Date(2026, 7, 20))).toHaveLength(1)
    store.update('m', {
      start: '2026-08-21T09:00:00',
      end: '2026-08-21T10:00:00'
    })
    store.prepareRangeSync({
      from: startOfDay(new Date(2026, 7, 19)),
      to: startOfDay(new Date(2026, 7, 22))
    })
    expect(store.forDay(new Date(2026, 7, 20))).toHaveLength(0)
    expect(store.forDay(new Date(2026, 7, 21))).toHaveLength(1)
  })

  it('returns long events that start before the range (sorted-scan lower bound)', () => {
    const store = new EventStore()
    store.setEvents([
      // Starts 100 days before the window but overlaps it
      { id: 'long', title: 'Long', start: '2026-01-01', end: '2026-12-31', allDay: true },
      { id: 'short', title: 'Short', start: '2026-08-20T09:00:00', end: '2026-08-20T10:00:00' },
      // Entirely before the window
      { id: 'past', title: 'Past', start: '2025-01-01', end: '2025-01-02', allDay: true }
    ])
    const out = store.prepareRangeSync({
      from: startOfDay(new Date(2026, 7, 15)),
      to: startOfDay(new Date(2026, 7, 25))
    })
    const ids = out.map((e) => String(e.id)).sort()
    expect(ids).toEqual(['long', 'short'])
  })

  it('reuses the prepared slice for a narrower range but rescans a wider one', () => {
    const store = new EventStore()
    store.setEvents([
      { id: 'a', title: 'A', start: '2026-08-20T09:00:00', end: '2026-08-20T10:00:00' },
      { id: 'b', title: 'B', start: '2026-10-05T09:00:00', end: '2026-10-05T10:00:00' }
    ])
    const wide = store.prepareRangeSync({
      from: startOfDay(new Date(2026, 7, 1)),
      to: startOfDay(new Date(2026, 7, 31))
    })
    expect(wide.map((e) => String(e.id))).toEqual(['a'])

    // Narrower request inside the prepared window reuses the same slice
    const narrow = store.prepareRangeSync({
      from: startOfDay(new Date(2026, 7, 10)),
      to: startOfDay(new Date(2026, 7, 25))
    })
    expect(narrow).toBe(wide)

    // Wider request must rescan and pick up the October event
    const wider = store.prepareRangeSync({
      from: startOfDay(new Date(2026, 7, 1)),
      to: startOfDay(new Date(2026, 10, 30))
    })
    expect(wider).not.toBe(wide)
    expect(wider.map((e) => String(e.id)).sort()).toEqual(['a', 'b'])
  })

  it('invalidates the prepared slice on add, update and remove', () => {
    const store = new EventStore()
    const range = {
      from: startOfDay(new Date(2026, 7, 1)),
      to: startOfDay(new Date(2026, 7, 31))
    }
    store.setEvents([
      { id: 'a', title: 'A', start: '2026-08-20T09:00:00', end: '2026-08-20T10:00:00' }
    ])
    expect(store.prepareRangeSync(range)).toHaveLength(1)

    store.add({ id: 'b', title: 'B', start: '2026-08-21T09:00:00', end: '2026-08-21T10:00:00' })
    expect(store.prepareRangeSync(range)).toHaveLength(2)

    // Move 'b' out of the window
    store.update('b', { start: '2026-12-01T09:00:00', end: '2026-12-01T10:00:00' })
    expect(store.prepareRangeSync(range)).toHaveLength(1)

    store.remove('a')
    expect(store.prepareRangeSync(range)).toHaveLength(0)
  })

  describe('duplicate id warnings', () => {
    let warn: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      resetDevWarnings()
      warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    })

    afterEach(() => {
      warn.mockRestore()
    })

    const dupCalls = (): string[] =>
      warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('duplicate event id'))

    it('does not warn when adding a unique id', () => {
      const store = new EventStore()
      store.setEvents([{ id: 'a', title: 'A', start: '2026-08-20', end: '2026-08-20' }])
      store.add({ id: 'b', title: 'B', start: '2026-08-21', end: '2026-08-21' })
      expect(dupCalls()).toEqual([])
      expect(store.getRaw()).toHaveLength(2)
    })

    it('warns when adding an id that already exists', () => {
      const store = new EventStore()
      store.setEvents([{ id: 'a', title: 'A', start: '2026-08-20', end: '2026-08-20' }])
      store.add({ id: 'a', title: 'A dup', start: '2026-08-21', end: '2026-08-21' })
      expect(dupCalls()).toHaveLength(1)
      expect(dupCalls()[0]).toContain('"a"')
    })

    it('warns for duplicate ids inside setEvents', () => {
      const store = new EventStore()
      store.setEvents([
        { id: 'a', title: 'A', start: '2026-08-20', end: '2026-08-20' },
        { id: 'a', title: 'A2', start: '2026-08-21', end: '2026-08-21' }
      ])
      expect(dupCalls()).toHaveLength(1)
    })

    it('does not warn when updating an added event', () => {
      const store = new EventStore()
      store.setEvents([{ id: 'a', title: 'A', start: '2026-08-20', end: '2026-08-20' }])
      store.add({ id: 'b', title: 'B', start: '2026-08-21', end: '2026-08-21' })
      store.update('b', { title: 'B2' })
      store.remove('a')
      expect(dupCalls()).toEqual([])
    })
  })

  it('remove clears byId', () => {
    const store = new EventStore()
    store.setEvents([{ id: 'z', title: 'Z', start: '2026-08-20', end: '2026-08-20' }])
    store.prepareRangeSync({
      from: startOfDay(new Date(2026, 7, 1)),
      to: startOfDay(new Date(2026, 7, 31))
    })
    expect(store.getById('z')).toBeTruthy()
    store.remove('z')
    store.prepareRangeSync({
      from: startOfDay(new Date(2026, 7, 1)),
      to: startOfDay(new Date(2026, 7, 31))
    })
    expect(store.getById('z')).toBeUndefined()
    expect(store.forDay(new Date(2026, 7, 20))).toHaveLength(0)
  })
})
