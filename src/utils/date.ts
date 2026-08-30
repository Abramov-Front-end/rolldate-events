/**
 * Date helpers — local calendar arithmetic (no locale string ambiguity).
 */

/** Parse Date | ISO-ish string into a valid Date */
export function toDate(value: Date | string): Date {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error('RollDateEvents: invalid Date object')
    }
    return new Date(value.getTime())
  }
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) {
    throw new Error(`RollDateEvents: invalid date "${value}"`)
  }
  return d
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

/** Clamp to [min, max] when provided (inclusive, by timestamp) */
export function clampDate(date: Date, min?: Date, max?: Date): Date {
  const t = date.getTime()
  if (min && t < min.getTime()) return new Date(min)
  if (max && t > max.getTime()) return new Date(max)
  return date
}

export function endOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999)
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

export function addMonths(date: Date, months: number): Date {
  const d = new Date(date)
  d.setMonth(d.getMonth() + months)
  return d
}

export function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/** Local YYYY-MM-DD key */
export function dayKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function parseDayKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/**
 * Build a 6-week (42-day) month grid starting at firstDayOfWeek.
 */
export function monthGrid(anchor: Date, firstDayOfWeek: 0 | 1): Date[] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  const weekday = first.getDay()
  const pad = firstDayOfWeek === 1 ? (weekday + 6) % 7 : weekday
  const start = addDays(first, -pad)
  const cells: Date[] = []
  for (let i = 0; i < 42; i++) cells.push(addDays(start, i))
  return cells
}

/** Six week-start dates for the month grid (for week virtualization) */
export function monthWeekStarts(anchor: Date, firstDayOfWeek: 0 | 1): Date[] {
  const cells = monthGrid(anchor, firstDayOfWeek)
  const weeks: Date[] = []
  for (let i = 0; i < 6; i++) weeks.push(cells[i * 7])
  return weeks
}

export function startOfWeek(date: Date, firstDayOfWeek: 0 | 1): Date {
  const d = startOfDay(date)
  const dow = d.getDay()
  const pad = firstDayOfWeek === 1 ? (dow + 6) % 7 : dow
  return addDays(d, -pad)
}

/**
 * Which month a week row "belongs to" in month view.
 * Prefer a month whose 1st falls in the row; otherwise use the Thursday (index 3).
 */
export function primaryMonthForWeek(weekStart: Date): Date {
  for (let d = 0; d < 7; d++) {
    const cell = addDays(weekStart, d)
    if (cell.getDate() === 1) return startOfMonth(cell)
  }
  return startOfMonth(addDays(weekStart, 3))
}

export function weekDays(locale: string, firstDayOfWeek: 0 | 1): string[] {
  const formatter = new Intl.DateTimeFormat(locale, { weekday: 'short' })
  const base = new Date(2024, 0, 7) // Sunday
  const labels: string[] = []
  for (let i = 0; i < 7; i++) {
    const offset = firstDayOfWeek === 1 ? i + 1 : i
    labels.push(formatter.format(addDays(base, offset % 7)))
  }
  return labels
}

export function monthTitle(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(date)
}

export function formatTime(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

export function clampHour(h: number): number {
  return Math.min(23, Math.max(0, Math.floor(h)))
}

/** Inclusive calendar-day range check */
export function isDayInRange(day: Date, min?: Date, max?: Date): boolean {
  const t = startOfDay(day).getTime()
  if (min && t < startOfDay(min).getTime()) return false
  if (max && t > startOfDay(max).getTime()) return false
  return true
}
