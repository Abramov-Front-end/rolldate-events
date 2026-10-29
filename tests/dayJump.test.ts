/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it } from 'vitest'
import { RollDateEvents } from '../src/RollDateEvents'
import { TimelineView } from '../src/views/TimelineView'
import { buildDayOpenInfo, type DayOpenInfo, type NormalizedEvent, type ViewContext } from '../src/types'

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 40; i++) {
    if (predicate()) return
    await tick()
  }
  throw new Error(`timed out waiting for ${label}`)
}

const hosts: RollDateEvents[] = []

afterEach(() => {
  while (hosts.length) hosts.pop()?.destroy()
  document.body.innerHTML = ''
})

function fireKey(el: HTMLElement, key: string): void {
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  if (key === 'Enter' || key === ' ') {
    el.click()
  }
}

describe('Day jump from date headers', () => {
  it('opens Day from a Week header and keeps events after returning', async () => {
    document.body.innerHTML = '<div id="cal"></div>'
    const opens: DayOpenInfo[] = []
    const cal = new RollDateEvents('#cal', {
      defaultView: 'week',
      defaultDate: new Date(2026, 8, 14),
      firstDayOfWeek: 1,
      events: [{ id: 1, title: 'Standup', start: '2026-09-16T10:00:00', end: '2026-09-16T11:00:00' }],
      onDayOpen: (info) => opens.push(info)
    })
    hosts.push(cal)
    await Promise.resolve()
    await Promise.resolve()
    const head = document.querySelector<HTMLElement>('[data-open-day="2026-09-16"]')
    expect(head).toBeTruthy()
    head!.click()
    await waitFor(() => cal.getView() === 'day', 'day view')
    expect(opens[0]?.view).toBe('week')
    expect(opens[0]?.date.getDate()).toBe(16)
    expect(cal.getDate().getDate()).toBe(16)
    expect(document.querySelector('.rde-timegrid--day')).toBeTruthy()
    cal.setView('week')
    await waitFor(() => cal.getView() === 'week', 'back to week')
    expect(cal.getEvents()).toHaveLength(1)
    expect(cal.getEvents()[0].title).toBe('Standup')
  })

  it('opens Day from an Agenda date and supports Enter/Space', async () => {
    document.body.innerHTML = '<div id="cal"></div>'
    const opens: DayOpenInfo[] = []
    const cal = new RollDateEvents('#cal', {
      defaultView: 'agenda',
      defaultDate: new Date(2026, 8, 14),
      events: [{ id: 1, title: 'A', start: '2026-09-15T10:00:00', end: '2026-09-15T11:00:00' }],
      onDayOpen: (info) => opens.push(info)
    })
    hosts.push(cal)
    await waitFor(() => !!document.querySelector('[data-open-day="2026-09-15"]'), 'agenda date')
    const dateBtn = document.querySelector<HTMLElement>('[data-open-day="2026-09-15"]')!
    expect(dateBtn.querySelector('.rde-open-day__hint')?.textContent).toBe('Open day')
    fireKey(dateBtn, 'Enter')
    await waitFor(() => cal.getView() === 'day', 'day after enter')
    expect(opens[0]?.view).toBe('agenda')
    expect(opens[0]?.date.getDate()).toBe(15)
    expect(cal.getDate().getDate()).toBe(15)

    cal.setView('agenda')
    await waitFor(() => !!document.querySelector('[data-open-day="2026-09-15"]'), 'agenda again')
    fireKey(document.querySelector<HTMLElement>('[data-open-day="2026-09-15"]')!, ' ')
    await waitFor(() => cal.getView() === 'day', 'day after space')
  })

  it('opens Day from a Month day number; empty cell keeps onDateClick', async () => {
    document.body.innerHTML = '<div id="cal"></div>'
    const dates: Date[] = []
    const opens: DayOpenInfo[] = []
    const cal = new RollDateEvents('#cal', {
      defaultView: 'month',
      defaultDate: new Date(2026, 8, 14),
      events: [],
      onDateClick: (date) => dates.push(date),
      onDayOpen: (info) => opens.push(info)
    })
    hosts.push(cal)
    await Promise.resolve()
    await Promise.resolve()
    const num = document.querySelector<HTMLElement>('[data-open-day="2026-09-16"]')
    expect(num).toBeTruthy()
    num!.click()
    await waitFor(() => cal.getView() === 'day', 'day from month')
    expect(dates).toHaveLength(0)
    expect(opens[0]?.view).toBe('month')
    expect(opens[0]?.date.getDate()).toBe(16)
    expect(cal.getDate().getDate()).toBe(16)

    cal.setView('month')
    await waitFor(() => !!document.querySelector('.rde-day[data-day="2026-09-18"]'), 'month again')
    const cell = document.querySelector<HTMLElement>('.rde-day[data-day="2026-09-18"]')!
    cell.click()
    expect(dates.some((d) => d.getDate() === 18)).toBe(true)
    expect(cal.getView()).toBe('month')
  })

  it('keeps event clicks on the event callback', async () => {
    document.body.innerHTML = '<div id="cal"></div>'
    const titles: string[] = []
    const cal = new RollDateEvents('#cal', {
      defaultView: 'agenda',
      defaultDate: new Date(2026, 8, 15),
      events: [{ id: 1, title: 'Talk', start: '2026-09-15T10:00:00', end: '2026-09-15T11:00:00' }],
      onEventClick: (event) => titles.push(event.title)
    })
    hosts.push(cal)
    await waitFor(() => !!document.querySelector('[data-event-id]'), 'event row')
    document.querySelector<HTMLElement>('[data-event-id]')!.click()
    expect(titles).toEqual(['Talk'])
    expect(cal.getView()).toBe('agenda')
  })
})

describe('onDayOpen.view is the source view', () => {
  it('never reports the destination day, including from Timeline', () => {
    const day = new Date(2026, 8, 16)
    expect(buildDayOpenInfo(day, 'timeline')?.view).toBe('timeline')
    expect(buildDayOpenInfo(day, 'agenda')?.view).toBe('agenda')
    expect(buildDayOpenInfo(day, 'week')?.view).toBe('week')
    expect(buildDayOpenInfo(day, 'month')?.view).toBe('month')
    expect(buildDayOpenInfo(day, 'day')).toBeNull()
    expect(buildDayOpenInfo(day, 'timeline')?.resourceId).toBeUndefined()
    expect(buildDayOpenInfo(day, 'timeline', 'room')?.resourceId).toBe('room')
    expect(buildDayOpenInfo(day, 'timeline', '')?.resourceId).toBeUndefined()
  })
})

describe('Timeline day header', () => {
  function mountTimeline(extra: Partial<ViewContext> = {}): {
    root: HTMLElement
    view: TimelineView
    opened: Array<{ date: Date; resourceId?: string }>
    dates: Date[]
    titles: string[]
    context: ViewContext
  } {
    const root = document.createElement('div')
    const view = new TimelineView()
    const opened: Array<{ date: Date; resourceId?: string }> = []
    const dates: Date[] = []
    const titles: string[] = []
    const events: NormalizedEvent[] = [
      {
        id: 'a',
        title: 'A',
        start: new Date(2026, 8, 14, 9, 0),
        end: new Date(2026, 8, 14, 10, 0),
        resourceId: 'room'
      }
    ]
    const context: ViewContext = {
      root,
      cursor: new Date(2026, 8, 14),
      locale: 'en-US',
      firstDayOfWeek: 1,
      theme: 'light',
      compact: false,
      layoutWidth: 800,
      eventLimit: 4,
      visibleHours: { start: 8, end: 18 },
      isDateDisabled: () => false,
      events,
      getEvent: (id) => events.find((e) => String(e.id) === id),
      resources: [
        { id: 'room', title: 'Room A' },
        { id: 'ira', title: 'Ira' }
      ],
      editable: true,
      onEventClick: (event) => titles.push(event.title),
      onDateClick: (date) => dates.push(date),
      onDayOpen: (date, info) => opened.push({ date, resourceId: info?.resourceId }),
      onEventMove: () => undefined,
      onAnchorChange: () => undefined,
      onRangeChange: () => undefined,
      ...extra
    }
    view.render(context)
    return { root, view, opened, dates, titles, context }
  }

  it('opens the shared day header without inventing a resourceId', () => {
    const { root, view, opened, dates } = mountTimeline()
    const head = root.querySelector<HTMLElement>('.rde-tl-day[data-open-day="2026-09-16"]')
    expect(head).toBeTruthy()
    expect(head!.closest('[data-resource]')).toBeNull()
    head!.click()
    expect(opened).toHaveLength(1)
    expect(opened[0]?.date.getDate()).toBe(16)
    expect(opened[0]?.resourceId).toBeUndefined()
    expect(dates).toHaveLength(0)
    view.destroy()
  })

  it('passes resourceId only from an open-day control on a resource row', () => {
    const { root, view, opened } = mountTimeline()
    const row = root.querySelector<HTMLElement>('.rde-tl-row[data-resource="ira"]')
    expect(row).toBeTruthy()
    const btn = document.createElement('button')
    btn.dataset.openDay = '2026-09-16'
    row!.appendChild(btn)
    btn.click()
    expect(opened).toHaveLength(1)
    expect(opened[0]?.resourceId).toBe('ira')
    view.destroy()
  })

  it('keeps empty grid cells on onDateClick', () => {
    const { root, view, opened, dates } = mountTimeline()
    const col = root.querySelector<HTMLElement>('.rde-tl-grid-col[data-day="2026-09-16"]')
    expect(col).toBeTruthy()
    expect(col!.hasAttribute('data-open-day')).toBe(false)
    col!.click()
    expect(dates[0]?.getDate()).toBe(16)
    expect(opened).toHaveLength(0)
    view.destroy()
  })

  it('does not open Day from an event chip or a resize handle', () => {
    const { root, view, opened, dates, titles } = mountTimeline()
    const chip = root.querySelector<HTMLElement>('.rde-tl-event[data-event-id="a"]')
    expect(chip).toBeTruthy()
    chip!.click()
    expect(titles).toEqual(['A'])
    expect(opened).toHaveLength(0)
    expect(dates).toHaveLength(0)

    const handle = root.querySelector<HTMLElement>('.rde-tl-event [data-resize="end"]')
    expect(handle).toBeTruthy()
    handle!.click()
    expect(opened).toHaveLength(0)
    expect(dates).toHaveLength(0)
    view.destroy()
  })
})
