import { describe, expect, it } from 'vitest'
import { EventStore } from '../src/store/EventStore'
import type { Event } from '../src/types'
import { startOfDay } from '../src/utils/date'

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
})
