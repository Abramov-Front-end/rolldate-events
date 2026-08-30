/**
 * RollDateEvents — orchestrator. Delegates rendering to the active View.
 */

declare const __PRO__: boolean

import type {
  CalendarViewName,
  Event,
  NormalizedEvent,
  RollDateEventsOptions,
  View,
  ViewContext,
  VisibleRange
} from './types'
import { isProBuild } from './features'
import { EventStore } from './store/EventStore'
import {
  addDays,
  addMonths,
  clampDate,
  clampHour,
  isDayInRange,
  monthTitle,
  startOfDay,
  startOfMonth,
  startOfWeek,
  toDate
} from './utils/date'
import { dateToDayIndex, dateToWeekIndex, weekIndexToDate } from './utils/infiniteScroll'
import { isCompactWidth, MONTH_WEEK_BUFFER_HALF } from './utils/responsive'
import { validateOptions } from './utils/validate'
import { MonthView } from './views/MonthView'
import { WeekView } from './views/WeekView'
import { DayView } from './views/DayView'
import { AgendaView } from './views/AgendaView'
import './styles/events.css'

const DEFAULT_HOURS = { start: 9, end: 18 }

let nextRollDateEventsInstanceId = 0

export class RollDateEvents {
  readonly el: HTMLElement
  private options: RollDateEventsOptions
  private store = new EventStore()
  private viewName: CalendarViewName
  private cursor: Date
  private root!: HTMLElement
  private bodyEl!: HTMLElement
  private titleEl: HTMLElement | null = null
  private activeView: View | null = null
  private views: Record<CalendarViewName, View>
  private proUnlocked = false
  private renderToken = 0
  private layoutWidth = 0
  private compact = false
  private layoutObs: ResizeObserver | null = null
  private layoutRaf = 0
  private readonly instanceId = ++nextRollDateEventsInstanceId

  constructor(selector: string | HTMLElement, options: RollDateEventsOptions = {}) {
    const el =
      typeof selector === 'string' ? document.querySelector<HTMLElement>(selector) : selector
    if (!el) throw new Error(`RollDateEvents: element not found (${String(selector)})`)

    this.el = el
    this.options = { ...options }
    validateOptions(this.options)
    this.viewName = options.defaultView || 'month'
    const initial = startOfDay(options.defaultDate ? toDate(options.defaultDate) : new Date())
    const clamped = this.clampNavDate(initial)
    this.cursor =
      this.viewName === 'month' ? startOfMonth(clamped) : clamped
    this.store.setEvents(options.events || [])

    this.views = {
      month: new MonthView(),
      week: new WeekView(),
      day: new DayView(),
      agenda: new AgendaView()
    }

    this.mount()
    this.measureLayout()
    this.startLayoutObserver()
    void this.bootstrapLicense().then(() => {
      this.measureLayout()
      void this.render({ remount: true })
    })
  }

  /** Current view name */
  get currentView(): CalendarViewName {
    return this.viewName
  }

  /** Cursor date (local start-of-day) */
  get currentDate(): Date {
    return new Date(this.cursor)
  }

  /** Switch Month / Week / Day / Agenda */
  setView(view: CalendarViewName): void {
    if (this.viewName === view) return
    this.viewName = view
    this.bufferedRange = null
    this.options.onViewChange?.(view)
    void this.render({ remount: true })
  }

  /** Jump to a date (keeps current view + scroll surface when possible) */
  setDate(date: Date | string): void {
    const raw = startOfDay(toDate(date))
    const clamped = this.clampNavDate(raw)
    const fdow = this.options.firstDayOfWeek ?? 1
    if (this.viewName === 'month') this.cursor = startOfMonth(clamped)
    else if (this.viewName === 'week') this.cursor = startOfWeek(clamped, fdow)
    else this.cursor = clamped

    if (this.activeView?.name === this.viewName && this.activeView.goToDate) {
      this.activeView.goToDate(this.cursor)
      this.updateTitle()
      return
    }
    void this.render({ remount: true })
  }

  /** Replace all events and refresh */
  setEvents(events: Event[]): void {
    this.store.setEvents(events)
    void this.refreshEvents()
  }

  getEvents(): Event[] {
    return this.store.getRaw()
  }

  addEvent(event: Event): void {
    this.store.add(event)
    void this.refreshEvents()
  }

  updateEvent(id: string | number, patch: Partial<Omit<Event, 'id'>>): void {
    if (!this.store.update(id, patch)) return
    void this.refreshEvents()
  }

  removeEvent(id: string | number): void {
    this.store.remove(id)
    void this.refreshEvents()
  }

  today(): void {
    this.setDate(this.clampNavDate(startOfDay(new Date())))
  }

  next(): void {
    this.shift(1)
  }

  prev(): void {
    this.shift(-1)
  }

  destroy(): void {
    if (this.layoutRaf) cancelAnimationFrame(this.layoutRaf)
    this.layoutObs?.disconnect()
    this.layoutObs = null
    if (this.rangeRaf) cancelAnimationFrame(this.rangeRaf)
    this.activeView?.destroy()
    this.activeView = null
    this.root?.remove()
    this.el.innerHTML = ''
  }

  private shift(dir: 1 | -1): void {
    const fdow = this.options.firstDayOfWeek ?? 1
    if (this.viewName === 'month') {
      // Always land on day 1 of the target month
      this.cursor = this.clampNavDate(addMonths(startOfMonth(this.cursor), dir))
    } else if (this.viewName === 'week') {
      const next = startOfWeek(addDays(startOfWeek(this.cursor, fdow), 7 * dir), fdow)
      this.cursor = this.clampNavDate(next)
    } else if (this.viewName === 'day') {
      this.cursor = this.clampNavDate(addDays(startOfDay(this.cursor), dir))
    } else {
      this.cursor = this.clampNavDate(addDays(startOfDay(this.cursor), 7 * dir))
    }

    if (this.activeView?.name === this.viewName && this.activeView.goToDate) {
      this.activeView.goToDate(this.cursor)
      this.updateTitle()
      return
    }
    void this.render({ remount: true })
  }

  private boundsMin(): Date | undefined {
    const v = this.options.minDate
    return v ? startOfDay(toDate(v)) : undefined
  }

  private boundsMax(): Date | undefined {
    const v = this.options.maxDate
    return v ? startOfDay(toDate(v)) : undefined
  }

  private isDateDisabled(date: Date): boolean {
    return !isDayInRange(startOfDay(date), this.boundsMin(), this.boundsMax())
  }

  /** Clamp navigation cursor to [minDate, maxDate] by calendar day */
  private clampNavDate(date: Date): Date {
    const min = this.boundsMin()
    const maxDay = this.boundsMax()
    return clampDate(startOfDay(date), min, maxDay)
  }

  private dayIndexBounds(): { minDayIndex?: number; maxDayIndex?: number } {
    const min = this.boundsMin()
    const max = this.boundsMax()
    return {
      minDayIndex: min ? dateToDayIndex(min) : undefined,
      maxDayIndex: max ? dateToDayIndex(max) : undefined
    }
  }

  private weekIndexBounds(): { minWeekIndex?: number; maxWeekIndex?: number } {
    const fdow = this.options.firstDayOfWeek ?? 1
    const min = this.boundsMin()
    const max = this.boundsMax()
    return {
      minWeekIndex: min ? dateToWeekIndex(min, fdow) : undefined,
      maxWeekIndex: max ? dateToWeekIndex(max, fdow) : undefined
    }
  }

  private updateTitle(): void {
    if (this.titleEl) {
      this.titleEl.textContent = monthTitle(this.cursor, this.options.locale || 'en')
    }
  }

  private bufferedRange: VisibleRange | null = null
  private rangeRaf = 0
  private rangeSyncToken = 0

  private async refreshEvents(): Promise<void> {
    const range = this.paddedRange(this.bufferedRange || this.visibleRange())
    const expand = __PRO__ && this.proUnlocked
    const events = expand
      ? await this.store.prepareRange(range, true)
      : this.store.prepareRangeSync(range)
    if (this.activeView?.syncEvents) {
      this.activeView.syncEvents(events)
    } else {
      void this.render({ remount: true })
    }
  }

  /** Prefetch beyond the mounted buffer so inserts already have events */
  private paddedRange(range: VisibleRange): VisibleRange {
    const pad =
      this.viewName === 'month' ? 28 : this.viewName === 'week' ? 21 : this.viewName === 'agenda' ? 35 : 7
    return { from: addDays(range.from, -pad), to: addDays(range.to, pad) }
  }

  private onViewRangeChange(range: VisibleRange): void {
    this.bufferedRange = range
    this.options.onVisibleRangeChange?.(range)
    if (this.rangeRaf) cancelAnimationFrame(this.rangeRaf)
    const token = ++this.rangeSyncToken
    this.rangeRaf = requestAnimationFrame(() => {
      this.rangeRaf = 0
      void this.flushRangeEvents(token)
    })
  }

  private async flushRangeEvents(token: number): Promise<void> {
    if (token !== this.rangeSyncToken || !this.bufferedRange) return
    const range = this.paddedRange(this.bufferedRange)
    const expand = __PRO__ && this.proUnlocked
    const events = expand
      ? await this.store.prepareRange(range, true)
      : this.store.prepareRangeSync(range)
    if (token !== this.rangeSyncToken) return
    this.activeView?.syncEvents?.(events)
  }

  private onViewAnchorChange(date: Date): void {
    this.cursor = startOfDay(date)
    this.updateTitle()
  }

  private async bootstrapLicense(): Promise<void> {
    // __PRO__ is compile-time replaced — Lite DCE drops this branch + import
    if (!__PRO__) {
      this.proUnlocked = false
      return
    }
    const key = this.options.licenseKey
    if (!key) {
      this.proUnlocked = false
      return
    }
    const { validateLicense } = await import('./pro/license')
    const status = await validateLicense(key, this.options.licenseApiUrl)
    this.proUnlocked = status.valid
    if (!status.valid) {
      console.warn('[RollDateEvents Pro] license invalid:', status.message)
    }
  }

  private visibleRange(): VisibleRange {
    if (this.viewName === 'month') {
      const fdow = this.options.firstDayOfWeek ?? 1
      const anchor = dateToWeekIndex(startOfMonth(this.cursor), fdow)
      const from = weekIndexToDate(anchor - MONTH_WEEK_BUFFER_HALF, fdow)
      const to = addDays(weekIndexToDate(anchor + MONTH_WEEK_BUFFER_HALF - 1, fdow), 6)
      return { from, to }
    }
    if (this.viewName === 'week') {
      const from = startOfWeek(this.cursor, this.options.firstDayOfWeek ?? 1)
      return { from, to: addDays(from, 7) }
    }
    if (this.viewName === 'day') {
      const from = startOfDay(this.cursor)
      return { from, to: addDays(from, 1) }
    }
    return { from: startOfDay(this.cursor), to: addDays(this.cursor, 90) }
  }

  private resolveTheme(): 'light' | 'dark' {
    let theme = this.options.theme || 'dark'
    if (theme === 'auto') {
      theme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
    }
    return theme
  }

  private visibleHours(): { start: number; end: number } {
    const vh = this.options.visibleHours || DEFAULT_HOURS
    const start = clampHour(vh.start)
    const end = Math.max(start + 1, clampHour(vh.end))
    return { start, end }
  }

  private mount(): void {
    this.el.innerHTML = ''
    this.root = document.createElement('div')
    this.root.className = 'rde'
    this.root.dataset.theme = this.resolveTheme()
    if (isProBuild()) this.root.dataset.edition = 'pro'
    else this.root.dataset.edition = 'lite'

    const showHeader = this.options.header !== false
    const panelId = `rde-${this.instanceId}-panel`
    if (showHeader) {
      this.root.innerHTML = `
        <div class="rde-header">
          <div class="rde-nav">
            <button type="button" class="rde-btn" data-action="prev" aria-label="Previous">‹</button>
            <button type="button" class="rde-btn" data-action="today">Today</button>
            <button type="button" class="rde-btn" data-action="next" aria-label="Next">›</button>
          </div>
          <h2 class="rde-title"></h2>
          <div class="rde-views" role="tablist" aria-label="Calendar views">
            <button type="button" role="tab" class="rde-btn rde-view" data-view="month" id="rde-${this.instanceId}-tab-month" aria-controls="${panelId}">Month</button>
            <button type="button" role="tab" class="rde-btn rde-view" data-view="week" id="rde-${this.instanceId}-tab-week" aria-controls="${panelId}">Week</button>
            <button type="button" role="tab" class="rde-btn rde-view" data-view="day" id="rde-${this.instanceId}-tab-day" aria-controls="${panelId}">Day</button>
            <button type="button" role="tab" class="rde-btn rde-view" data-view="agenda" id="rde-${this.instanceId}-tab-agenda" aria-controls="${panelId}">Agenda</button>
          </div>
        </div>
        <div class="rde-body" id="${panelId}" role="tabpanel" tabindex="-1"></div>
      `
      this.titleEl = this.root.querySelector('.rde-title')
    } else {
      this.root.innerHTML = `<div class="rde-body"></div>`
    }

    this.bodyEl = this.root.querySelector('.rde-body') as HTMLElement
    this.el.appendChild(this.root)

    this.root.addEventListener('click', (e) => {
      const t = e.target as HTMLElement
      const action = t.closest<HTMLElement>('[data-action]')?.dataset.action
      if (action === 'prev') this.prev()
      if (action === 'next') this.next()
      if (action === 'today') this.today()
      const viewBtn = t.closest<HTMLElement>('[data-view]')
      if (viewBtn?.dataset.view) this.setView(viewBtn.dataset.view as CalendarViewName)
    })

    this.root.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        this.prev()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        this.next()
      }
    })
  }

  private measureLayout(): void {
    const w = Math.round(this.root?.clientWidth || this.el.clientWidth || 0)
    this.layoutWidth = w > 0 ? w : 800
    this.compact = isCompactWidth(this.layoutWidth)
    if (this.root) {
      this.root.dataset.compact = this.compact ? 'true' : 'false'
    }
  }

  private startLayoutObserver(): void {
    if (typeof ResizeObserver === 'undefined') return
    this.layoutObs = new ResizeObserver((entries) => {
      const entry = entries[0]
      const w = Math.round(entry?.contentRect.width ?? this.root.clientWidth)
      if (w <= 0) return
      if (this.layoutRaf) cancelAnimationFrame(this.layoutRaf)
      this.layoutRaf = requestAnimationFrame(() => {
        this.layoutRaf = 0
        this.onLayoutResize(w)
      })
    })
    this.layoutObs.observe(this.root)
  }

  private onLayoutResize(width: number): void {
    const nextCompact = isCompactWidth(width)
    const changed = width !== this.layoutWidth || nextCompact !== this.compact
    this.layoutWidth = width
    this.compact = nextCompact
    this.root.dataset.compact = nextCompact ? 'true' : 'false'
    if (!changed || !this.activeView) return
    this.activeView.applyLayout?.({ compact: nextCompact, layoutWidth: width })
  }

  private buildViewContext(events: NormalizedEvent[]): ViewContext {
    const dayBounds = this.dayIndexBounds()
    const weekBounds = this.weekIndexBounds()
    return {
      root: this.bodyEl,
      cursor: this.cursor,
      locale: this.options.locale || 'en',
      firstDayOfWeek: this.options.firstDayOfWeek ?? 1,
      theme: this.resolveTheme(),
      compact: this.compact,
      layoutWidth: this.layoutWidth,
      eventLimit: this.options.eventLimit ?? 3,
      visibleHours: this.visibleHours(),
      minDate: this.boundsMin(),
      maxDate: this.boundsMax(),
      isDateDisabled: (date) => this.isDateDisabled(date),
      minDayIndex: dayBounds.minDayIndex,
      maxDayIndex: dayBounds.maxDayIndex,
      minWeekIndex: weekBounds.minWeekIndex,
      maxWeekIndex: weekBounds.maxWeekIndex,
      events,
      getEvent: (id) => this.store.getById(id),
      onEventClick: (ev, ne) => this.options.onEventClick?.(ev as Event, ne),
      onDateClick: (date, ne) => {
        if (this.isDateDisabled(date)) return
        this.options.onDateClick?.(date, ne)
      },
      onAnchorChange: (date) => this.onViewAnchorChange(date),
      onRangeChange: (r) => {
        void this.onViewRangeChange(r)
      }
    }
  }

  private async render(opts: { remount?: boolean } = {}): Promise<void> {
    const token = ++this.renderToken
    const remount =
      opts.remount === true ||
      !this.activeView ||
      this.activeView.name !== this.viewName

    const range = this.bufferedRange && !remount ? this.bufferedRange : this.visibleRange()
    if (remount) this.bufferedRange = range
    this.options.onVisibleRangeChange?.(range)

    const expand = __PRO__ && this.proUnlocked
    const events = expand
      ? await this.store.prepareRange(range, true)
      : this.store.prepareRangeSync(range)

    if (token !== this.renderToken) return

    this.root.dataset.theme = this.resolveTheme()
    this.updateTitle()
    this.root.querySelectorAll('.rde-view').forEach((btn) => {
      const el = btn as HTMLElement
      const active = el.dataset.view === this.viewName
      el.classList.toggle('is-active', active)
      el.setAttribute('aria-selected', active ? 'true' : 'false')
      el.tabIndex = active ? 0 : -1
    })

    const ctx = this.buildViewContext(events)

    if (remount) {
      if (this.activeView && this.activeView.name !== this.viewName) {
        this.activeView.destroy()
        this.activeView = null
      }
      this.activeView = this.views[this.viewName]
      this.activeView.render(ctx)
    } else if (this.activeView?.syncEvents) {
      this.activeView.syncEvents(events)
    } else {
      this.activeView = this.views[this.viewName]
      this.activeView.render(ctx)
    }
  }
}

export type { NormalizedEvent }
