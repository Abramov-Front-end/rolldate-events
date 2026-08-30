/**
 * Public types for @rolldate/events
 */

/** Calendar view identifiers */
export type CalendarViewName = 'month' | 'week' | 'day' | 'agenda'

export type ThemeMode = 'light' | 'dark' | 'auto'

export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly'

/** Recurring rule — Pro only (ignored / stripped in Lite builds) */
export interface EventRecurring {
  frequency: RecurrenceFrequency
  /** Every N periods (default 1) */
  interval?: number
  endDate?: Date | string
  /** Repeat N times (alternative to endDate) */
  count?: number
}

/**
 * Calendar event model.
 * `resourceId` is reserved for future Resource Timeline grouping.
 */
export interface Event {
  id: string | number
  title: string
  start: Date | string
  end: Date | string
  allDay?: boolean
  /** Hex or CSS color */
  color?: string
  location?: string
  description?: string
  /**
   * Optional resource / lane id for Resource Timeline (future Pro view).
   * Month/Week/Day/Agenda do not group by this yet — keep the field for API stability.
   */
  resourceId?: string
  /** Pro feature — expanded at render time when license is active */
  recurring?: EventRecurring
}

/** @deprecated Use Event — kept as alias for clarity in docs */
export type CalendarEvent = Event

export interface VisibleRange {
  from: Date
  to: Date
}

export interface RollDateEventsOptions {
  events?: Event[]

  defaultView?: CalendarViewName
  defaultDate?: Date | string

  locale?: string
  /** 0 = Sunday, 1 = Monday */
  firstDayOfWeek?: 0 | 1

  theme?: ThemeMode
  header?: boolean

  /**
   * Hour window for week/day grids (virtualized outside this band is not mounted).
   * Default: { start: 9, end: 18 }
   */
  visibleHours?: { start: number; end: number }

  /** Max chips per day cell in month view before "+N more" */
  eventLimit?: number

  /** Earliest navigable date (inclusive, by calendar day) */
  minDate?: Date | string
  /** Latest navigable date (inclusive, by calendar day) */
  maxDate?: Date | string

  /**
   * Pro license key. Validated via API when using Pro build.
   * Lite build ignores this.
   */
  licenseKey?: string
  /** Override license validation endpoint (Pro) */
  licenseApiUrl?: string

  onEventClick?: (event: Event, nativeEvent: MouseEvent) => void
  onDateClick?: (date: Date, nativeEvent: MouseEvent) => void
  onViewChange?: (view: CalendarViewName) => void
  onVisibleRangeChange?: (range: VisibleRange) => void
}

/** Normalized in-memory event (Date instances, optional occurrence id) */
export interface NormalizedEvent extends Omit<Event, 'start' | 'end'> {
  start: Date
  end: Date
  occurrenceId?: string
}

/** Layout patch passed on container resize (no full remount) */
export interface LayoutPatch {
  compact: boolean
  layoutWidth: number
}

/** Shared context passed into every View.render() */
export interface ViewContext {
  root: HTMLElement
  cursor: Date
  locale: string
  firstDayOfWeek: 0 | 1
  theme: 'light' | 'dark'
  /** True when root width <= 640px */
  compact: boolean
  /** Measured width of the .rde root (px) */
  layoutWidth: number
  eventLimit: number
  visibleHours: { start: number; end: number }
  minDate?: Date
  maxDate?: Date
  /** True when the calendar day is outside minDate/maxDate */
  isDateDisabled: (date: Date) => boolean
  /** Optional absolute day index bounds for infinite strips */
  minDayIndex?: number
  maxDayIndex?: number
  minWeekIndex?: number
  maxWeekIndex?: number
  /** Events already filtered / expanded for the visible range */
  events: NormalizedEvent[]
  /** Look up by id or occurrence id */
  getEvent: (id: string) => NormalizedEvent | undefined
  onEventClick: (event: NormalizedEvent, e: MouseEvent) => void
  onDateClick: (date: Date, e: MouseEvent) => void
  /**
   * View reports the date that should drive the header title
   * (dominant month / week / day in the viewport).
   */
  onAnchorChange: (date: Date) => void
  /**
   * View reports the buffered date range that needs events loaded.
   * Parent prepares events and calls syncEvents — scroll position is preserved.
   */
  onRangeChange: (range: VisibleRange) => void
}

/**
 * Pluggable view contract.
 * Resource Timeline (future) will implement the same interface.
 */
export interface View {
  readonly name: CalendarViewName
  /** Mount / refresh UI into ctx.root (body host) */
  render(ctx: ViewContext): void
  /** Soft-update events without resetting scroll (infinite strip) */
  syncEvents?(events: NormalizedEvent[]): void
  /** Reflow on container width / compact mode change without remount */
  applyLayout?(patch: LayoutPatch): void
  /** Jump while keeping the infinite-scroll surface */
  goToDate?(date: Date, opts?: { animate?: boolean }): void
  /** Tear down listeners / observers */
  destroy(): void
}
