/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it } from 'vitest'
import { RollDateEvents } from '../src/RollDateEvents'

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

describe('AgendaView', () => {
  const hosts: RollDateEvents[] = []

  afterEach(() => {
    while (hosts.length) hosts.pop()?.destroy()
    document.body.innerHTML = ''
  })

  it('skips days that have no events', async () => {
    document.body.innerHTML = '<div id="cal" style="width:720px;height:640px"></div>'
    const cal = new RollDateEvents('#cal', {
      defaultDate: '2026-09-16',
      defaultView: 'agenda',
      events: [
        { id: 1, title: 'A', start: '2026-09-15T10:00:00', end: '2026-09-15T11:00:00' },
        { id: 2, title: 'B', start: '2026-09-15T14:00:00', end: '2026-09-15T15:00:00' },
        { id: 3, title: 'C', start: '2026-09-17T10:00:00', end: '2026-09-17T11:00:00' },
        { id: 4, title: 'D', start: '2026-09-23T09:00:00', end: '2026-09-23T10:00:00' },
        { id: 5, title: 'E', start: '2026-09-23T11:00:00', end: '2026-09-23T12:00:00' },
        { id: 6, title: 'F', start: '2026-09-23T13:00:00', end: '2026-09-23T14:00:00' }
      ]
    })
    hosts.push(cal)

    await waitFor(() => document.querySelectorAll('.rde-agenda-seg').length > 0, 'agenda segments')
    const days = [...document.querySelectorAll<HTMLElement>('.rde-agenda-seg')].map((s) => s.dataset.day)
    expect(days).toEqual(['2026-09-15', '2026-09-17', '2026-09-23'])
    expect(days).not.toContain('2026-09-16')
  })

  it('shows a single empty day when there are no events', async () => {
    document.body.innerHTML = '<div id="cal" style="width:720px;height:640px"></div>'
    const cal = new RollDateEvents('#cal', {
      defaultDate: '2026-08-15',
      defaultView: 'agenda',
      events: []
    })
    hosts.push(cal)

    await waitFor(() => document.querySelectorAll('.rde-agenda-seg').length > 0, 'empty agenda')
    const segs = document.querySelectorAll('.rde-agenda-seg')
    expect(segs).toHaveLength(1)
    expect((segs[0] as HTMLElement).dataset.day).toBe('2026-08-15')
    expect(segs[0].textContent).toMatch(/No events/)
  })

  it('jumps to the next occupied day when the target date is empty', async () => {
    document.body.innerHTML = '<div id="cal" style="width:720px;height:640px"></div>'
    const cal = new RollDateEvents('#cal', {
      defaultDate: '2026-09-15',
      defaultView: 'agenda',
      events: [
        { id: 1, title: 'A', start: '2026-09-15T10:00:00', end: '2026-09-15T11:00:00' },
        { id: 2, title: 'B', start: '2026-09-23T10:00:00', end: '2026-09-23T11:00:00' }
      ]
    })
    hosts.push(cal)

    await waitFor(() => document.querySelectorAll('.rde-agenda-seg').length === 2, 'occupied days')
    cal.setDate('2026-09-18')
    await tick()
    expect(cal.getDate().getDate()).toBe(23)
  })
})
