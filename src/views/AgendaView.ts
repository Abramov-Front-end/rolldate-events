/**
 * Agenda — compact native-scroll list of events grouped by date.
 * Days without events are skipped.
 */

import type { LayoutPatch, NormalizedEvent, View, ViewContext } from '../types'
import { addDays, dayKey, formatTime, parseDayKey, startOfDay } from '../utils/date'
import { escapeAttr, escapeHtml } from '../utils/dom'
import {
  agendaEventsForDay,
  agendaTopAnchorDayKey,
  agendaVisibleDayKeys,
  nearestOccupiedDayKey,
  occupiedDayKeys
} from '../utils/agendaLayout'
import { eventsFingerprint, indexEventsByDay } from '../utils/eventIndex'
import { dateToDayIndex } from '../utils/infiniteScroll'

export class AgendaView implements View {
  readonly name = 'agenda' as const
  private host: HTMLElement | null = null
  private viewportEl: HTMLElement | null = null
  private stripEl: HTMLElement | null = null
  private ctx: ViewContext | null = null
  private byDay = new Map<string, NormalizedEvent[]>()
  private occupied: string[] = []
  private eventsFp = ''
  private lastAnchorKey = ''
  private lastVisibleKeys = new Set<string>()
  private scrollRaf = 0

  render(ctx: ViewContext): void {
    this.destroy()
    this.ctx = ctx
    this.host = ctx.root
    this.indexEvents(ctx.events)
    this.eventsFp = eventsFingerprint(ctx.events)

    this.host.innerHTML = `
      <div class="rde-agenda rde-agenda--scroll">
        <div class="rde-viewport rde-agenda-viewport" data-viewport>
          <div class="rde-agenda-strip" data-strip></div>
        </div>
      </div>
    `

    this.viewportEl = this.host.querySelector('[data-viewport]') as HTMLElement
    this.stripEl = this.host.querySelector('[data-strip]')

    this.paintOccupied()
    this.emitRange()
    this.scrollToDayKey(this.targetOccupiedKey(ctx.cursor), 'auto')
    this.updateAnchorFromScroll()

    this.viewportEl.addEventListener('scroll', this.onScroll, { passive: true })
    this.host.addEventListener('click', this.onClick)
  }

  applyLayout(_patch: LayoutPatch): void {
    // Presentation follows .rde[data-compact] CSS — no remount required
  }

  syncEvents(events: NormalizedEvent[]): void {
    const fp = eventsFingerprint(events)
    if (fp === this.eventsFp) return
    this.eventsFp = fp
    const anchor = this.captureScrollAnchor()
    this.indexEvents(events)
    this.paintOccupied()
    this.emitRange()
    void this.stripEl?.offsetHeight
    if (anchor && this.stripEl?.querySelector(`[data-day="${anchor.dayKey}"]`)) {
      this.restoreScrollAnchor(anchor)
    } else {
      const key = this.targetOccupiedKey(this.ctx?.cursor ?? new Date())
      this.scrollToDayKey(key, 'auto')
    }
    this.updateAnchorFromScroll()
  }

  goToDate(date: Date): void {
    const key = this.targetOccupiedKey(date)
    this.scrollToDayKey(key, 'auto')
    if (key && this.ctx) {
      this.lastAnchorKey = key
      this.ctx.onAnchorChange(startOfDay(parseDayKey(key)))
    }
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
    this.occupied = occupiedDayKeys(this.byDay, (key) => this.isKeyAllowed(key))
  }

  private isKeyAllowed(key: string): boolean {
    if (!this.ctx) return true
    return !this.ctx.isDateDisabled(parseDayKey(key))
  }

  private targetOccupiedKey(date: Date): string | null {
    const clamped = this.calendarClampDate(date)
    return nearestOccupiedDayKey(this.occupied, dayKey(clamped))
  }

  private calendarClampDate(date: Date): Date {
    if (!this.ctx) return startOfDay(date)
    const day = startOfDay(date)
    const min = this.ctx.minDate
    const max = this.ctx.maxDate
    if (min && day < min) return min
    if (max && day > max) return max
    return day
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
    return [this.dateHeaderHtml(day, locale), this.eventsBodyHtml(dayEvents, locale)].join('')
  }

  private daySegHtml(key: string): string {
    if (!this.ctx) return ''
    const day = parseDayKey(key)
    const abs = dateToDayIndex(day)
    return [
      `<div class="rde-agenda-seg" data-day="${key}" data-day-index="${abs}">`,
      this.segInnerHtml(day, key, this.ctx.locale),
      '</div>'
    ].join('')
  }

  private emptyStateHtml(): string {
    if (!this.ctx) return ''
    const day = this.calendarClampDate(this.ctx.cursor)
    const key = dayKey(day)
    return [
      `<div class="rde-agenda-seg" data-day="${key}" data-day-index="${dateToDayIndex(day)}">`,
      this.dateHeaderHtml(day, this.ctx.locale),
      this.eventsBodyHtml([], this.ctx.locale),
      '</div>'
    ].join('')
  }

  private paintOccupied(): void {
    if (!this.stripEl) return
    this.stripEl.innerHTML = this.occupied.length
      ? this.occupied.map((key) => this.daySegHtml(key)).join('')
      : this.emptyStateHtml()
  }

  private scrollToDayKey(key: string | null, behavior: ScrollBehavior): void {
    if (!key || !this.viewportEl || !this.stripEl) return
    const seg = this.stripEl.querySelector<HTMLElement>(`[data-day="${key}"]`)
    if (!seg) return
    const vpRect = this.viewportEl.getBoundingClientRect()
    const segRect = seg.getBoundingClientRect()
    const top = this.viewportEl.scrollTop + (segRect.top - vpRect.top)
    if (typeof this.viewportEl.scrollTo === 'function') {
      this.viewportEl.scrollTo({ top, behavior })
    } else {
      this.viewportEl.scrollTop = top
    }
  }

  private onScroll = (): void => {
    if (this.scrollRaf) return
    this.scrollRaf = requestAnimationFrame(() => {
      this.scrollRaf = 0
      this.updateAnchorFromScroll()
    })
  }

  private applyAgendaHighlight(): void {
    if (!this.stripEl) return
    const active = this.lastVisibleKeys
    this.stripEl.querySelectorAll<HTMLElement>('.rde-agenda-seg[data-day]').forEach((seg) => {
      seg.classList.toggle('is-active', active.has(seg.dataset.day ?? ''))
    })
  }

  private segmentLayoutRects(): Array<{ dayKey: string; top: number; bottom: number }> {
    if (!this.stripEl) return []
    const segs = this.stripEl.querySelectorAll<HTMLElement>('.rde-agenda-seg[data-day]')
    return Array.from(segs)
      .map((seg) => {
        const r = seg.getBoundingClientRect()
        return {
          dayKey: seg.dataset.day ?? '',
          top: r.top,
          bottom: r.bottom
        }
      })
      .filter((seg) => seg.dayKey)
  }

  private captureScrollAnchor(): { dayKey: string; contentTop: number } | null {
    if (!this.viewportEl) return null
    const vpRect = this.viewportEl.getBoundingClientRect()
    const anchorKey = agendaTopAnchorDayKey(vpRect.top, this.segmentLayoutRects())
    if (!anchorKey) return null
    const seg = this.stripEl?.querySelector<HTMLElement>(`.rde-agenda-seg[data-day="${anchorKey}"]`)
    if (!seg) return null
    const segRect = seg.getBoundingClientRect()
    return {
      dayKey: anchorKey,
      contentTop: this.viewportEl.scrollTop + (segRect.top - vpRect.top)
    }
  }

  private restoreScrollAnchor(anchor: { dayKey: string; contentTop: number } | null): void {
    if (!anchor || !this.viewportEl || !this.stripEl) return
    const seg = this.stripEl.querySelector<HTMLElement>(`.rde-agenda-seg[data-day="${anchor.dayKey}"]`)
    if (!seg) return
    const vpRect = this.viewportEl.getBoundingClientRect()
    const segRect = seg.getBoundingClientRect()
    const currentTop = this.viewportEl.scrollTop + (segRect.top - vpRect.top)
    const delta = anchor.contentTop - currentTop
    if (Math.abs(delta) > 0.5) this.viewportEl.scrollTop += delta
  }

  private updateAnchorFromScroll(): void {
    if (!this.viewportEl || !this.ctx) return
    const vpRect = this.viewportEl.getBoundingClientRect()
    const rects = this.segmentLayoutRects()

    const titleKey = agendaTopAnchorDayKey(vpRect.top, rects)
    if (titleKey && titleKey !== this.lastAnchorKey) {
      this.lastAnchorKey = titleKey
      this.ctx.onAnchorChange(startOfDay(parseDayKey(titleKey)))
    }

    let visibleKeys = agendaVisibleDayKeys(vpRect.top, vpRect.bottom, rects)
    if (!visibleKeys.length && titleKey) visibleKeys = [titleKey]
    this.lastVisibleKeys = new Set(visibleKeys)
    this.applyAgendaHighlight()
  }

  private emitRange(): void {
    if (!this.ctx) return
    if (!this.occupied.length) {
      const day = this.calendarClampDate(this.ctx.cursor)
      this.ctx.onRangeChange({ from: day, to: addDays(day, 1) })
      return
    }
    const from = parseDayKey(this.occupied[0])
    const last = parseDayKey(this.occupied[this.occupied.length - 1])
    this.ctx.onRangeChange({ from, to: addDays(last, 1) })
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
      const date = parseDayKey(dayEl.dataset.day)
      if (this.ctx.isDateDisabled(date)) return
      this.ctx.onDateClick(date, e)
    }
  }
}
