/**
 * In-memory event index optimized for day lookups (10k+ events).
 * Events are normalized once on set/add — prepareRange only filters.
 */

import type { Event, NormalizedEvent, VisibleRange } from '../types'
import { addDays, dayKey, endOfDay, startOfDay, toDate } from '../utils/date'
import { normalizeEvent } from '../utils/validate'
import { devWarn } from '../utils/devWarn'

declare const __PRO__: boolean

export function normalizeEventLegacy(event: Event): NormalizedEvent {
  return normalizeEvent(event)
}

export class EventStore {
  private raw: Event[] = []
  private cached: NormalizedEvent[] = []
  private byDay = new Map<string, NormalizedEvent[]>()
  private byId = new Map<string, NormalizedEvent>()

  setEvents(events: Event[]): void {
    this.raw = events.slice()
    this.rebuildCache()
  }

  getRaw(): Event[] {
    return this.raw.slice()
  }

  add(event: Event): void {
    const seen = this.idSet()
    this.raw.push(event)
    const norm = this.toCached(normalizeEvent(event, seen))
    this.cached.push(norm)
    this.byId.set(String(norm.id), norm)
  }

  update(id: string | number, patch: Partial<Omit<Event, 'id'>>): boolean {
    const sid = String(id)
    const idx = this.raw.findIndex((e) => String(e.id) === sid)
    if (idx === -1) return false
    const merged = { ...this.raw[idx], ...patch, id: this.raw[idx].id }
    this.raw[idx] = merged
    this.rebuildCache()
    return true
  }

  remove(id: string | number): boolean {
    const before = this.raw.length
    this.raw = this.raw.filter((e) => String(e.id) !== String(id))
    if (this.raw.length === before) return false
    this.rebuildCache()
    return true
  }

  private idSet(): Set<string> {
    return new Set(this.raw.map((e) => String(e.id)))
  }

  private toCached(base: NormalizedEvent): NormalizedEvent {
    if (!base.recurring) return base
    const { recurring: _r, ...single } = base
    return single
  }

  private rebuildCache(): void {
    const seen = new Set<string>()
    let warnedRecurring = false
    this.cached = this.raw.map((e) => {
      if (e.recurring && !__PRO__ && !warnedRecurring) {
        warnedRecurring = true
        devWarn(
          'recurring-lite',
          '[RollDateEvents Lite] recurring events require RollDate Events Pro. Rendering the base occurrence only.'
        )
      }
      return this.toCached(normalizeEvent(e, seen))
    })
    this.byId.clear()
    for (const ev of this.cached) {
      this.byId.set(String(ev.id), ev)
    }
  }

  async prepareRange(range: VisibleRange, expandRecurring: boolean): Promise<NormalizedEvent[]> {
    this.byDay.clear()
    const out: NormalizedEvent[] = []
    const from = range.from.getTime()
    const to = range.to.getTime()

    for (let i = 0; i < this.raw.length; i++) {
      const raw = this.raw[i]
      const base = normalizeEvent(raw)

      if (base.recurring && expandRecurring && __PRO__) {
        const { expandRecurring: expand } = await import('../pro/recurrence')
        const occurrences = expand(base, range.from, range.to)
        for (const oc of occurrences) this.index(oc, out)
        continue
      }

      const ev = this.cached[i] || this.toCached(base)
      if (ev.end.getTime() < from || ev.start.getTime() > to) continue
      this.index(ev, out)
    }

    return out
  }

  prepareRangeSync(range: VisibleRange): NormalizedEvent[] {
    this.byDay.clear()
    const out: NormalizedEvent[] = []
    const from = range.from.getTime()
    const to = range.to.getTime()
    for (const ev of this.cached) {
      if (ev.end.getTime() < from || ev.start.getTime() > to) continue
      this.index(ev, out)
    }
    return out
  }

  getById(id: string): NormalizedEvent | undefined {
    return this.byId.get(id)
  }

  forDay(day: Date): NormalizedEvent[] {
    return this.byDay.get(dayKey(day)) || []
  }

  private index(event: NormalizedEvent, bag: NormalizedEvent[]): void {
    const id = String(event.occurrenceId || event.id)
    this.byId.set(id, event)
    bag.push(event)

    let cursor = startOfDay(event.start)
    const last = startOfDay(event.end)
    let guard = 0
    while (cursor <= last && guard < 370) {
      const k = dayKey(cursor)
      const list = this.byDay.get(k) || []
      list.push(event)
      this.byDay.set(k, list)
      cursor = addDays(cursor, 1)
      guard++
    }
  }
}

export { endOfDay, startOfDay }
