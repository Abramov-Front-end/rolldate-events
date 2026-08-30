import { describe, expect, it, vi } from 'vitest'
import { normalizeEvent } from '../src/utils/validate'
import { resetDevWarnings } from '../src/utils/devWarn'
import type { Event } from '../src/types'

describe('normalizeEvent', () => {
  it('warns and fixes end before start', () => {
    resetDevWarnings()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ev: Event = {
      id: 1,
      title: 'Bad',
      start: '2026-08-20T11:00:00',
      end: '2026-08-20T09:00:00'
    }
    const n = normalizeEvent(ev)
    expect(n.end.getTime()).toBe(n.start.getTime())
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('preserves allDay flag', () => {
    const n = normalizeEvent({
      id: 2,
      title: 'Holiday',
      start: '2026-08-20',
      end: '2026-08-20',
      allDay: true
    })
    expect(n.allDay).toBe(true)
  })
})
