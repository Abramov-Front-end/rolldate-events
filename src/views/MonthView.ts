/**
 * Month view — continuous week strip with translate3d scroll (RollDate-style).
 */

import type { LayoutPatch, NormalizedEvent, View, ViewContext } from '../types'
import {
  addDays,
  dayKey,
  formatTime,
  primaryMonthForWeek,
  sameDay,
  startOfMonth,
  weekDays
} from '../utils/date'
import { escapeAttr, escapeHtml } from '../utils/dom'
import {
  dateToWeekIndex,
  TranslateStrip,
  weekIndexToDate
} from '../utils/infiniteScroll'
import { monthCompactIndicators, monthWeekRowHeight, MONTH_WEEK_BUFFER } from '../utils/responsive'

const BUFFER = MONTH_WEEK_BUFFER

export class MonthView implements View {
  readonly name = 'month' as const
  private host: HTMLElement | null = null
  private monthEl: HTMLElement | null = null
  private stripEl: HTMLElement | null = null
  private ctx: ViewContext | null = null
  private scroller: TranslateStrip | null = null
  private byDay = new Map<string, NormalizedEvent[]>()
  private anchorMonth = -1
  private anchorYear = -1
  private eventsFp = ''

  render(ctx: ViewContext): void {
    this.destroy()
    this.ctx = ctx
    this.host = ctx.root
    this.indexEvents(ctx.events)
    this.eventsFp = this.fingerprint(ctx.events)
    this.anchorYear = ctx.cursor.getFullYear()
    this.anchorMonth = ctx.cursor.getMonth()

    const labels = weekDays(ctx.locale, ctx.firstDayOfWeek)
    this.host.innerHTML = `
      <div class="rde-month rde-month--infinite">
        <div class="rde-weekdays">${labels.map((l) => `<div class="rde-weekday">${escapeHtml(l)}</div>`).join('')}</div>
        <div class="rde-viewport" data-viewport>
          <div class="rde-strip" data-strip></div>
        </div>
      </div>
    `

    this.monthEl = this.host.querySelector('.rde-month')
    const viewport = this.host.querySelector('[data-viewport]') as HTMLElement
    this.stripEl = this.host.querySelector('[data-strip]')

    this.scroller = new TranslateStrip(
      viewport,
      this.stripEl!,
      {
        segmentSize: this.weekRowPx(),
        bufferSize: BUFFER,
        prefetchSegments: 2,
        minIndex: ctx.minWeekIndex,
        maxIndex: ctx.maxWeekIndex
      },
      {
        paint: (start, count) => this.paint(start, count),
        onSettle: (idx) => this.onSettle(idx),
        onRangeChange: (start, count) => this.emitRange(start, count),
        insertStart: (from, n) => this.insertRows(from, n, 'start'),
        insertEnd: (from, n) => this.insertRows(from, n, 'end'),
        removeStart: (n) => this.removeRows(n, 'start'),
        removeEnd: (n) => this.removeRows(n, 'end')
      }
    )

    const targetWeek = this.monthAnchorWeekIndex()
    this.scroller.reset(targetWeek, { align: 'start' })
    this.scroller.start()
    this.applyMonthHighlight()
    requestAnimationFrame(() => {
      requestAnimationFrame(() => this.syncWeekRowSegmentSize(true))
    })
    this.host.addEventListener('click', this.onClick)
  }

  applyLayout(patch: LayoutPatch): void {
    if (!this.ctx || !this.scroller || !this.stripEl) return
    const prevCompact = this.ctx.compact
    this.ctx = { ...this.ctx, compact: patch.compact, layoutWidth: patch.layoutWidth }
    const newPx = this.weekRowPx()
    const oldPx = this.scroller.state.segmentSize
    if (Math.abs(newPx - oldPx) >= 1) {
      this.scroller.setSegmentSize(newPx)
      this.stripEl.querySelectorAll<HTMLElement>('.rde-week-row').forEach((row) => {
        row.style.height = `${newPx}px`
      })
    }
    requestAnimationFrame(() => this.syncWeekRowSegmentSize(false))
    if (prevCompact !== patch.compact) {
      this.refreshDayEvents()
    }
  }

  syncEvents(events: NormalizedEvent[]): void {
    this.indexEvents(events)
    const fp = this.fingerprint(events)
    if (fp === this.eventsFp) return
    this.eventsFp = fp
    this.refreshDayEvents()
  }

  goToDate(date: Date, opts?: { animate?: boolean }): void {
    if (!this.scroller || !this.ctx) return
    const fdow = this.ctx.firstDayOfWeek
    const monthStart = startOfMonth(date)
    const target = dateToWeekIndex(monthStart, fdow)

    this.anchorYear = monthStart.getFullYear()
    this.anchorMonth = monthStart.getMonth()

    const from = weekIndexToDate(target - 4, fdow)
    const to = addDays(weekIndexToDate(target + 8, fdow), 6)
    this.ctx.onRangeChange({ from, to })

    this.scroller.scrollToIndex(target, { animate: opts?.animate === true, align: 'start' })
    this.applyMonthHighlight()
  }

  destroy(): void {
    this.scroller?.stop()
    this.scroller = null
    this.host?.removeEventListener('click', this.onClick)
    if (this.host) this.host.innerHTML = ''
    this.host = null
    this.monthEl = null
    this.stripEl = null
    this.ctx = null
  }

  private weekRowPx(): number {
    const compact = this.ctx?.compact === true
    const vp = this.monthEl?.querySelector('[data-viewport]') as HTMLElement | null
    const vpW = vp?.clientWidth ?? 0
    const w = vpW > 0 ? vpW : (this.ctx?.layoutWidth ?? 0)
    return monthWeekRowHeight(compact, w)
  }

  private monthAnchorWeekIndex(): number {
    if (!this.ctx) return 0
    return dateToWeekIndex(startOfMonth(this.ctx.cursor), this.ctx.firstDayOfWeek)
  }

  /** Keep translate3d segment size aligned with painted week-row height */
  private syncWeekRowSegmentSize(realignToMonth = false): void {
    if (!this.scroller || !this.stripEl) return
    const row = this.stripEl.querySelector<HTMLElement>('.rde-week-row')
    if (!row) return
    const measured = Math.round(row.getBoundingClientRect().height)
    const target = this.weekRowPx()
    const size = measured > 0 ? measured : target
    if (size <= 0) return
    this.stripEl.querySelectorAll<HTMLElement>('.rde-week-row').forEach((el) => {
      el.style.height = `${size}px`
    })
    const sizeChanged = Math.abs(size - this.scroller.state.segmentSize) >= 1
    if (sizeChanged) {
      this.scroller.setSegmentSize(size)
    }
    if (realignToMonth) {
      this.scroller.scrollToIndex(this.monthAnchorWeekIndex(), { align: 'start' })
      this.applyMonthHighlight()
    }
    this.scroller.refreshBuffer()
  }

  private fingerprint(events: NormalizedEvent[]): string {
    if (!events.length) return '0'
    const a = events[0]
    const b = events[events.length - 1]
    const m = events[events.length >> 1]
    return `${events.length}:${String(a.id)}:${String(m.id)}:${String(b.id)}:${a.start.getTime()}:${b.end.getTime()}`
  }

  private indexEvents(events: NormalizedEvent[]): void {
    this.byDay = new Map()
    for (const ev of events) {
      let c = new Date(ev.start.getFullYear(), ev.start.getMonth(), ev.start.getDate())
      const last = new Date(ev.end.getFullYear(), ev.end.getMonth(), ev.end.getDate())
      let g = 0
      while (c <= last && g < 60) {
        const k = dayKey(c)
        const list = this.byDay.get(k) || []
        list.push(ev)
        this.byDay.set(k, list)
        c = addDays(c, 1)
        g++
      }
    }
    for (const list of this.byDay.values()) {
      list.sort((a, b) => a.start.getTime() - b.start.getTime())
    }
  }

  private dayEventsHtml(key: string): string {
    if (this.ctx?.compact) return this.dayCompactHtml(key)
    return this.dayChipsHtml(key)
  }

  private dayCompactHtml(key: string): string {
    if (!this.ctx) return ''
    const dayEvents = this.byDay.get(key) || []
    const { dots, more } = monthCompactIndicators(dayEvents.length)
    const shown = dayEvents.slice(0, dots)
    const dotHtml = shown
      .map((ev) => {
        const color = ev.color || 'var(--rde-event-default)'
        const id = String(ev.occurrenceId || ev.id)
        return `<button type="button" class="rde-event-dot" data-event-id="${escapeAttr(id)}" style="--rde-event-color:${escapeAttr(color)}" aria-label="${escapeAttr(ev.title)}" title="${escapeAttr(ev.title)}"></button>`
      })
      .join('')
    const moreHtml = more > 0 ? `<span class="rde-more-compact">+${more}</span>` : ''
    return `<div class="rde-day__compact-events" aria-hidden="false">${dotHtml}${moreHtml}</div>`
  }

  private dayChipsHtml(key: string): string {
    if (!this.ctx) return ''
    const limit = this.ctx.eventLimit
    const locale = this.ctx.locale
    const dayEvents = this.byDay.get(key) || []
    const shown = dayEvents.slice(0, limit)
    const more = dayEvents.length - shown.length
    const chips = shown
      .map((ev) => {
        const color = ev.color || 'var(--rde-event-default)'
        const id = String(ev.occurrenceId || ev.id)
        const time = ev.allDay
          ? ''
          : `<span class="rde-event__time">${escapeHtml(formatTime(ev.start, locale))}</span>`
        return `<button type="button" class="rde-event" data-event-id="${escapeAttr(id)}" style="--rde-event-color:${escapeAttr(color)}" title="${escapeAttr(ev.title)}">${time}<span class="rde-event__title">${escapeHtml(ev.title)}</span></button>`
      })
      .join('')
    const moreHtml =
      more > 0 ? `<button type="button" class="rde-more" data-day="${key}">+${more} more</button>` : ''
    return chips + moreHtml
  }

  private refreshDayEvents(): void {
    if (!this.stripEl) return
    this.stripEl.querySelectorAll<HTMLElement>('.rde-day[data-day]').forEach((dayEl) => {
      const key = dayEl.dataset.day
      if (!key) return
      const box = dayEl.querySelector('.rde-day__events')
      if (box) box.innerHTML = this.dayEventsHtml(key)
    })
  }

  private fillEmptyDayEvents(): void {
    if (!this.stripEl) return
    this.stripEl.querySelectorAll<HTMLElement>('.rde-day[data-day]').forEach((dayEl) => {
      const key = dayEl.dataset.day
      if (!key) return
      const box = dayEl.querySelector('.rde-day__events')
      if (!box || box.childElementCount > 0) return
      box.innerHTML = this.dayEventsHtml(key)
    })
  }

  private weekRowHtml(abs: number): string {
    if (!this.ctx) return ''
    const today = new Date()
    const activeY = this.anchorYear
    const activeM = this.anchorMonth
    const weekStart = weekIndexToDate(abs, this.ctx.firstDayOfWeek)
    const rowH = this.weekRowPx()
    const parts: string[] = [
      `<div class="rde-week-row" data-week="${abs}" style="height:${rowH}px">`
    ]
    for (let d = 0; d < 7; d++) {
      const cell = addDays(weekStart, d)
      const key = dayKey(cell)
      const inActive =
        activeY >= 0 && cell.getFullYear() === activeY && cell.getMonth() === activeM
      const isToday = sameDay(cell, today)
      parts.push(
        `<div class="rde-day${inActive ? ' rde-day--active-month' : ' rde-day--muted-month'}${isToday ? ' rde-day--today' : ''}${this.ctx?.isDateDisabled(cell) ? ' rde-day--disabled' : ''}" data-day="${key}"><div class="rde-day__num">${cell.getDate()}</div><div class="rde-day__events">${this.dayEventsHtml(key)}</div></div>`
      )
    }
    parts.push('</div>')
    return parts.join('')
  }

  private paint(startIndex: number, count: number): void {
    if (!this.stripEl || !this.ctx) return
    const parts: string[] = []
    for (let i = 0; i < count; i++) parts.push(this.weekRowHtml(startIndex + i))
    this.stripEl.innerHTML = parts.join('')
  }

  private insertRows(fromAbs: number, n: number, side: 'start' | 'end'): void {
    if (!this.stripEl || n <= 0) return
    const html = Array.from({ length: n }, (_, i) => this.weekRowHtml(fromAbs + i)).join('')
    if (side === 'start') this.stripEl.insertAdjacentHTML('afterbegin', html)
    else this.stripEl.insertAdjacentHTML('beforeend', html)
  }

  private removeRows(n: number, side: 'start' | 'end'): void {
    if (!this.stripEl || n <= 0) return
    for (let i = 0; i < n; i++) {
      const child =
        side === 'start' ? this.stripEl.firstElementChild : this.stripEl.lastElementChild
      child?.remove()
    }
  }

  private applyMonthHighlight(): void {
    if (!this.stripEl || this.anchorYear < 0) return
    const y = this.anchorYear
    const m = this.anchorMonth
    this.stripEl.querySelectorAll<HTMLElement>('.rde-day[data-day]').forEach((el) => {
      const key = el.dataset.day
      if (!key) return
      const [yy, mm] = key.split('-').map(Number)
      const inActive = yy === y && mm - 1 === m
      el.classList.toggle('rde-day--active-month', inActive)
      el.classList.toggle('rde-day--muted-month', !inActive)
    })
  }

  private onSettle(abs: number): void {
    if (!this.scroller || !this.ctx) return
    const fdow = this.ctx.firstDayOfWeek
    const weekStart = weekIndexToDate(abs, fdow)
    const monthStart = primaryMonthForWeek(weekStart)
    const y = monthStart.getFullYear()
    const m = monthStart.getMonth()
    if (y === this.anchorYear && m === this.anchorMonth) return

    this.anchorYear = y
    this.anchorMonth = m
    this.ctx.onAnchorChange(monthStart)
    this.applyMonthHighlight()
  }

  private emitRange(startIndex: number, count: number): void {
    if (!this.ctx) return
    const from = weekIndexToDate(startIndex, this.ctx.firstDayOfWeek)
    const to = addDays(weekIndexToDate(startIndex + count - 1, this.ctx.firstDayOfWeek), 6)
    this.ctx.onRangeChange({ from, to })
  }

  private onClick = (e: MouseEvent): void => {
    if (!this.ctx) return
    const t = e.target as HTMLElement
    const eventBtn = t.closest<HTMLElement>('[data-event-id]')
    if (eventBtn?.dataset.eventId) {
      const ev = this.ctx.getEvent(eventBtn.dataset.eventId)
      if (ev) {
        e.stopPropagation()
        this.ctx.onEventClick(ev, e)
      }
      return
    }
    const moreBtn = t.closest<HTMLElement>('.rde-more')
    if (moreBtn?.dataset.day) {
      const [y, m, d] = moreBtn.dataset.day.split('-').map(Number)
      const date = new Date(y, m - 1, d)
      if (this.ctx.isDateDisabled(date)) return
      this.ctx.onDateClick(date, e)
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
