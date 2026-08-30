/**
 * Agenda — native scroll, variable-height day blocks, full event list.
 */

import type { LayoutPatch, NormalizedEvent, View, ViewContext } from '../types'
import { addDays, dayKey, formatTime, startOfDay } from '../utils/date'
import { escapeAttr, escapeHtml } from '../utils/dom'
import { agendaEventsForDay, agendaDominantDayKey } from '../utils/agendaLayout'
import { indexEventsByDay } from '../utils/eventIndex'
import { dateToDayIndex, dayIndexToDate } from '../utils/infiniteScroll'

const INITIAL_BEFORE = 14
const INITIAL_AFTER = 21
const EXTEND_DAYS = 14
const EDGE_PX = 320

export class AgendaView implements View {
  readonly name = 'agenda' as const
  private host: HTMLElement | null = null
  private viewportEl: HTMLElement | null = null
  private stripEl: HTMLElement | null = null
  private ctx: ViewContext | null = null
  private byDay = new Map<string, NormalizedEvent[]>()
  private lastAnchorKey = ''
  private mountedStart = 0
  private mountedEnd = 0
  private scrollRaf = 0
  private extending = false

  render(ctx: ViewContext): void {
    this.destroy()
    this.ctx = ctx
    this.host = ctx.root
    this.indexEvents(ctx.events)

    this.host.innerHTML = `
      <div class="rde-agenda rde-agenda--scroll">
        <div class="rde-viewport rde-agenda-viewport" data-viewport>
          <div class="rde-agenda-strip" data-strip></div>
        </div>
      </div>
    `

    this.viewportEl = this.host.querySelector('[data-viewport]') as HTMLElement
    this.stripEl = this.host.querySelector('[data-strip]')

    const center = dateToDayIndex(ctx.cursor)
    this.mountRange(center - INITIAL_BEFORE, center + INITIAL_AFTER)
    this.emitRange()
    this.scrollToDayIndex(center, 'auto')
    this.updateAnchorFromScroll()

    this.viewportEl.addEventListener('scroll', this.onScroll, { passive: true })
    this.host.addEventListener('click', this.onClick)
  }

  applyLayout(_patch: LayoutPatch): void {
    // Presentation follows .rde[data-compact] CSS — no remount required
  }

  syncEvents(events: NormalizedEvent[]): void {
    this.indexEvents(events)
    this.refreshMountedSegments()
  }

  goToDate(date: Date): void {
    const idx = dateToDayIndex(date)
    if (idx < this.mountedStart || idx > this.mountedEnd) {
      this.mountRange(idx - INITIAL_BEFORE, idx + INITIAL_AFTER)
      this.emitRange()
    }
    this.scrollToDayIndex(idx, 'auto')
    this.updateAnchorFromScroll()
  }

  destroy(): void {
    if (this.scrollRaf) cancelAnimationFrame(this.scrollRaf)
    this.viewportEl?.removeEventListener('scroll', this.onScroll)
    this.host?.removeEventListener('click', this.onClick)
    if (this.host) this.host.innerHTML = ''
    this.host = null
    this.viewportEl = null
    this.stripEl = null
    this.ctx = null
  }

  private indexEvents(events: NormalizedEvent[]): void {
    this.byDay = indexEventsByDay(events)
  }

  private clampIndex(index: number): number {
    if (!this.ctx) return index
    const min = this.ctx.minDayIndex
    const max = this.ctx.maxDayIndex
    if (min != null && index < min) return min
    if (max != null && index > max) return max
    return index
  }

  private dateHeaderHtml(day: Date, locale: string): string {
    const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(day)
    const ymd = new Intl.DateTimeFormat(locale, {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    }).format(day)
    return `<div class="rde-agenda__day-col"><div class="rde-agenda__date" role="heading" aria-level="3"><span class="rde-agenda__weekday">${escapeHtml(weekday)}</span><span class="rde-agenda__date-sep">, </span><span class="rde-agenda__ymd">${escapeHtml(ymd)}</span></div></div>`
  }

  private eventRowHtml(ev: NormalizedEvent, locale: string): string {
    const id = String(ev.occurrenceId || ev.id)
    const color = ev.color || 'var(--rde-event-default)'
    const allDay = ev.allDay === true
    const time = allDay ? 'All day' : formatTime(ev.start, locale)
    const timeClass = allDay ? ' rde-agenda__time--allday' : ''
    const loc = ev.location
      ? `<span class="rde-agenda__loc">${escapeHtml(ev.location)}</span>`
      : ''
    return `<button type="button" class="rde-agenda__item" data-event-id="${escapeAttr(id)}" style="--rde-event-color:${escapeAttr(color)}" title="${escapeAttr(ev.title)}"><span class="rde-agenda__time${timeClass}">${escapeHtml(time)}</span><span class="rde-agenda__title">${escapeHtml(ev.title)}</span>${loc}</button>`
  }

  private eventsBodyHtml(dayEvents: NormalizedEvent[], locale: string): string {
    if (!dayEvents.length) {
      return '<div class="rde-agenda__list"><div class="rde-agenda__empty">No events</div></div>'
    }
    const parts: string[] = ['<div class="rde-agenda__list">']
    for (const ev of dayEvents) parts.push(this.eventRowHtml(ev, locale))
    parts.push('</div>')
    return parts.join('')
  }

  private segInnerHtml(day: Date, key: string, locale: string): string {
    const dayEvents = agendaEventsForDay(this.byDay, key)
    return [
      this.dateHeaderHtml(day, locale),
      this.eventsBodyHtml(dayEvents, locale)
    ].join('')
  }

  private daySegHtml(abs: number): string {
    if (!this.ctx) return ''
    const locale = this.ctx.locale
    const day = dayIndexToDate(abs)
    const key = dayKey(day)
    return [
      `<div class="rde-agenda-seg" data-day="${key}" data-day-index="${abs}">`,
      this.segInnerHtml(day, key, locale),
      '</div>'
    ].join('')
  }

  private mountRange(start: number, end: number): void {
    if (!this.stripEl || !this.ctx) return
    start = this.clampIndex(start)
    end = this.clampIndex(end)
    if (end < start) end = start
    const parts: string[] = []
    for (let i = start; i <= end; i++) parts.push(this.daySegHtml(i))
    this.stripEl.innerHTML = parts.join('')
    this.mountedStart = start
    this.mountedEnd = end
  }

  private prependDays(from: number, to: number): void {
    if (!this.stripEl || to < from) return
    const html = Array.from({ length: to - from + 1 }, (_, i) => this.daySegHtml(from + i)).join('')
    const vp = this.viewportEl
    const prevHeight = this.stripEl.scrollHeight
    this.stripEl.insertAdjacentHTML('afterbegin', html)
    this.mountedStart = from
    if (vp) vp.scrollTop += this.stripEl.scrollHeight - prevHeight
  }

  private appendDays(from: number, to: number): void {
    if (!this.stripEl || to < from) return
    const html = Array.from({ length: to - from + 1 }, (_, i) => this.daySegHtml(from + i)).join('')
    this.stripEl.insertAdjacentHTML('beforeend', html)
    this.mountedEnd = to
  }

  private trimStart(n: number): void {
    if (!this.stripEl || !this.viewportEl || n <= 0) return
    for (let i = 0; i < n; i++) {
      const first = this.stripEl.firstElementChild as HTMLElement | null
      if (!first) break
      this.viewportEl.scrollTop -= first.offsetHeight
      first.remove()
    }
    this.mountedStart += n
  }

  private trimEnd(n: number): void {
    if (!this.stripEl || n <= 0) return
    for (let i = 0; i < n; i++) this.stripEl.lastElementChild?.remove()
    this.mountedEnd -= n
  }

  private refreshMountedSegments(): void {
    if (!this.stripEl || !this.ctx) return
    const locale = this.ctx.locale
    this.stripEl.querySelectorAll<HTMLElement>('.rde-agenda-seg[data-day]').forEach((seg) => {
      const key = seg.dataset.day
      const abs = seg.dataset.dayIndex
      if (!key || abs == null) return
      const day = dayIndexToDate(Number(abs))
      seg.innerHTML = this.segInnerHtml(day, key, locale)
    })
  }

  private scrollToDayIndex(index: number, behavior: ScrollBehavior): void {
    if (!this.viewportEl || !this.stripEl) return
    const seg = this.stripEl.querySelector<HTMLElement>(`[data-day-index="${index}"]`)
    if (!seg) return
    this.viewportEl.scrollTo({ top: seg.offsetTop, behavior })
  }

  private onScroll = (): void => {
    if (this.scrollRaf) return
    this.scrollRaf = requestAnimationFrame(() => {
      this.scrollRaf = 0
      this.maybeExtend()
      this.updateAnchorFromScroll()
    })
  }

  private maybeExtend(): void {
    if (!this.viewportEl || !this.ctx || this.extending) return
    const { scrollTop, clientHeight, scrollHeight } = this.viewportEl
    const min = this.ctx.minDayIndex
    const max = this.ctx.maxDayIndex

    if (scrollTop < EDGE_PX && this.mountedStart > (min ?? -Infinity)) {
      this.extending = true
      const newStart = this.clampIndex(this.mountedStart - EXTEND_DAYS)
      if (newStart < this.mountedStart) {
        this.prependDays(newStart, this.mountedStart - 1)
        this.emitRange()
        if (this.mountedEnd - this.mountedStart > 60) this.trimEnd(EXTEND_DAYS)
      }
      this.extending = false
    }

    if (
      scrollTop + clientHeight > scrollHeight - EDGE_PX &&
      this.mountedEnd < (max ?? Infinity)
    ) {
      this.extending = true
      const newEnd = this.clampIndex(this.mountedEnd + EXTEND_DAYS)
      if (newEnd > this.mountedEnd) {
        this.appendDays(this.mountedEnd + 1, newEnd)
        this.emitRange()
        if (this.mountedEnd - this.mountedStart > 60) this.trimStart(EXTEND_DAYS)
      }
      this.extending = false
    }
  }

  private applyAgendaHighlight(): void {
    if (!this.stripEl || !this.lastAnchorKey) return
    const key = this.lastAnchorKey
    this.stripEl.querySelectorAll<HTMLElement>('.rde-agenda-seg[data-day]').forEach((seg) => {
      seg.classList.toggle('is-active', seg.dataset.day === key)
    })
  }

  private updateAnchorFromScroll(): void {
    if (!this.viewportEl || !this.ctx) return
    const { scrollTop, clientHeight } = this.viewportEl
    const segs = this.stripEl?.querySelectorAll<HTMLElement>('.rde-agenda-seg') ?? []
    const rects = Array.from(segs).map((seg) => ({
      dayKey: seg.dataset.day ?? '',
      offsetTop: seg.offsetTop,
      height: seg.offsetHeight
    }))
    const anchorKey = agendaDominantDayKey(scrollTop, clientHeight, rects)
    if (anchorKey && anchorKey !== this.lastAnchorKey) {
      this.lastAnchorKey = anchorKey
      const [y, m, d] = anchorKey.split('-').map(Number)
      this.ctx.onAnchorChange(startOfDay(new Date(y, m - 1, d)))
    }
    this.applyAgendaHighlight()
  }

  private emitRange(): void {
    if (!this.ctx) return
    const from = dayIndexToDate(this.mountedStart)
    const to = addDays(dayIndexToDate(this.mountedEnd), 1)
    this.ctx.onRangeChange({ from, to })
  }

  private onClick = (e: MouseEvent): void => {
    if (!this.ctx) return
    const t = e.target as HTMLElement
    const eventBtn = t.closest<HTMLElement>('[data-event-id]')
    if (eventBtn?.dataset.eventId) {
      const ev = this.ctx.getEvent(eventBtn.dataset.eventId)
      if (ev) this.ctx.onEventClick(ev, e)
      return
    }
    const dayEl = t.closest<HTMLElement>('[data-day]')
    if (dayEl?.dataset.day) {
      const [y, m, d] = dayEl.dataset.day.split('-').map(Number)
      const date = new Date(y, m - 1, d)
      if (this.ctx.isDateDisabled(date)) return
      this.ctx.onDateClick(date, e)
    }
  }
}
