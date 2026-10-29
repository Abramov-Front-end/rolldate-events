/**
 * Pro Resource Timeline — day-based strip.
 * Horizontal and vertical motion use translate3d (no native scrollbars).
 */

import type { LayoutPatch, NormalizedEvent, View, ViewContext, VisibleRange } from '../types'
import { addDays, dayKey, formatTime, parseDayKey, sameDay, startOfDay } from '../utils/date'
import { escapeAttr, escapeHtml } from '../utils/dom'
import { dateToDayIndex, dayIndexToDate, TranslateStrip } from '../utils/infiniteScroll'
import {
  BoundPan,
  bindPanKeys,
  panChromeHtml,
  routePanWheel,
  syncPanHints
} from '../utils/panScroll'
import {
  layoutTimelineLane,
  TIMELINE_LANE_PX,
  timelineBlockTop,
  timelineRowHeight
} from '../utils/timelineLayout'
import { eventEditableAttr, isEventEditable } from '../utils/eventEditable'
import { resizeHandlesHtml } from './timeGrid'
import {
  TIMELINE_BUFFER_DAYS,
  TIMELINE_VISIBLE_DAYS,
  formatTimelineTitle,
  timelineAxisWidth,
  timelineDayPx,
  timelineLabelPx,
  timelineVisibleFromScroll
} from '../utils/timelineRange'

/** resourceId only when the open-day control itself sits on a resource row. */
function resourceIdFromOpenDay(openEl: HTMLElement): string | undefined {
  const id = openEl.closest<HTMLElement>('[data-resource]')?.dataset.resource
  return id || undefined
}

export class TimelineView implements View {
  readonly name = 'timeline' as const
  private ctx: ViewContext | null = null
  private host: HTMLElement | null = null
  private strip: TranslateStrip | null = null
  private dayPx = 128
  private labelPx = 140
  private bufferStart: Date | null = null
  private bufferDays = TIMELINE_BUFFER_DAYS + TIMELINE_VISIBLE_DAYS + TIMELINE_BUFFER_DAYS
  private lastVisibleKey = ''
  private lastTransform = 'translate3d(0px, 0, 0)'
  private lastOffset = 0
  private yPan: BoundPan | null = null
  private unbindKeys: (() => void) | null = null
  private previewResources = new Set<string>()

  render(ctx: ViewContext): void {
    this.destroy()
    this.ctx = ctx
    this.host = ctx.root
    this.labelPx = timelineLabelPx(ctx.compact)
    this.dayPx = timelineDayPx(ctx.layoutWidth, ctx.compact)
    this.host.innerHTML = this.shellHtml()
    this.host.addEventListener('click', this.onClick)
    this.host.addEventListener('wheel', this.onWheel, { passive: false })

    const viewport = this.scroller()
    const heads = this.host.querySelector<HTMLElement>('.rde-tl-heads')
    const body = this.host.querySelector<HTMLElement>('[data-tl-body]')
    const rows = this.host.querySelector<HTMLElement>('[data-tl-rows]')
    if (!viewport || !heads) return
    if (body && rows) {
      this.yPan = new BoundPan(body, rows, () => this.refreshPanHints())
    }
    this.unbindKeys = bindPanKeys(viewport, {
      canX: () => true,
      canY: () => this.yPan?.canScroll() === true,
      nudgeX: (delta) => this.strip?.nudgeBy(delta),
      nudgeY: (delta) => this.yPan?.nudge(delta)
    })

    this.strip = new TranslateStrip(
      viewport,
      heads,
      {
        axis: 'x',
        wheelEnabled: false,
        segmentSize: this.dayPx,
        bufferSize: TIMELINE_BUFFER_DAYS * 2 + TIMELINE_VISIBLE_DAYS,
        prefetchSegments: 2,
        viewInset: this.labelPx,
        minIndex: ctx.minDayIndex,
        maxIndex: ctx.maxDayIndex
      },
      {
        paint: (start, count) => this.paint(start, count),
        onSettle: () => this.emitVisible(false),
        onRangeChange: () => this.emitVisible(true),
        insertStart: (from, n) => this.insertDays(from, n, 'start'),
        insertEnd: (from, n) => this.insertDays(from, n, 'end'),
        removeStart: (n) => this.removeDays(n, 'start'),
        removeEnd: (n) => this.removeDays(n, 'end'),
        onSegmentSize: (size) => {
          this.dayPx = size
          if (this.strip) this.paint(this.strip.state.startIndex, this.strip.state.count)
        },
        onApply: (transform, offset) => this.applyTransform(transform, offset)
      }
    )
    this.strip.reset(dateToDayIndex(startOfDay(ctx.cursor)), { align: 'start' })
    this.strip.start()
    this.fitPane()
  }

  syncEvents(events: NormalizedEvent[]): void {
    if (!this.ctx || !this.host) return
    this.ctx = { ...this.ctx, events }
    this.refreshChips()
  }

  goToDate(date: Date): void {
    if (!this.ctx || !this.strip) return
    this.ctx = { ...this.ctx, cursor: startOfDay(date) }
    this.strip.reset(dateToDayIndex(startOfDay(date)), { align: 'start' })
    this.emitVisible(true)
  }

  applyLayout(patch: LayoutPatch): void {
    if (!this.ctx || !this.strip) return
    this.ctx = { ...this.ctx, compact: patch.compact, layoutWidth: patch.layoutWidth }
    this.labelPx = timelineLabelPx(this.ctx.compact)
    const nextPx = timelineDayPx(this.ctx.layoutWidth, this.ctx.compact)
    if (Math.abs(nextPx - this.dayPx) >= 4) this.strip.setSegmentSize(nextPx)
  }

  nudgeStrip(delta: number): void {
    this.strip?.nudgeBy(delta)
  }

  scrollTimeBand(delta: number): void {
    this.yPan?.nudge(-delta)
  }

  previewTimedMove(
    id: string,
    start: Date,
    end: Date,
    _originDay: Date,
    resourceId?: string,
    _clientY?: number,
    resize?: boolean
  ): { top: number; height: number; leftPct: number; widthPct: number; order?: number } | null {
    if (!this.host || !this.bufferStart || !this.ctx) return null
    const moving = this.ctx.events.find((ev) => String(ev.occurrenceId || ev.id) === id)
    if (!moving) return null
    const originRes = String(moving.resourceId || '')
    const targetRes = resize
      ? originRes
      : resourceId != null
        ? String(resourceId)
        : originRes
    const previewEvent: NormalizedEvent = { ...moving, start, end, resourceId: targetRes }
    const affected = new Set<string>([originRes, targetRes, ...this.previewResources])
    this.host.querySelectorAll('.rde-tg-slot, .rde-tl-live').forEach((el) => el.remove())
    let slot: { top: number; height: number; leftPct: number; widthPct: number; order?: number } | null =
      null
    for (const resId of affected) {
      const events = this.ctx.events
        .filter((ev) => {
          const eid = String(ev.occurrenceId || ev.id)
          if (eid === id) return resId === targetRes
          return String(ev.resourceId || '') === resId
        })
        .map((ev) => (String(ev.occurrenceId || ev.id) === id ? previewEvent : ev))
      const found = this.paintLiveRow(resId, events, id, resId === targetRes, Boolean(resize))
      if (resId === targetRes && found) slot = found
    }
    this.previewResources = new Set([originRes, targetRes])
    return slot
  }

  clearTimedPreview(): void {
    this.previewResources.clear()
    if (!this.host || !this.ctx) return
    this.host.querySelectorAll('.rde-tg-slot, .rde-tl-live').forEach((el) => el.remove())
    this.refreshChips()
  }

  private paintLiveRow(
    resourceId: string,
    events: NormalizedEvent[],
    movingId: string,
    showSlot: boolean,
    keepMoving: boolean
  ): { top: number; height: number; leftPct: number; widthPct: number } | null {
    if (!this.host || !this.bufferStart || !this.ctx) return null
    const row = [...this.host.querySelectorAll<HTMLElement>('.rde-tl-row[data-resource]')].find(
      (el) => (el.dataset.resource || '') === resourceId
    )
    const track = row?.querySelector<HTMLElement>('.rde-tl-track[data-resource]')
    if (!row || !track) return null
    const rangeEnd = addDays(this.bufferStart, this.bufferDays)
    const blocks = layoutTimelineLane(events, this.bufferStart, rangeEnd, this.dayPx)
    const lanes = Math.max(1, ...blocks.map((b) => b.lanes), 1)
    const height = timelineRowHeight(lanes)
    row.style.height = `${height}px`
    track.style.height = `${height}px`
    const byId = new Map(blocks.map((b) => [String(b.event.occurrenceId || b.event.id), b]))
    track.querySelectorAll<HTMLElement>('.rde-tl-event[data-event-id]').forEach((el) => {
      if (el.classList.contains('rde-tl-live')) return
      const eid = el.dataset.eventId || ''
      const b = byId.get(eid)
      if (eid === movingId && !keepMoving) {
        el.style.opacity = '0'
        el.style.pointerEvents = 'none'
        return
      }
      if (!b) {
        el.style.opacity = '0'
        return
      }
      el.style.left = `${b.left}px`
      el.style.width = `${b.width}px`
      el.style.top = `${timelineBlockTop(b.lane)}px`
      el.style.height = `${TIMELINE_LANE_PX}px`
      el.style.opacity = keepMoving && eid === movingId ? '1' : ''
      el.style.pointerEvents = eid === movingId ? 'none' : ''
    })
    const mine = byId.get(movingId)
    if (!mine || !showSlot) return null
    const top = timelineBlockTop(mine.lane)
    const color = mine.event.color || 'var(--rde-accent)'
    const mark = document.createElement('div')
    mark.className = 'rde-tg-slot'
    mark.style.left = `${mine.left}px`
    mark.style.width = `${mine.width}px`
    mark.style.top = `${top}px`
    mark.style.height = `${TIMELINE_LANE_PX}px`
    mark.style.setProperty('--rde-event-color', color)
    track.appendChild(mark)
    return { top, height: TIMELINE_LANE_PX, leftPct: 0, widthPct: 100 }
  }

  getBuffer(): { start: Date; days: number; dayPx: number } | null {
    if (!this.bufferStart) return null
    return { start: this.bufferStart, days: this.bufferDays, dayPx: this.dayPx }
  }

  getOffset(): number {
    return this.strip?.state.offset ?? this.lastOffset
  }

  prependDays(days: number): void {
    this.strip?.prepend(days)
  }

  appendDays(days: number): void {
    this.strip?.append(days)
  }

  destroy(): void {
    this.strip?.stop()
    this.strip = null
    this.unbindKeys?.()
    this.unbindKeys = null
    this.yPan = null
    this.host?.removeEventListener('click', this.onClick)
    this.host?.removeEventListener('wheel', this.onWheel)
    if (this.host) this.host.innerHTML = ''
    this.host = null
    this.ctx = null
    this.bufferStart = null
    this.lastVisibleKey = ''
  }

  private scroller(): HTMLElement | null {
    return this.host?.querySelector<HTMLElement>('.rde-tl') ?? null
  }

  private onWheel = (e: WheelEvent): void => {
    if (!this.strip) return
    const route = routePanWheel(e, true, this.yPan?.canScroll() === true)
    if (!route) return
    e.preventDefault()
    if (route.axis === 'x') this.strip.nudgeBy(route.delta)
    else this.yPan?.nudge(route.delta)
    this.refreshPanHints()
  }

  private fitPane(): void {
    const root = this.scroller()
    const body = this.host?.querySelector<HTMLElement>('[data-tl-body]')
    const rows = this.host?.querySelector<HTMLElement>('[data-tl-rows]')
    const head = this.host?.querySelector<HTMLElement>('.rde-tl-head')
    if (!root || !body || !rows) return
    const max = 680
    const headH = head?.offsetHeight || 0
    const rowsH = rows.scrollHeight || rows.offsetHeight
    root.style.height = headH + rowsH > max ? `${max}px` : ''
    this.yPan?.setOffset(this.yPan.offset)
    this.refreshPanHints()
  }

  private refreshPanHints(): void {
    const root = this.scroller()
    if (!root) return
    const y = this.yPan
    syncPanHints(root, {
      canX: true,
      canY: y?.canScroll() === true,
      yAtStart: y?.atStart() !== false,
      yAtEnd: y?.atEnd() !== false
    })
  }

  private applyTransform(transform: string, offset: number): void {
    this.lastTransform = transform
    this.lastOffset = offset
    if (!this.host) return
    this.host.querySelectorAll<HTMLElement>('.rde-tl-heads, .rde-tl-track').forEach((el) => {
      el.style.transform = transform
    })
    const root = this.scroller()
    if (root) root.dataset.offset = String(offset)
  }

  private paint(startIndex: number, count: number): void {
    if (!this.host || !this.ctx) return
    const y = this.yPan?.offset ?? 0
    this.bufferStart = dayIndexToDate(startIndex)
    this.bufferDays = count
    const heads = this.host.querySelector('.rde-tl-heads')
    const rows = this.host.querySelector('.rde-tl-rows')
    if (heads) heads.innerHTML = this.daysHtml(this.bufferStart, count, 'head')
    if (rows) rows.innerHTML = this.rowsHtml(this.ctx, this.bufferStart, count)
    this.syncRootMetrics()
    this.applyTransform(this.lastTransform, this.lastOffset)
    this.yPan?.setOffset(y)
    this.fitPane()
  }

  private refreshChips(): void {
    if (!this.host || !this.ctx || !this.bufferStart) return
    const y = this.yPan?.offset ?? 0
    const rows = this.host.querySelector('.rde-tl-rows')
    if (rows) rows.innerHTML = this.rowsHtml(this.ctx, this.bufferStart, this.bufferDays)
    this.applyTransform(this.lastTransform, this.lastOffset)
    this.yPan?.setOffset(y)
    this.fitPane()
  }

  private insertDays(fromAbs: number, n: number, where: 'start' | 'end'): void {
    if (!this.host || !this.bufferStart) return
    const days = Array.from({ length: n }, (_, i) => dayIndexToDate(fromAbs + i))
    const heads = this.host.querySelector('.rde-tl-heads')
    const markup = this.daysHtml(days[0], n, 'head')
    if (heads) {
      if (where === 'start') heads.insertAdjacentHTML('afterbegin', markup)
      else heads.insertAdjacentHTML('beforeend', markup)
    }
    this.host.querySelectorAll('.rde-tl-grid').forEach((grid) => {
      const cols = this.daysHtml(days[0], n, 'grid')
      if (where === 'start') grid.insertAdjacentHTML('afterbegin', cols)
      else grid.insertAdjacentHTML('beforeend', cols)
    })
    if (where === 'start') {
      this.bufferStart = dayIndexToDate(fromAbs)
      this.shiftEventLeft(n * this.dayPx)
    }
    this.bufferDays += n
    this.syncRootMetrics()
  }

  private removeDays(n: number, where: 'start' | 'end'): void {
    if (!this.host || !this.bufferStart) return
    const removeKids = (parent: Element): void => {
      for (let i = 0; i < n; i++) {
        const child = where === 'start' ? parent.firstElementChild : parent.lastElementChild
        child?.remove()
      }
    }
    const heads = this.host.querySelector('.rde-tl-heads')
    if (heads) removeKids(heads)
    this.host.querySelectorAll('.rde-tl-grid').forEach(removeKids)
    if (where === 'start') {
      this.bufferStart = addDays(this.bufferStart, n)
      this.shiftEventLeft(-n * this.dayPx)
    }
    this.bufferDays = Math.max(1, this.bufferDays - n)
    this.syncRootMetrics()
  }

  private shiftEventLeft(delta: number): void {
    this.host?.querySelectorAll<HTMLElement>('.rde-tl-event').forEach((el) => {
      el.style.left = `${(parseFloat(el.style.left) || 0) + delta}px`
    })
  }

  private syncRootMetrics(): void {
    const root = this.scroller()
    if (!root || !this.bufferStart) return
    const axis = timelineAxisWidth(this.dayPx, this.bufferDays)
    root.dataset.rangeStart = dayKey(this.bufferStart)
    root.dataset.dayPx = String(this.dayPx)
    root.dataset.labelPx = String(this.labelPx)
    root.dataset.days = String(this.bufferDays)
    root.dataset.offset = String(this.lastOffset)
    root.style.setProperty('--rde-tl-day-px', `${this.dayPx}px`)
    root.style.setProperty('--rde-tl-label-px', `${this.labelPx}px`)
    root.style.setProperty('--rde-tl-axis', `${axis}px`)
  }

  private visibleRange(): VisibleRange {
    const start = this.bufferStart || startOfDay(this.ctx?.cursor || new Date())
    const inner = Math.max(1, (this.scroller()?.clientWidth || 0) - this.labelPx)
    const range = timelineVisibleFromScroll(start, -this.lastOffset, this.dayPx, inner)
    return { from: range.start, to: range.end }
  }

  private emitVisible(force: boolean): void {
    if (!this.ctx) return
    const range = this.visibleRange()
    const key = `${range.from.getTime()}:${range.to.getTime()}`
    if (!force && key === this.lastVisibleKey) return
    this.lastVisibleKey = key
    this.ctx.onRangeChange(range)
    this.ctx.onAnchorChange(range.from)
    const scroller = this.scroller()
    if (scroller) {
      scroller.setAttribute('aria-label', formatTimelineTitle(range.from, range.to, this.ctx.locale))
    }
  }

  private shellHtml(): string {
    return `<div class="rde-tl rde-pan" tabindex="0" data-range-start="" data-day-px="${this.dayPx}" data-label-px="${this.labelPx}" data-days="0" data-offset="0" style="--rde-tl-day-px:${this.dayPx}px;--rde-tl-label-px:${this.labelPx}px;--rde-tl-axis:0px"><div class="rde-tl-head"><div class="rde-tl-corner"></div><div class="rde-tl-axis-vp"><div class="rde-tl-heads"></div></div></div><div class="rde-tl-body" data-tl-body><div class="rde-tl-rows" data-tl-rows></div></div>${panChromeHtml(this.ctx?.locale || 'en')}</div>`
  }

  private daysHtml(start: Date, count: number, kind: 'head' | 'grid'): string {
    const today = new Date()
    return Array.from({ length: count }, (_, i) => {
      const d = addDays(start, i)
      const weekend = d.getDay() === 0 || d.getDay() === 6
      const extras = `${sameDay(d, today) ? ' is-today' : ''}${weekend ? ' is-weekend' : ''}`
      if (kind === 'grid') {
        return `<div class="rde-tl-grid-col${extras}" data-day="${dayKey(d)}"></div>`
      }
      const label = new Intl.DateTimeFormat(this.ctx?.locale || 'en', {
        weekday: 'short',
        day: 'numeric'
      }).format(d)
      return `<button type="button" class="rde-tl-day rde-open-day${extras}" data-open-day="${dayKey(d)}" data-day="${dayKey(d)}">${escapeHtml(label)}</button>`
    }).join('')
  }

  private rowsHtml(ctx: ViewContext, start: Date, count: number): string {
    const end = addDays(start, count)
    const grid = this.daysHtml(start, count, 'grid')
    const resources = ctx.resources.length
      ? ctx.resources
      : [{ id: '', title: 'Unassigned' }]
    return resources
      .map((res) => {
        const evs = ctx.events.filter((ev) => String(ev.resourceId || '') === String(res.id))
        const blocks = layoutTimelineLane(evs, start, end, this.dayPx)
        const lanes = Math.max(1, ...blocks.map((b) => b.lanes), 1)
        const height = timelineRowHeight(lanes)
        const chips = blocks
          .map((b) => {
            const id = String(b.event.occurrenceId || b.event.id)
            const color = b.event.color || res.color || 'var(--rde-event-default)'
            const time = b.event.allDay ? 'All day' : formatTime(b.event.start, ctx.locale)
            const top = timelineBlockTop(b.lane)
            const tip = `${b.event.title} · ${time}`
            const extras = [
              b.daySpan ? 'is-day-span' : '',
              b.event.allDay ? 'is-all-day' : '',
              b.continuesStart ? 'is-continues-start' : '',
              b.continuesEnd ? 'is-continues-end' : ''
            ]
              .filter(Boolean)
              .join(' ')
            const handles = isEventEditable(b.event, ctx.editable) ? resizeHandlesHtml('ew') : ''
            return `<button type="button" class="rde-tl-event${extras ? ` ${extras}` : ''}" data-event-id="${escapeAttr(id)}" data-editable="${eventEditableAttr(b.event, ctx.editable)}" style="--rde-event-color:${escapeAttr(color)};left:${b.left}px;width:${b.width}px;top:${top}px;height:${TIMELINE_LANE_PX}px" title="${escapeAttr(tip)}"><span class="rde-tl-event__title">${escapeHtml(b.event.title)}</span><small>${escapeHtml(time)}</small>${handles}</button>`
          })
          .join('')
        return `<div class="rde-tl-row" data-resource="${escapeAttr(res.id)}" style="height:${height}px"><div class="rde-tl-label">${escapeHtml(res.title)}</div><div class="rde-tl-track-clip"><div class="rde-tl-track" data-resource="${escapeAttr(res.id)}" style="height:${height}px;transform:${this.lastTransform}"><div class="rde-tl-grid">${grid}</div>${chips}</div></div></div>`
      })
      .join('')
  }

  private onClick = (e: MouseEvent): void => {
    if (!this.ctx || !this.bufferStart) return
    const t = e.target as HTMLElement
    if (t.closest('.rde-block--ghost, .rde-tl-live')) return
    const eventBtn = t.closest<HTMLElement>('.rde-tl-event[data-event-id]')
    if (eventBtn?.dataset.eventId) {
      const ev = this.ctx.getEvent(eventBtn.dataset.eventId)
      if (ev) {
        e.stopPropagation()
        this.ctx.onEventClick(ev, e)
      }
      return
    }
    if (t.closest('[data-resize]')) return
    const openEl = t.closest<HTMLElement>('[data-open-day]')
    if (openEl?.dataset.openDay) {
      e.stopPropagation()
      const resourceId = resourceIdFromOpenDay(openEl)
      this.ctx.onDayOpen(
        parseDayKey(openEl.dataset.openDay),
        resourceId ? { resourceId } : undefined
      )
      return
    }
    const dayEl = t.closest<HTMLElement>('[data-day]')
    if (dayEl?.dataset.day) {
      const [y, m, d] = dayEl.dataset.day.split('-').map(Number)
      this.ctx.onDateClick(new Date(y, m - 1, d), e)
    }
  }
}
