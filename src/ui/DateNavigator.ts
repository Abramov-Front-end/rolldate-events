/**
 * Direct month/year navigator — complements continuous scroll navigation.
 */

import { monthTitle, startOfDay, startOfMonth } from '../utils/date'

export interface DateNavigatorConfig {
  host: HTMLElement
  locale: string
  instanceId: number
  getCursor: () => Date
  getMinDate: () => Date | undefined
  getMaxDate: () => Date | undefined
  onSelect: (year: number, month: number) => void
  onToday: () => void
}

export class DateNavigator {
  private readonly trigger: HTMLButtonElement
  private readonly popover: HTMLElement
  private readonly yearEl: HTMLElement
  private readonly monthsEl: HTMLElement
  private readonly popoverId: string
  private open = false
  private panelYear: number
  private focusBefore: HTMLElement | null = null
  private readonly onDocPointer: (e: PointerEvent) => void
  private readonly onDocKey: (e: KeyboardEvent) => void
  private monthLabels: string[]

  constructor(private cfg: DateNavigatorConfig) {
    this.popoverId = `rde-${cfg.instanceId}-date-popover`
    this.panelYear = cfg.getCursor().getFullYear()
    this.monthLabels = this.buildMonthLabels(cfg.locale)

    this.onDocPointer = (e) => {
      if (!this.open) return
      const t = e.target as Node
      if (this.trigger.contains(t) || this.popover.contains(t)) return
      this.close()
    }
    this.onDocKey = (e) => {
      if (!this.open) return
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        this.close()
      }
    }

    cfg.host.innerHTML = ''
    cfg.host.className = 'rde-title-wrap'

    this.trigger = document.createElement('button')
    this.trigger.type = 'button'
    this.trigger.className = 'rde-date-nav-trigger'
    this.trigger.setAttribute('aria-haspopup', 'dialog')
    this.trigger.setAttribute('aria-expanded', 'false')
    this.trigger.setAttribute('aria-controls', this.popoverId)
    this.trigger.addEventListener('click', () => this.toggle())

    this.popover = document.createElement('div')
    this.popover.id = this.popoverId
    this.popover.className = 'rde-date-nav-popover'
    // Non-modal dialog: the rest of the page stays interactive, so no aria-modal
    // and no focus trap — Tab moves on and closes the popover instead.
    this.popover.setAttribute('role', 'dialog')
    this.popover.setAttribute('aria-label', 'Choose month and year')
    this.popover.hidden = true

    const head = document.createElement('div')
    head.className = 'rde-date-nav-head'

    const prevYear = document.createElement('button')
    prevYear.type = 'button'
    prevYear.className = 'rde-btn rde-date-nav-year-btn'
    prevYear.dataset.action = 'prev-year'
    prevYear.setAttribute('aria-label', 'Previous year')
    prevYear.textContent = '‹'

    this.yearEl = document.createElement('span')
    this.yearEl.className = 'rde-date-nav-year'
    this.yearEl.setAttribute('aria-live', 'polite')

    const nextYear = document.createElement('button')
    nextYear.type = 'button'
    nextYear.className = 'rde-btn rde-date-nav-year-btn'
    nextYear.dataset.action = 'next-year'
    nextYear.setAttribute('aria-label', 'Next year')
    nextYear.textContent = '›'

    head.append(prevYear, this.yearEl, nextYear)

    this.monthsEl = document.createElement('div')
    this.monthsEl.className = 'rde-date-nav-months'
    this.monthsEl.setAttribute('role', 'grid')

    const todayBtn = document.createElement('button')
    todayBtn.type = 'button'
    todayBtn.className = 'rde-btn rde-date-nav-today'
    todayBtn.dataset.action = 'today'
    todayBtn.textContent = 'Today'

    this.popover.append(head, this.monthsEl, todayBtn)
    cfg.host.append(this.trigger, this.popover)

    this.popover.addEventListener('click', (e) => {
      const t = e.target as HTMLElement
      const action = t.closest<HTMLElement>('[data-action]')?.dataset.action
      if (action === 'prev-year') {
        e.preventDefault()
        this.shiftYear(-1)
      } else if (action === 'next-year') {
        e.preventDefault()
        this.shiftYear(1)
      } else if (action === 'today') {
        e.preventDefault()
        this.cfg.onToday()
        this.close()
      }
      const monthBtn = t.closest<HTMLButtonElement>('[data-month]')
      if (monthBtn && !monthBtn.disabled) {
        e.preventDefault()
        const month = Number(monthBtn.dataset.month)
        this.cfg.onSelect(this.panelYear, month)
        this.close()
      }
    })

    // Non-modal popover: leaving it with Tab dismisses it rather than trapping focus
    this.popover.addEventListener('focusout', (e) => {
      if (!this.open) return
      const next = (e as FocusEvent).relatedTarget as Node | null
      // Focus lost to nothing (window blur) — keep the popover open
      if (!next) return
      if (this.cfg.host.contains(next)) return
      this.close(false)
    })

    this.syncTriggerLabel()
    this.renderPanel()
  }

  /** True while the popover is open */
  get isOpen(): boolean {
    return this.open
  }

  /**
   * True when an open navigator owns this event target.
   * Lets the calendar root ignore keys handled inside the navigator.
   */
  ownsEventTarget(target: EventTarget | null): boolean {
    if (!this.open || !target) return false
    return this.cfg.host.contains(target as Node)
  }

  /** Update trigger label from cursor date */
  syncTriggerLabel(): void {
    const cursor = this.cfg.getCursor()
    this.trigger.textContent = `${monthTitle(cursor, this.cfg.locale)} ▾`
    this.trigger.setAttribute('aria-label', `Current period: ${monthTitle(cursor, this.cfg.locale)}. Open date navigator`)
  }

  /** Refresh month grid when cursor or bounds change */
  refresh(): void {
    if (this.open) {
      const cursor = this.cfg.getCursor()
      this.panelYear = cursor.getFullYear()
    }
    this.syncTriggerLabel()
    this.renderPanel()
  }

  destroy(): void {
    this.close(false)
    document.removeEventListener('pointerdown', this.onDocPointer, true)
    document.removeEventListener('keydown', this.onDocKey, true)
    this.cfg.host.innerHTML = ''
  }

  private buildMonthLabels(locale: string): string[] {
    const fmt = new Intl.DateTimeFormat(locale, { month: 'short' })
    const labels: string[] = []
    for (let m = 0; m < 12; m++) {
      labels.push(fmt.format(new Date(2024, m, 1)))
    }
    return labels
  }

  private toggle(): void {
    if (this.open) this.close()
    else this.openPanel()
  }

  private openPanel(): void {
    const cursor = this.cfg.getCursor()
    this.panelYear = cursor.getFullYear()
    this.renderPanel()
    this.open = true
    this.focusBefore = document.activeElement as HTMLElement | null
    this.popover.hidden = false
    this.trigger.setAttribute('aria-expanded', 'true')
    document.addEventListener('pointerdown', this.onDocPointer, true)
    document.addEventListener('keydown', this.onDocKey, true)
    const first = this.focusableInPopover()[0]
    first?.focus()
  }

  private close(restoreFocus = true): void {
    if (!this.open) return
    this.open = false
    this.popover.hidden = true
    this.trigger.setAttribute('aria-expanded', 'false')
    document.removeEventListener('pointerdown', this.onDocPointer, true)
    document.removeEventListener('keydown', this.onDocKey, true)
    if (restoreFocus && this.focusBefore && typeof this.focusBefore.focus === 'function') {
      this.focusBefore.focus()
    }
    this.focusBefore = null
  }

  private shiftYear(dir: -1 | 1): void {
    const min = this.cfg.getMinDate()
    const max = this.cfg.getMaxDate()
    let next = this.panelYear + dir
    if (min) next = Math.max(next, min.getFullYear())
    if (max) next = Math.min(next, max.getFullYear())
    if (next === this.panelYear) return
    this.panelYear = next
    this.renderPanel()
    this.monthsEl.querySelector<HTMLButtonElement>('[data-month]:not([disabled])')?.focus()
  }

  private monthDisabled(year: number, month: number): boolean {
    const min = this.cfg.getMinDate()
    const max = this.cfg.getMaxDate()
    const monthStart = startOfMonth(new Date(year, month, 1))
    const monthEnd = startOfDay(new Date(year, month + 1, 0))
    if (min && monthEnd.getTime() < startOfDay(min).getTime()) return true
    if (max && monthStart.getTime() > startOfDay(max).getTime()) return true
    return false
  }

  private yearNavDisabled(dir: -1 | 1): boolean {
    const min = this.cfg.getMinDate()
    const max = this.cfg.getMaxDate()
    const target = this.panelYear + dir
    if (min && target < min.getFullYear()) return true
    if (max && target > max.getFullYear()) return true
    return false
  }

  private renderPanel(): void {
    this.yearEl.textContent = String(this.panelYear)
    const cursor = this.cfg.getCursor()
    const curMonth = cursor.getMonth()
    const curYear = cursor.getFullYear()

    const prevBtn = this.popover.querySelector<HTMLButtonElement>('[data-action="prev-year"]')
    const nextBtn = this.popover.querySelector<HTMLButtonElement>('[data-action="next-year"]')
    if (prevBtn) prevBtn.disabled = this.yearNavDisabled(-1)
    if (nextBtn) nextBtn.disabled = this.yearNavDisabled(1)

    const todayBtn = this.popover.querySelector<HTMLButtonElement>('[data-action="today"]')
    if (todayBtn) {
      const today = startOfDay(new Date())
      const min = this.cfg.getMinDate()
      const max = this.cfg.getMaxDate()
      const outOfBounds = Boolean(
        (min && today.getTime() < startOfDay(min).getTime()) ||
          (max && today.getTime() > startOfDay(max).getTime())
      )
      todayBtn.disabled = outOfBounds
    }

    this.monthsEl.innerHTML = ''
    for (let m = 0; m < 12; m++) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'rde-btn rde-date-nav-month'
      btn.dataset.month = String(m)
      btn.setAttribute('role', 'gridcell')
      btn.textContent = this.monthLabels[m]
      const disabled = this.monthDisabled(this.panelYear, m)
      btn.disabled = disabled
      if (disabled) btn.setAttribute('aria-disabled', 'true')
      if (this.panelYear === curYear && m === curMonth) {
        btn.classList.add('is-current')
        btn.setAttribute('aria-current', 'date')
      }
      this.monthsEl.appendChild(btn)
    }
  }

  private focusableInPopover(): HTMLElement[] {
    return [...this.popover.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )]
  }
}
