/**
 * Container-width responsive helpers for @rolldate/events.
 * Uses component width — not window.innerWidth.
 */

/** Narrow-container breakpoint (px) */
export const COMPACT_BREAKPOINT = 640

export function isCompactWidth(width: number): boolean {
  return width > 0 && width <= COMPACT_BREAKPOINT
}

/** Month translate-strip buffer (week rows) — keep in sync with MonthView */
export const MONTH_WEEK_BUFFER = 16

export const MONTH_WEEK_BUFFER_HALF = Math.floor(MONTH_WEEK_BUFFER / 2)

/** Horizontal insets on a compact month week row (2× padding + 6× column gap) */
export const MONTH_COMPACT_ROW_INSET = 16

/** Square day-cell size for compact month (width-driven) */
export function monthCompactDaySize(layoutWidth: number): number {
  const inner = Math.max(7, Math.round(layoutWidth) - MONTH_COMPACT_ROW_INSET)
  return Math.floor(inner / 7)
}

/** Month week-row height by layout mode */
export function monthWeekRowHeight(compact: boolean, layoutWidth = 0): number {
  if (!compact) return 108
  if (layoutWidth > 0) return monthCompactDaySize(layoutWidth)
  return monthCompactDaySize(375)
}

/** Max compact event dots shown in a month day cell */
export const MONTH_COMPACT_DOT_LIMIT = 3

/** Readable day-column width bounds for compact week view */
export const WEEK_DAY_WIDTH_MIN = 110
export const WEEK_DAY_WIDTH_MAX = 140

/**
 * Day column width for compact week — targets ~2.8 visible days in the viewport.
 */
export function weekDayColumnWidth(viewportWidth: number): number {
  const w = Math.max(1, Math.round(viewportWidth))
  const target = Math.round(w / 2.85)
  return Math.max(WEEK_DAY_WIDTH_MIN, Math.min(WEEK_DAY_WIDTH_MAX, target))
}

export interface WeekLayoutMetrics {
  /** Full week segment width along scroll axis */
  segW: number
  /** Single day column width inside the week */
  dayWidth: number
}

/**
 * Week strip geometry.
 * Desktop: one week segment = viewport width (all 7 days visible).
 * Compact: segment = 7 × fixed day columns; viewport pans across days.
 */
export function weekLayoutMetrics(viewportWidth: number, compact: boolean): WeekLayoutMetrics {
  const vw = Math.max(1, Math.round(viewportWidth))
  if (!compact) {
    const segW = Math.max(280, vw)
    return { segW, dayWidth: segW / 7 }
  }
  const dayWidth = weekDayColumnWidth(vw)
  return { segW: dayWidth * 7, dayWidth }
}

/** Minimum timed-event column width (px) before hiding time text */
export const BLOCK_MIN_COL_PX = 52

/** Max overlap columns in compact mode for a given day width */
export function maxOverlapColumns(dayWidth: number, compact: boolean): number {
  if (!compact) return 12
  return Math.max(1, Math.floor(dayWidth / BLOCK_MIN_COL_PX))
}

export interface MonthCompactIndicators {
  dots: number
  more: number
}

/** Pure helper for month compact indicator counts */
export function monthCompactIndicators(
  eventCount: number,
  limit = MONTH_COMPACT_DOT_LIMIT
): MonthCompactIndicators {
  const capped = Math.max(0, eventCount)
  const dots = Math.min(capped, limit)
  return { dots, more: Math.max(0, capped - dots) }
}
