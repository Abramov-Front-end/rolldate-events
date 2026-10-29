/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it } from 'vitest'
import { RollDateEvents } from '../src/RollDateEvents'
import type { VisibleRange } from '../src/types'

describe('RollDateEvents accessibility ids', () => {
  const hosts: RollDateEvents[] = []

  afterEach(() => {
    while (hosts.length) hosts.pop()?.destroy()
    document.body.innerHTML = ''
  })

  it('assigns unique tab and panel ids per instance', () => {
    document.body.innerHTML = '<div id="cal-a"></div><div id="cal-b"></div>'
    const a = new RollDateEvents('#cal-a')
    const b = new RollDateEvents('#cal-b')
    hosts.push(a, b)

    const tabIds = [...document.querySelectorAll('[role="tab"]')].map((el) => el.id)
    expect(tabIds).toHaveLength(8)
    expect(new Set(tabIds).size).toBe(8)

    for (const host of ['#cal-a', '#cal-b']) {
      const panel = document.querySelector(`${host} [role="tabpanel"]`) as HTMLElement
      expect(panel.id).toBeTruthy()
      document.querySelectorAll(`${host} [role="tab"]`).forEach((tab) => {
        expect(tab.getAttribute('aria-controls')).toBe(panel.id)
      })
    }
  })

  it('destroy removes mounted DOM', () => {
    document.body.innerHTML = '<div id="cal"></div>'
    const cal = new RollDateEvents('#cal')
    expect(document.querySelector('#cal .rde')).toBeTruthy()
    cal.destroy()
    expect(document.querySelector('#cal .rde')).toBeNull()
    expect(document.getElementById('cal')?.innerHTML).toBe('')
  })

  it('onVisibleRangeChange is exclusive, aliased, and not repeated', async () => {
    document.body.innerHTML = '<div id="cal"></div>'
    const ranges: VisibleRange[] = []
    const cal = new RollDateEvents('#cal', {
      defaultView: 'week',
      defaultDate: new Date(2026, 8, 14),
      firstDayOfWeek: 1,
      onVisibleRangeChange: (range) => ranges.push(range)
    })
    hosts.push(cal)
    await Promise.resolve()
    await Promise.resolve()
    expect(ranges.length).toBeGreaterThanOrEqual(1)
    const first = ranges[0]
    expect(first.start?.getTime()).toBe(first.from.getTime())
    expect(first.end?.getTime()).toBe(first.to.getTime())
    expect(first.view).toBe('week')
    expect(first.to.getTime()).toBeGreaterThan(first.from.getTime())
    const n = ranges.length
    cal.setDate(new Date(2026, 8, 16))
    expect(ranges.length).toBe(n)
    cal.next()
    expect(ranges.length).toBeGreaterThan(n)
    const last = ranges[ranges.length - 1]
    expect(last.start?.getTime()).toBe(last.from.getTime())
    expect(last.end?.getTime()).toBe(last.to.getTime())
  })

  it('week has no vertical pan when the hour band fits', async () => {
    document.body.innerHTML = '<div id="cal"></div>'
    const cal = new RollDateEvents('#cal', {
      defaultView: 'week',
      defaultDate: new Date(2026, 8, 14),
      visibleHours: { start: 8, end: 18 }
    })
    hosts.push(cal)
    await Promise.resolve()
    await Promise.resolve()
    const pane = document.querySelector('.rde-timegrid--week') as HTMLElement
    expect(pane).toBeTruthy()
    expect(pane.classList.contains('is-pan-y')).toBe(false)
    const strip = pane.querySelector('.rde-strip') as HTMLElement
    const before = strip.style.transform
    pane.dispatchEvent(new WheelEvent('wheel', { deltaY: 80, bubbles: true, cancelable: true }))
    expect(strip.style.transform).toBe(before)
  })
})
