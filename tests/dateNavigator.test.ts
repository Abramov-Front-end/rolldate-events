/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it } from 'vitest'
import { RollDateEvents } from '../src/RollDateEvents'
import { startOfDay } from '../src/utils/date'

describe('Date navigator', () => {
  const hosts: RollDateEvents[] = []

  afterEach(() => {
    while (hosts.length) hosts.pop()?.destroy()
    document.body.innerHTML = ''
  })

  function mount(opts: ConstructorParameters<typeof RollDateEvents>[1] = {}) {
    document.body.innerHTML = '<div id="cal" style="width:400px"></div>'
    const cal = new RollDateEvents('#cal', {
      defaultDate: '2026-08-15',
      defaultView: 'month',
      ...opts
    })
    hosts.push(cal)
    return cal
  }

  it('renders an accessible date navigator trigger', () => {
    mount()
    const trigger = document.querySelector('.rde-date-nav-trigger') as HTMLButtonElement
    expect(trigger).toBeTruthy()
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(trigger.textContent).toMatch(/2026/)
  })

  it('opens month grid and navigates on month select', () => {
    const cal = mount({ defaultDate: '2026-08-15' })
    const trigger = document.querySelector('.rde-date-nav-trigger') as HTMLButtonElement
    trigger.click()

    const popover = document.getElementById(trigger.getAttribute('aria-controls')!)
    expect(popover?.hidden).toBe(false)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')

    const april = [...document.querySelectorAll<HTMLButtonElement>('.rde-date-nav-month')].find(
      (b) => b.textContent?.toLowerCase().startsWith('apr')
    )
    expect(april).toBeTruthy()
    april!.click()

    expect(popover?.hidden).toBe(true)
    expect(cal.getDate().getFullYear()).toBe(2026)
    expect(cal.getDate().getMonth()).toBe(3)
  })

  it('setDate stays synchronized with navigator label', () => {
    const cal = mount({ defaultDate: '2026-08-15' })
    cal.setDate(new Date(2027, 11, 1))
    const trigger = document.querySelector('.rde-date-nav-trigger') as HTMLButtonElement
    expect(trigger.textContent).toMatch(/2027/)
    expect(trigger.textContent?.toLowerCase()).toMatch(/dec/)
  })

  it('respects minDate and maxDate for month buttons', () => {
    mount({
      defaultDate: '2026-06-15',
      minDate: '2026-05-01',
      maxDate: '2026-07-31'
    })
    const trigger = document.querySelector('.rde-date-nav-trigger') as HTMLButtonElement
    trigger.click()

    const months = [...document.querySelectorAll<HTMLButtonElement>('.rde-date-nav-month')]
    expect(months[0].disabled).toBe(true) // Jan
    expect(months[4].disabled).toBe(false) // May
    expect(months[6].disabled).toBe(false) // Jul
    expect(months[7].disabled).toBe(true) // Aug
  })

  it('closes on Escape and returns focus to trigger', () => {
    mount()
    const trigger = document.querySelector('.rde-date-nav-trigger') as HTMLButtonElement
    trigger.focus()
    trigger.click()
    expect(document.querySelector('.rde-date-nav-popover')?.hidden).toBe(false)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(document.querySelector('.rde-date-nav-popover')?.hidden).toBe(true)
    expect(document.activeElement).toBe(trigger)
  })

  it('uses non-modal dialog semantics', () => {
    mount()
    const trigger = document.querySelector('.rde-date-nav-trigger') as HTMLButtonElement
    const popover = document.querySelector('.rde-date-nav-popover') as HTMLElement

    expect(popover.getAttribute('role')).toBe('dialog')
    expect(popover.getAttribute('aria-label')).toBeTruthy()
    // Popover does not block the rest of the page, so it must not claim to
    expect(popover.hasAttribute('aria-modal')).toBe(false)
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog')
  })

  it('closes when focus leaves the navigator instead of trapping it', () => {
    document.body.innerHTML = '<div id="cal"></div><button id="outside">out</button>'
    const cal = new RollDateEvents('#cal', { defaultDate: '2026-08-15' })
    hosts.push(cal)

    const trigger = document.querySelector('.rde-date-nav-trigger') as HTMLButtonElement
    const popover = document.querySelector('.rde-date-nav-popover') as HTMLElement
    const outside = document.getElementById('outside') as HTMLButtonElement
    trigger.click()
    expect(popover.hidden).toBe(false)

    const inside = popover.querySelector('button') as HTMLButtonElement
    inside.dispatchEvent(
      new FocusEvent('focusout', { bubbles: true, relatedTarget: outside })
    )
    expect(popover.hidden).toBe(true)
    // Focus already moved on — the navigator must not steal it back
    expect(document.activeElement).not.toBe(trigger)
  })

  it('stays open when focus is lost to nothing (window blur)', () => {
    mount()
    const trigger = document.querySelector('.rde-date-nav-trigger') as HTMLButtonElement
    const popover = document.querySelector('.rde-date-nav-popover') as HTMLElement
    trigger.click()

    const inside = popover.querySelector('button') as HTMLButtonElement
    inside.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }))
    expect(popover.hidden).toBe(false)
  })

  it('arrow keys inside an open navigator do not navigate the calendar', () => {
    const cal = mount({ defaultDate: '2026-08-15' })
    const trigger = document.querySelector('.rde-date-nav-trigger') as HTMLButtonElement
    const monthBefore = cal.getDate().getMonth()

    trigger.click()
    const monthBtn = document.querySelector('.rde-date-nav-month') as HTMLButtonElement
    monthBtn.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    monthBtn.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))

    expect(cal.getDate().getMonth()).toBe(monthBefore)
  })

  it('root arrow keys still navigate once the navigator is closed', () => {
    const cal = mount({ defaultDate: '2026-08-15' })
    const root = document.querySelector('#cal .rde') as HTMLElement
    const trigger = document.querySelector('.rde-date-nav-trigger') as HTMLButtonElement

    // Open and close so the navigator has been used at least once
    trigger.click()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

    expect(cal.getDate().getMonth()).toBe(7)
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(cal.getDate().getMonth()).toBe(8)
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    expect(cal.getDate().getMonth()).toBe(7)
  })

  it('Today shortcut respects bounds', () => {
    const cal = mount({
      defaultDate: '2026-08-15',
      maxDate: startOfDay(new Date(2020, 0, 1))
    })
    const trigger = document.querySelector('.rde-date-nav-trigger') as HTMLButtonElement
    trigger.click()
    const todayBtn = document.querySelector('.rde-date-nav-today') as HTMLButtonElement
    expect(todayBtn.disabled).toBe(true)

    cal.destroy()
    hosts.pop()
    document.body.innerHTML = '<div id="cal2"></div>'
    const cal2 = new RollDateEvents('#cal2', { defaultDate: '2026-08-15', defaultView: 'day' })
    hosts.push(cal2)
    document.querySelector<HTMLButtonElement>('.rde-date-nav-trigger')!.click()
    document.querySelector<HTMLButtonElement>('.rde-date-nav-today')!.click()
    const today = startOfDay(new Date())
    expect(cal2.getDate().getFullYear()).toBe(today.getFullYear())
    expect(cal2.getDate().getMonth()).toBe(today.getMonth())
    expect(cal2.getDate().getDate()).toBe(today.getDate())
  })
})
