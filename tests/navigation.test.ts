/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it } from 'vitest'
import { RollDateEvents } from '../src/RollDateEvents'

describe('RollDateEvents navigation', () => {
  const hosts: RollDateEvents[] = []

  afterEach(() => {
    while (hosts.length) hosts.pop()?.destroy()
    document.body.innerHTML = ''
  })

  function mount(view: 'month' | 'week' | 'day' | 'agenda' = 'month') {
    document.body.innerHTML = '<div id="cal"></div>'
    const cal = new RollDateEvents('#cal', {
      defaultDate: '2026-08-15',
      defaultView: view
    })
    hosts.push(cal)
    return cal
  }

  it('prev/next shift month in month view', () => {
    const cal = mount('month')
    expect(cal.getDate().getMonth()).toBe(7)
    cal.next()
    expect(cal.getDate().getFullYear()).toBe(2026)
    expect(cal.getDate().getMonth()).toBe(8)
    cal.prev()
    expect(cal.getDate().getMonth()).toBe(7)
  })

  it('crosses year boundary', () => {
    const cal = mount('month')
    cal.setDate(new Date(2026, 11, 1))
    cal.next()
    expect(cal.getDate().getFullYear()).toBe(2027)
    expect(cal.getDate().getMonth()).toBe(0)
  })

  it('setView and getView stay in sync', () => {
    const cal = mount('month')
    expect(cal.getView()).toBe('month')
    cal.setView('agenda')
    expect(cal.getView()).toBe('agenda')
    expect(cal.currentView).toBe('agenda')
  })

  it('clamps navigation to minDate/maxDate', () => {
    document.body.innerHTML = '<div id="cal"></div>'
    const cal = new RollDateEvents('#cal', {
      defaultDate: '2026-08-15',
      minDate: '2026-08-01',
      maxDate: '2026-09-30'
    })
    hosts.push(cal)
    cal.setDate(new Date(2026, 8, 1))
    cal.next()
    expect(cal.getDate().getMonth()).toBe(8)
    cal.prev()
    cal.prev()
    expect(cal.getDate().getMonth()).toBe(7)
  })

  it('handles leap year February in day view', () => {
    const cal = mount('day')
    cal.setDate(new Date(2024, 1, 29))
    expect(cal.getDate().getMonth()).toBe(1)
    expect(cal.getDate().getDate()).toBe(29)
  })
})
