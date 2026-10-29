/**
 * @vitest-environment jsdom
 */

import { describe, expect, it } from 'vitest'
import {
  BoundPan,
  canPanY,
  clampPanOffset,
  routePanWheel
} from '../src/utils/panScroll'

function wheel(partial: Partial<WheelEvent>): WheelEvent {
  return {
    deltaX: 0,
    deltaY: 0,
    shiftKey: false,
    ...partial
  } as WheelEvent
}

describe('routePanWheel', () => {
  it('keeps a vertical wheel on Y when the pane can scroll vertically', () => {
    const route = routePanWheel(wheel({ deltaY: 40 }), true, true)
    expect(route).toEqual({ axis: 'y', delta: -36 })
  })

  it('sends a horizontal trackpad swipe to X', () => {
    const route = routePanWheel(wheel({ deltaX: 30, deltaY: 4 }), true, true)
    expect(route?.axis).toBe('x')
    expect(route?.delta).toBe(-27)
  })

  it('maps Shift + vertical wheel to X', () => {
    const route = routePanWheel(wheel({ deltaY: 40, shiftKey: true }), true, true)
    expect(route).toEqual({ axis: 'x', delta: 36 })
  })

  it('does not turn a vertical wheel into horizontal pan when Y is not needed', () => {
    expect(routePanWheel(wheel({ deltaY: 40 }), true, false)).toBeNull()
  })

  it('does not steal a vertical wheel when X is the only axis but shift is not held and Y is available', () => {
    const route = routePanWheel(wheel({ deltaY: 20 }), false, true)
    expect(route?.axis).toBe('y')
  })
})

describe('BoundPan', () => {
  it('clamps to the content box and reports when vertical pan is possible', () => {
    expect(canPanY(400, 400)).toBe(false)
    expect(canPanY(500, 400)).toBe(true)
    expect(clampPanOffset(-20, 500, 400)).toBe(-20)
    expect(clampPanOffset(-200, 500, 400)).toBe(-100)
    expect(clampPanOffset(10, 500, 400)).toBe(0)

    const viewport = document.createElement('div')
    const strip = document.createElement('div')
    Object.defineProperty(viewport, 'clientHeight', { value: 80 })
    Object.defineProperty(strip, 'scrollHeight', { value: 200 })
    const pan = new BoundPan(viewport, strip)
    pan.nudge(-40)
    expect(pan.offset).toBe(-40)
    expect(pan.atStart()).toBe(false)
    pan.nudge(-400)
    expect(pan.offset).toBe(-120)
    expect(pan.atEnd()).toBe(true)
  })

  it('does not enable vertical pan when the hour band fits the pane', () => {
    const viewport = document.createElement('div')
    const strip = document.createElement('div')
    Object.defineProperty(viewport, 'clientHeight', { value: 478 })
    const pan = new BoundPan(viewport, strip)
    pan.setContentSize(480)
    pan.setViewSize(480)
    expect(pan.canScroll()).toBe(false)
    pan.nudge(-20)
    expect(pan.offset).toBe(0)
  })
})
