/**
 * In-memory event index optimized for day lookups (10k+ events).
 * Events are normalized once on set/add — prepareRange only filters.
 */

import type { Event, NormalizedEvent, VisibleRange } from '../types'
import { addDays, dayKey, endOfDay, startOfDay, toDate } from '../utils/date'
import { indexEventsByDay } from '../utils/eventIndex'
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

  /** Bumped by every mutation — invalidates all derived structures below */
  private version = 0

  /** `cached` references sorted by start time; rebuilt lazily */
  private sorted: NormalizedEvent[] = []
  private sortedVersion = -1
  /** Longest event duration — lower bound for the sorted range scan */
  private maxSpanMs = 0

  /** Last prepared slice, memoized while the request stays inside it */
  private memoResult: NormalizedEvent[] = []
  private memoFrom = 0
  private memoTo = -1
  private memoVersion = -1

  /** byDay is only needed by forDay() — build it on demand */
  private dayIndexStale = true

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
    this.invalidate()
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

  /** Drop memo / sorted / day index without touching normalized events */
  private invalidate(): void {
    this.version++
    this.memoVersion = -1
    this.dayIndexStale = true
  }

  private rebuildCache(): void {
    const seen = new Set<string>()
    let warnedRecurring = false
    this.cached = this.raw.map((e) => {
      if (e.recurring && !__PRO__ && !warnedRecurring) {
        warnedRecurring = true
        devWarn(
          'recurring-lite',
          '[RollDateEvents] recurring events are not expanded in v1. Rendering the base occurrence only.'
        )
      }
      return this.toCached(normalizeEvent(e, seen))
    })
    this.byId.clear()
    for (const ev of this.cached) {
      this.byId.set(String(ev.id), ev)
    }
    this.invalidate()
  }

  /** Sort `cached` references by start once per mutation */
  private ensureSorted(): void {
    if (this.sortedVersion === this.version) return
    this.sorted = this.cached
      .slice()
      .sort((a, b) => a.start.getTime() - b.start.getTime())
    let span = 0
    for (const ev of this.sorted) {
      const d = ev.end.getTime() - ev.start.getTime()
      if (d > span) span = d
    }
    this.maxSpanMs = span
    this.sortedVersion = this.version
  }

  /** First index in `sorted` whose start is >= ms */
  private lowerBound(ms: number): number {
    let lo = 0
    let hi = this.sorted.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (this.sorted[mid].start.getTime() < ms) lo = mid + 1
      else hi = mid
    }
    return lo
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

    this.dayIndexStale = false
    return out
  }

  /**
   * Events overlapping [from, to].
   *
   * Uses a start-sorted view plus the longest known duration as a lower bound,
   * so cost scales with the number of visible events rather than the whole
   * collection. Repeated requests inside the last prepared window reuse it —
   * continuous scrolling asks for near-identical ranges every frame.
   */
  prepareRangeSync(range: VisibleRange): NormalizedEvent[] {
    const from = range.from.getTime()
    const to = range.to.getTime()

    if (this.memoVersion === this.version && from >= this.memoFrom && to <= this.memoTo) {
      return this.memoResult
    }

    this.ensureSorted()
    const out: NormalizedEvent[] = []
    for (let i = this.lowerBound(from - this.maxSpanMs); i < this.sorted.length; i++) {
      const ev = this.sorted[i]
      if (ev.start.getTime() > to) break
      if (ev.end.getTime() < from) continue
      out.push(ev)
    }

    this.memoResult = out
    this.memoFrom = from
    this.memoTo = to
    this.memoVersion = this.version
    this.dayIndexStale = true
    return out
  }

  getById(id: string): NormalizedEvent | undefined {
    return this.byId.get(id)
  }

  forDay(day: Date): NormalizedEvent[] {
    if (this.dayIndexStale) {
      this.byDay = indexEventsByDay(this.memoResult)
      this.dayIndexStale = false
    }
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
