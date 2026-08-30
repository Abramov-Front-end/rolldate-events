/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it } from 'vitest'
import { RollDateEvents } from '../src/RollDateEvents'

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
})
