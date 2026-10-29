/**
 * RollDateEvents — orchestrator. Delegates rendering to the active View.
 */

declare const __PRO__: boolean
declare const __PRO_SHOWCASE__: boolean

import {
  buildDayOpenInfo,
  type CalendarViewName,
  type Event,
  type EventChangeGesture,
  type EventChangeReason,
  type EventChangeScope,
  type EventChangeTransaction,
  type EventMovePatch,
  type EventMutation,
  type NormalizedEvent,
  type RollDateEventsOptions,
  type View,
  type ViewContext,
  type VisibleRange
} from './types'
import {
  allocateEventId,
  allowEventChange,
  buildEventChangeInfo,
  cloneEvent,
  cloneEventMutation,
  cloneTransaction,
  createRevert,
  invertMutations,
  isResolvableOccurrenceScope,
  isResizeGesture
} from './utils/eventChange'
import { isSameMovedEvent } from './utils/eventOverlap'
import { isOverlapAllowed } from './utils/eventOverlap'
import { isResourceChangeAllowed, nextResourceIdFromPatch } from './utils/eventResource'
import { isProBuild } from './features'
import { EventStore } from './store/EventStore'
import {
  addDays,
  addMonths,
  clampDate,
  clampHour,
  isDayInRange,
  isIntervalInBounds,
  monthTitle,
  startOfDay,
  startOfMonth,
  startOfWeek,
  toDate,
  weekTitle
} from './utils/date'
import { formatTimelineTitle, timelineRange } from './utils/timelineRange'
import { dateToDayIndex, dateToWeekIndex, weekIndexToDate } from './utils/infiniteScroll'
import { isCompactWidth, MONTH_WEEK_BUFFER_HALF } from './utils/responsive'
import { validateOptions } from './utils/validate'
import { MonthView } from './views/MonthView'
import { WeekView } from './views/WeekView'
import { DayView } from './views/DayView'
import { AgendaView } from './views/AgendaView'
import { TimelineView } from './views/TimelineView'
import { DateNavigator } from './ui/DateNavigator'
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
  private titleHost: HTMLElement | null = null
  private dateNavigator: DateNavigator | null = null
  private viewCtx: ViewContext | null = null
  private activeView: View | null = null
  private views: Record<CalendarViewName, View>
  private proUnlocked = false
  private unbindInteract: (() => void) | null = null
  private changeBusy = false
  private revertSeq = 0
  private dataEpoch = 0
  private renderToken = 0
  private layoutWidth = 0
  private compact = false
  private layoutObs: ResizeObserver | null = null
  private layoutRaf = 0
  private layoutLock = false
  private readonly instanceId = ++nextRollDateEventsInstanceId

  constructor(selector: string | HTMLElement, options: RollDateEventsOptions = {}) {
    const el =
      typeof selector === 'string' ? document.querySelector<HTMLElement>(selector) : selector
    if (!el) throw new Error(`RollDateEvents: element not found (${String(selector)})`)

    this.el = el
    this.options = { ...options }
    validateOptions(this.options)
    this.viewName =
      options.defaultView === 'timeline' && !__PRO__ ? 'week' : options.defaultView || 'month'
    const initial = startOfDay(options.defaultDate ? toDate(options.defaultDate) : new Date())
    const clamped = this.clampNavDate(initial)
    this.cursor =
      this.viewName === 'month' ? startOfMonth(clamped) : clamped
    this.store.setEvents(options.events || [])

    this.views = {
      month: new MonthView(),
      week: new WeekView(),
      day: new DayView(),
      agenda: new AgendaView(),
      timeline: new TimelineView()
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

  /** Alias for {@link currentView} */
  getView(): CalendarViewName {
    return this.viewName
  }

  /** Cursor date (local start-of-day) */
  get currentDate(): Date {
    return new Date(this.cursor)
  }

  /** Alias for {@link currentDate} */
  getDate(): Date {
    return new Date(this.cursor)
  }

  /** Switch Month / Week / Day / Agenda */
  setView(view: CalendarViewName): void {
    if (view === 'timeline' && !this.proUnlocked) {
      console.warn('[RollDateEvents Pro] Resource Timeline requires a valid license.')
      return
    }
    if (this.viewName === view) return
    this.viewName = view
    this.bufferedRange = null
    this.emittedTo = -1
    this.options.onViewChange?.(view)
    void this.render({ remount: true })
  }

  private openDay(date: Date, info?: { resourceId?: string }): void {
    if (this.isDateDisabled(date)) return
    const day = startOfDay(this.clampNavDate(date))
    const payload = buildDayOpenInfo(day, this.viewName, info?.resourceId)
    this.cursor = day
    if (!payload) {
      this.activeView?.goToDate?.(this.cursor)
      this.updateTitle()
      return
    }
    this.options.onDayOpen?.(payload)
    this.setView('day')
  }

  /** Jump to a date (keeps current view + scroll surface when possible) */
  setDate(date: Date | string): void {
    const raw = startOfDay(toDate(date))
    const clamped = this.clampNavDate(raw)
    const fdow = this.options.firstDayOfWeek ?? 1
    if (this.viewName === 'month') this.cursor = startOfMonth(clamped)
    else if (this.viewName === 'week') {
      this.cursor = startOfWeek(clamped, fdow)
    } else this.cursor = clamped

    if (this.activeView?.name === this.viewName && this.activeView.goToDate) {
      this.activeView.goToDate(this.cursor)
      this.updateTitle()
      return
    }
    void this.render({ remount: true })
  }

  /** Replace all events and refresh */
  setEvents(events: Event[]): void {
    this.dataEpoch += 1
    this.store.setEvents(events)
    void this.refreshEvents()
  }

  getEvents(): Event[] {
    return this.store.getRaw()
  }

  addEvent(event: Event): void {
    this.dataEpoch += 1
    this.store.add(event)
    void this.refreshEvents()
  }

  updateEvent(id: string | number, patch: Partial<Omit<Event, 'id'>>): void {
    if (!this.store.update(id, patch)) return
    this.dataEpoch += 1
    void this.refreshEvents()
  }

  removeEvent(id: string | number): void {
    if (!this.store.remove(id)) return
    this.dataEpoch += 1
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
    this.unbindInteract?.()
    this.unbindInteract = null
    this.dateNavigator?.destroy()
    this.dateNavigator = null
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
    } else if (this.viewName === 'timeline') {
      this.cursor = this.clampNavDate(addDays(startOfDay(this.cursor), 7 * dir))
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
    this.dateNavigator?.refresh()
  }

  private bufferedRange: VisibleRange | null = null
  private rangeRaf = 0
  private rangeSyncToken = 0
  private emittedFrom = 0
  private emittedTo = -1
  private visibleEvents: NormalizedEvent[] = []

  private async refreshEvents(): Promise<void> {
    const range = this.paddedRange(
      this.viewName === 'agenda' ? this.visibleRange() : this.bufferedRange || this.visibleRange()
    )
    const expand = __PRO__ && this.proUnlocked
    const events = expand
      ? await this.store.prepareRange(range, true)
      : this.store.prepareRangeSync(range)
    this.visibleEvents = events
    if (this.activeView?.syncEvents) {
      this.activeView.syncEvents(events)
    } else {
      void this.render({ remount: true })
    }
  }

  /** Prefetch beyond the mounted buffer so inserts already have events */
  private paddedRange(range: VisibleRange): VisibleRange {
    const pad =
      this.viewName === 'month'
        ? 28
        : this.viewName === 'week'
          ? 21
          : this.viewName === 'timeline'
            ? 7
          : this.viewName === 'agenda'
            ? 1
            : 7
    return { from: addDays(range.from, -pad), to: addDays(range.to, pad) }
  }

  private onViewRangeChange(range: VisibleRange): void {
    // Views re-emit the same range on every settle — skip identical repeats
    const from = range.from.getTime()
    const to = range.to.getTime()
    if (from === this.emittedFrom && to === this.emittedTo) return
    this.emittedFrom = from
    this.emittedTo = to

    this.bufferedRange = range
    this.options.onVisibleRangeChange?.(this.toPublicRange(range))
    this.updateTitle()
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
    this.visibleEvents = events
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
    // Public showcase build: unlock only on the gated demo page (no license key).
    if (typeof __PRO_SHOWCASE__ !== 'undefined' && __PRO_SHOWCASE__) {
      const { isShowcaseHostAllowed } = await import('./pro/showcaseGate')
      this.proUnlocked = isShowcaseHostAllowed()
      if (!this.proUnlocked) {
        console.warn('[RollDateEvents Pro] showcase demo runs only on rolldate.dev/events/pro/demo')
        if (this.viewName === 'timeline') this.viewName = 'week'
      }
      this.syncProChrome()
      return
    }
    const key = this.options.licenseKey
    if (!key) {
      this.proUnlocked = false
      return
    }
    const { validateLicense } = await import('./pro/license')
    const status = await validateLicense(key)
    this.proUnlocked = status.valid
    if (!status.valid) {
      console.warn('[RollDateEvents Pro] license invalid:', status.message)
      if (this.viewName === 'timeline') this.viewName = 'week'
    }
    this.syncProChrome()
  }

  private toPublicRange(range: VisibleRange): VisibleRange {
    return {
      from: range.from,
      to: range.to,
      start: range.from,
      end: range.to,
      view: this.viewName
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
    if (this.viewName === 'timeline') {
      const { start, end } = timelineRange(this.cursor, this.options.firstDayOfWeek ?? 1)
      return { from: start, to: end }
    }
    if (this.viewName === 'week') {
      const from = startOfWeek(this.cursor, this.options.firstDayOfWeek ?? 1)
      return { from, to: addDays(from, 7) }
    }
    if (this.viewName === 'day') {
      const from = startOfDay(this.cursor)
      return { from, to: addDays(from, 1) }
    }
    const span = this.store.daySpan()
    const min = this.boundsMin()
    const max = this.boundsMax()
    if (!span) {
      const from = startOfDay(this.cursor)
      return { from, to: addDays(from, 1) }
    }
    let from = startOfDay(span.min)
    let to = addDays(startOfDay(span.max), 1)
    if (min && from < min) from = min
    if (max && to > addDays(max, 1)) to = addDays(max, 1)
    if (to <= from) to = addDays(from, 1)
    return { from, to }
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
          <div class="rde-title-wrap"></div>
          <div class="rde-views" role="tablist" aria-label="Calendar views">
            <button type="button" role="tab" class="rde-btn rde-view" data-view="month" id="rde-${this.instanceId}-tab-month" aria-controls="${panelId}">Month</button>
            <button type="button" role="tab" class="rde-btn rde-view" data-view="week" id="rde-${this.instanceId}-tab-week" aria-controls="${panelId}">Week</button>
            <button type="button" role="tab" class="rde-btn rde-view" data-view="day" id="rde-${this.instanceId}-tab-day" aria-controls="${panelId}">Day</button>
            <button type="button" role="tab" class="rde-btn rde-view" data-view="agenda" id="rde-${this.instanceId}-tab-agenda" aria-controls="${panelId}">Agenda</button>
          </div>
        </div>
        <div class="rde-body" id="${panelId}" role="tabpanel" tabindex="-1"></div>
      `
      this.titleHost = this.root.querySelector('.rde-title-wrap')
      if (this.titleHost) {
        this.dateNavigator = new DateNavigator({
          host: this.titleHost,
          locale: this.options.locale || 'en',
          instanceId: this.instanceId,
          getCursor: () => this.cursor,
          getMinDate: () => this.boundsMin(),
          getMaxDate: () => this.boundsMax(),
          getTitle: (cursor) => {
            const locale = this.options.locale || 'en'
            const fdow = this.options.firstDayOfWeek ?? 1
            if (this.viewName === 'timeline') {
              if (this.bufferedRange) {
                return formatTimelineTitle(
                  this.bufferedRange.from,
                  this.bufferedRange.to,
                  locale
                )
              }
              const { start, end } = timelineRange(cursor, fdow)
              return formatTimelineTitle(start, end, locale)
            }
            // Cross-month weeks: "Feb – Mar 2026" (not March alone for a Feb-heavy strip).
            if (this.viewName === 'week') {
              return weekTitle(startOfWeek(cursor, fdow), locale)
            }
            return monthTitle(cursor, locale)
          },
          getActiveMonths: () => {
            if (this.viewName === 'week') {
              const fdow = this.options.firstDayOfWeek ?? 1
              const start = startOfWeek(this.cursor, fdow)
              const end = addDays(start, 6)
              const months = [{ year: start.getFullYear(), month: start.getMonth() }]
              if (
                end.getMonth() !== start.getMonth() ||
                end.getFullYear() !== start.getFullYear()
              ) {
                months.push({ year: end.getFullYear(), month: end.getMonth() })
              }
              return months
            }
            return [{ year: this.cursor.getFullYear(), month: this.cursor.getMonth() }]
          },
          onSelect: (year, month) => this.setDate(new Date(year, month, 1)),
          onToday: () => this.today()
        })
      }
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
      // The open date navigator owns arrow keys while focus is inside it
      if (this.dateNavigator?.ownsEventTarget(e.target)) return
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
    const w = Math.round(this.el.clientWidth || this.root?.clientWidth || 0)
    this.layoutWidth = w > 0 ? w : 800
    this.compact = isCompactWidth(this.layoutWidth, this.compact)
    if (this.root) {
      this.root.dataset.compact = this.compact ? 'true' : 'false'
    }
  }

  private startLayoutObserver(): void {
    if (typeof ResizeObserver === 'undefined') return
    this.layoutObs = new ResizeObserver((entries) => {
      if (this.layoutLock) return
      const entry = entries[0]
      const border = Array.isArray(entry.borderBoxSize) ? entry.borderBoxSize[0] : entry.borderBoxSize
      const w = Math.round(border?.inlineSize ?? entry.contentRect.width ?? this.el.clientWidth)
      if (w <= 0) return
      if (this.layoutRaf) cancelAnimationFrame(this.layoutRaf)
      this.layoutRaf = requestAnimationFrame(() => {
        this.layoutRaf = 0
        this.onLayoutResize(w)
      })
    })
    // Observe the host, not `.rde`: compact padding must not change the measured width.
    this.layoutObs.observe(this.el)
  }

  private onLayoutResize(width: number): void {
    const nextCompact = isCompactWidth(width, this.compact)
    const compactChanged = nextCompact !== this.compact
    const widthChanged = Math.abs(width - this.layoutWidth) >= 8
    if (!compactChanged && !widthChanged) return
    this.layoutWidth = width
    this.compact = nextCompact
    this.root.dataset.compact = nextCompact ? 'true' : 'false'
    if (!this.activeView) return
    this.layoutLock = true
    this.activeView.applyLayout?.({ compact: nextCompact, layoutWidth: width })
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.layoutLock = false
      })
    })
  }

  private buildViewContext(events: NormalizedEvent[]): ViewContext {
    const dayBounds = this.dayIndexBounds()
    const weekBounds = this.weekIndexBounds()
    const ctx: ViewContext = {
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
      getEvent: (id) => this.lookupEvent(id),
      resources: this.options.resources || [],
      editable: Boolean(this.proUnlocked && this.options.editable !== false),
      onEventClick: (ev, ne) => this.options.onEventClick?.(ev as Event, ne),
      onDateClick: (date, ne) => {
        if (this.isDateDisabled(date)) return
        this.options.onDateClick?.(date, ne)
      },
      onDayOpen: (date, info) => this.openDay(date, info),
      onEventMove: (event, start, end, reason, patch) =>
        this.commitEventMove(event, start, end, reason, patch),
      onAnchorChange: (date) => this.onViewAnchorChange(date),
      onRangeChange: (r) => {
        void this.onViewRangeChange(r)
      }
    }
    return ctx
  }

  private async render(opts: { remount?: boolean } = {}): Promise<void> {
    const token = ++this.renderToken
    const remount =
      opts.remount === true ||
      !this.activeView ||
      this.activeView.name !== this.viewName

    const range = this.bufferedRange && !remount ? this.bufferedRange : this.visibleRange()
    if (remount) this.bufferedRange = range
    this.emittedFrom = range.from.getTime()
    this.emittedTo = range.to.getTime()
    this.options.onVisibleRangeChange?.(this.toPublicRange(range))

    const expand = __PRO__ && this.proUnlocked
    const events = expand
      ? await this.store.prepareRange(range, true)
      : this.store.prepareRangeSync(range)

    if (token !== this.renderToken) return
    this.visibleEvents = events

    this.root.dataset.theme = this.resolveTheme()
    this.updateTitle()
    this.syncProChrome()
    this.root.querySelectorAll('.rde-view').forEach((btn) => {
      const el = btn as HTMLElement
      const active = el.dataset.view === this.viewName
      el.classList.toggle('is-active', active)
      el.setAttribute('aria-selected', active ? 'true' : 'false')
      el.tabIndex = active ? 0 : -1
    })

    const ctx = this.buildViewContext(events)
    this.viewCtx = ctx

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
    this.syncInteract()
  }

  private setChangePending(pending: boolean): void {
    this.changeBusy = pending
    if (!this.root) return
    if (pending) this.root.setAttribute('data-event-change-pending', 'true')
    else this.root.removeAttribute('data-event-change-pending')
  }

  private inferredChangeScope(event: NormalizedEvent): EventChangeScope {
    const raw = this.store.getRaw().find((item) => String(item.id) === String(event.id))
    return raw?.recurring && event.occurrenceId ? 'series' : 'single'
  }

  private snapshotForScopeResolver(
    event: NormalizedEvent,
    start: Date,
    end: Date,
    patch?: EventMovePatch
  ): Event {
    const { occurrenceId: _occurrenceId, occurrenceIndex: _occurrenceIndex, ...rest } = event
    const snapshot = cloneEvent({ ...rest, start, end })
    if (patch && Object.prototype.hasOwnProperty.call(patch, 'resourceId')) {
      snapshot.resourceId = patch.resourceId
    }
    return snapshot
  }

  private async commitEventMove(
    event: NormalizedEvent,
    start: Date,
    end: Date,
    reason: EventChangeGesture | EventChangeReason,
    patch?: EventMovePatch
  ): Promise<void> {
    const inferred = this.inferredChangeScope(event)
    let scope = inferred
    if (
      inferred === 'series' &&
      event.occurrenceIndex != null &&
      this.options.resolveEventChangeScope
    ) {
      if (this.changeBusy) return
      const epoch = this.dataEpoch
      this.setChangePending(true)
      try {
        const gesture: EventChangeGesture = isResizeGesture(reason)
          ? reason === 'resize-start'
            ? 'resize-start'
            : 'resize-end'
          : 'move'
        const resolved = await this.options.resolveEventChangeScope({
          occurrenceIndex: event.occurrenceIndex,
          seriesId: event.id,
          oldOccurrence: this.snapshotForScopeResolver(event, event.start, event.end),
          newOccurrence: this.snapshotForScopeResolver(event, start, end, patch),
          reason: gesture,
          view: this.viewName
        })
        if (this.dataEpoch !== epoch) {
          await this.refreshEvents()
          return
        }
        if (!isResolvableOccurrenceScope(resolved)) {
          await this.refreshEvents()
          return
        }
        scope = resolved
      } catch {
        await this.refreshEvents()
        return
      } finally {
        this.setChangePending(false)
      }
    }
    return this.commitOccurrenceChange({
      occurrence: event,
      start,
      end,
      reason,
      patch,
      scope
    })
  }

  /**
   * Single commit path for DnD and occurrence scope.
   * Live drag infers `'single'` / `'series'`; `resolveEventChangeScope` may
   * switch an occurrence to `'this'`. An unsupported resolver value cancels.
   */
  private async commitOccurrenceChange(args: {
    occurrence: NormalizedEvent
    start: Date
    end: Date
    reason: EventChangeGesture | EventChangeReason
    patch?: EventMovePatch
    scope: EventChangeScope
    idFactory?: () => Event['id']
  }): Promise<void> {
    if (this.changeBusy) return
    this.setChangePending(true)
    const epoch = this.dataEpoch
    try {
      const built = this.buildOccurrenceTransaction(args)
      if (!built) {
        await this.refreshEvents()
        return
      }
      const { transaction, oldEvent, newEvent, moving, nextStart, nextEnd, nextResourceId, others } =
        built
      if (!isIntervalInBounds(nextStart, nextEnd, this.boundsMin(), this.boundsMax())) {
        await this.refreshEvents()
        return
      }
      if (
        !isResourceChangeAllowed({
          currentResourceId: moving.resourceId,
          nextResourceId,
          event: moving,
          calendarAllowedResourceIds: this.options.allowedResourceIds,
          knownResourceIds: (this.options.resources || []).map((item) => item.id)
        })
      ) {
        await this.refreshEvents()
        return
      }
      if (
        !isOverlapAllowed({
          allowOverlap: this.options.allowOverlap,
          view: this.viewName,
          moving,
          start: nextStart,
          end: nextEnd,
          resourceId: nextResourceId,
          others
        })
      ) {
        await this.refreshEvents()
        return
      }
      const info = buildEventChangeInfo({
        oldEvent,
        newEvent,
        reason: transaction.reason,
        view: this.viewName,
        transaction
      })
      const hook =
        transaction.reason === 'move'
          ? this.options.beforeEventMove
          : this.options.beforeEventResize
      const allowed = await allowEventChange(hook, info)
      if (this.dataEpoch !== epoch) {
        await this.refreshEvents()
        return
      }
      if (!allowed) {
        await this.refreshEvents()
        return
      }
      const committed = cloneTransaction(transaction)
      if (!this.store.applyMutations(committed.mutations.map((item) => cloneEventMutation(item)))) {
        await this.refreshEvents()
        return
      }
      await this.refreshEvents()
      const seq = ++this.revertSeq
      const commitEpoch = this.dataEpoch
      const inverse = invertMutations(committed.mutations)
      const revert = createRevert(() => {
        if (seq !== this.revertSeq) return
        if (this.dataEpoch !== commitEpoch) return
        if (!this.transactionIntact(committed.mutations)) return
        this.revertSeq += 1
        this.store.applyMutations(inverse)
        void this.refreshEvents()
      })
      const visual =
        this.getEvents().find((item) => String(item.id) === String(newEvent.id)) || newEvent
      const publicReason: EventChangeReason = transaction.reason === 'move' ? 'move' : 'resize'
      this.options.onEventChange?.(cloneEvent(visual), publicReason, {
        oldEvent: cloneEvent(oldEvent),
        revert,
        transaction: cloneTransaction(committed)
      })
    } finally {
      this.setChangePending(false)
    }
  }

  private transactionIntact(mutations: EventMutation[]): boolean {
    const raw = this.store.getRaw()
    for (const mutation of mutations) {
      if (mutation.type === 'update' || mutation.type === 'create') {
        const id = mutation.type === 'update' ? mutation.newEvent.id : mutation.event.id
        if (!raw.some((item) => String(item.id) === String(id))) return false
      } else if (raw.some((item) => String(item.id) === String(mutation.event.id))) {
        return false
      }
    }
    return true
  }

  private buildOccurrenceTransaction(args: {
    occurrence: NormalizedEvent
    start: Date
    end: Date
    reason: EventChangeGesture | EventChangeReason
    patch?: EventMovePatch
    scope: EventChangeScope
    idFactory?: () => Event['id']
  }): {
    transaction: EventChangeTransaction
    oldEvent: Event
    newEvent: Event
    moving: NormalizedEvent
    nextStart: Date
    nextEnd: Date
    nextResourceId?: string
    others: NormalizedEvent[]
  } | null {
    const oldRaw = this.store.getRaw().find((item) => String(item.id) === String(args.occurrence.id))
    if (!oldRaw) return null
    const gesture: EventChangeGesture = isResizeGesture(args.reason)
      ? args.reason === 'resize-start'
        ? 'resize-start'
        : 'resize-end'
      : 'move'
    const eventPatch: Partial<Omit<Event, 'id'>> = {}
    if (args.patch && Object.prototype.hasOwnProperty.call(args.patch, 'resourceId')) {
      eventPatch.resourceId = args.patch.resourceId
    }
    if (args.patch?.order != null) eventPatch.order = args.patch.order

    if (args.scope === 'this') {
      return this.buildThisTransaction({
        occurrence: args.occurrence,
        oldRaw,
        start: args.start,
        end: args.end,
        gesture,
        eventPatch,
        idFactory: args.idFactory
      })
    }

    const next =
      args.scope === 'series'
        ? this.seriesPatch(args.occurrence, args.start, args.end)
        : { start: args.start, end: args.end }
    const proposed: Event = {
      ...cloneEvent(oldRaw),
      start: next.start,
      end: next.end,
      ...eventPatch
    }
    const nextResourceId = nextResourceIdFromPatch(oldRaw.resourceId, args.patch)
    const transaction: EventChangeTransaction = {
      reason: gesture,
      scope: args.scope === 'series' ? 'series' : 'single',
      sourceEventId: oldRaw.id,
      mutations: [
        {
          type: 'update',
          oldEvent: cloneEvent(oldRaw),
          newEvent: cloneEvent(proposed)
        }
      ]
    }
    if (args.occurrence.occurrenceIndex != null) {
      transaction.occurrenceIndex = args.occurrence.occurrenceIndex
    }
    return {
      transaction,
      oldEvent: cloneEvent(oldRaw),
      newEvent: cloneEvent(proposed),
      moving: args.occurrence,
      nextStart: args.scope === 'series' ? args.start : next.start,
      nextEnd: args.scope === 'series' ? args.end : next.end,
      nextResourceId,
      others: this.visibleEvents
    }
  }

  private buildThisTransaction(args: {
    occurrence: NormalizedEvent
    oldRaw: Event
    start: Date
    end: Date
    gesture: EventChangeGesture
    eventPatch: Partial<Omit<Event, 'id'>>
    idFactory?: () => Event['id']
  }): {
    transaction: EventChangeTransaction
    oldEvent: Event
    newEvent: Event
    moving: NormalizedEvent
    nextStart: Date
    nextEnd: Date
    nextResourceId?: string
    others: NormalizedEvent[]
  } | null {
    if (!args.oldRaw.recurring || args.occurrence.occurrenceIndex == null) return null
    const excluded = args.oldRaw.recurring.excludedOccurrenceIndexes || []
    if (excluded.includes(args.occurrence.occurrenceIndex)) return null
    const seriesWithExclusion: Event = cloneEvent(args.oldRaw)
    seriesWithExclusion.recurring = {
      ...seriesWithExclusion.recurring!,
      excludedOccurrenceIndexes: [...excluded, args.occurrence.occurrenceIndex]
    }
    const taken = this.store.getRaw().map((item) => item.id)
    const id = allocateEventId(taken, args.idFactory)
    if (id == null) return null
    const {
      occurrenceId: _occurrenceId,
      occurrenceIndex: _occurrenceIndex,
      recurring: _recurring,
      ...rest
    } = args.occurrence
    const detached: Event = {
      ...cloneEvent({ ...rest, start: args.occurrence.start, end: args.occurrence.end }),
      id,
      start: args.start,
      end: args.end,
      ...args.eventPatch,
      recurringSource: {
        seriesId: args.oldRaw.id,
        occurrenceIndex: args.occurrence.occurrenceIndex
      }
    }
    delete detached.recurring
    const nextResourceId = nextResourceIdFromPatch(
      args.occurrence.resourceId,
      Object.prototype.hasOwnProperty.call(args.eventPatch, 'resourceId')
        ? { resourceId: args.eventPatch.resourceId }
        : undefined
    )
    const moving: NormalizedEvent = {
      ...detached,
      start: args.start,
      end: args.end
    }
    const others = this.visibleEvents.filter(
      (item) => !isSameMovedEvent(args.occurrence, item)
    )
    const transaction: EventChangeTransaction = {
      reason: args.gesture,
      scope: 'this',
      sourceEventId: args.oldRaw.id,
      occurrenceIndex: args.occurrence.occurrenceIndex,
      mutations: [
        {
          type: 'update',
          oldEvent: cloneEvent(args.oldRaw),
          newEvent: cloneEvent(seriesWithExclusion)
        },
        { type: 'create', event: cloneEvent(detached) }
      ]
    }
    return {
      transaction,
      oldEvent: cloneEvent(args.oldRaw),
      newEvent: cloneEvent(detached),
      moving,
      nextStart: args.start,
      nextEnd: args.end,
      nextResourceId,
      others
    }
  }

  private lookupEvent(id: string): NormalizedEvent | undefined {
    const sid = String(id)
    return (
      this.visibleEvents.find((item) => String(item.occurrenceId || item.id) === sid) ||
      this.store.getById(sid) ||
      this.store.getById(sid.split('::')[0])
    )
  }

  /** Shift the series by the occurrence delta so weekly/daily siblings keep their offsets. */
  private seriesPatch(
    event: NormalizedEvent,
    start: Date,
    end: Date
  ): { start: Date; end: Date } {
    if (!event.occurrenceId) return { start, end }
    const series = this.store.getById(String(event.id))
    if (!series) return { start, end }
    const delta = start.getTime() - event.start.getTime()
    const duration = Math.max(0, end.getTime() - start.getTime())
    const nextStart = new Date(series.start.getTime() + delta)
    return { start: nextStart, end: new Date(nextStart.getTime() + duration) }
  }

  private syncProChrome(): void {
    if (!this.root) return
    this.root.dataset.editable =
      this.proUnlocked && this.options.editable !== false ? 'true' : 'false'
    const list = this.root.querySelector('.rde-views')
    if (!list) return
    const existing = list.querySelector<HTMLElement>('[data-view="timeline"]')
    if (this.proUnlocked) {
      if (!existing) {
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.role = 'tab'
        btn.className = 'rde-btn rde-view'
        btn.dataset.view = 'timeline'
        btn.id = `rde-${this.instanceId}-tab-timeline`
        btn.setAttribute('aria-controls', `rde-${this.instanceId}-panel`)
        btn.textContent = 'Timeline'
        list.appendChild(btn)
      }
    } else {
      existing?.remove()
    }
  }

  private syncInteract(): void {
    this.unbindInteract?.()
    this.unbindInteract = null
    if (!this.proUnlocked || this.options.editable === false) return
    if (
      this.viewName !== 'week' &&
      this.viewName !== 'day' &&
      this.viewName !== 'month' &&
      this.viewName !== 'timeline'
    ) {
      return
    }
    if (!__PRO__) return
    void import('./pro/interact').then(({ bindInteract }) => {
      if (!this.proUnlocked || this.options.editable === false) return
      this.unbindInteract?.()
      this.unbindInteract = bindInteract(this.root, {
        getEvent: (id) => this.lookupEvent(id),
        visibleHours: this.visibleHours(),
        snapMinutes: this.options.snapMinutes ?? 15,
        viewName: this.viewName,
        calendarEditable: true,
        minDate: this.boundsMin(),
        maxDate: this.boundsMax(),
        allowedResourceIds: this.options.allowedResourceIds,
        knownResourceIds: (this.options.resources || []).map((item) => item.id),
        allowOverlap: this.options.allowOverlap,
        overlapEvents: () => this.visibleEvents,
        isBusy: () => this.changeBusy,
        onEventMove: (event, start, end, reason, patch) =>
          void this.commitEventMove(event, start, end, reason, patch),
        nudgeStrip: (delta) => this.activeView?.nudgeStrip?.(delta),
        scrollTimeBand: (delta) => this.activeView?.scrollTimeBand?.(delta),
        previewTimedMove: (id, start, end, originDay, resourceId, clientY, resize) =>
          this.activeView?.previewTimedMove?.(
            id,
            start,
            end,
            originDay,
            resourceId,
            clientY,
            resize
          ) ?? null,
        clearTimedPreview: () => this.activeView?.clearTimedPreview?.()
      })
    })
  }
}

export type { NormalizedEvent }
