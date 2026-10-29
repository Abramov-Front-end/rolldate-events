/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it } from 'vitest'
import { TranslateStrip } from '../src/utils/infiniteScroll'

const hosts: HTMLElement[] = []

afterEach(() => {
  while (hosts.length) hosts.pop()?.remove()
  document.body.innerHTML = ''
})

function mountStrip(opts: { minIndex?: number; maxIndex?: number; bufferSize?: number } = {}) {
  const viewport = document.createElement('div')
  const strip = document.createElement('div')
  Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: 200 })
  Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: 400 })
  document.body.append(viewport)
  viewport.append(strip)
  hosts.push(viewport)
  const scroller = new TranslateStrip(
    viewport,
    strip,
    {
      segmentSize: 100,
      bufferSize: opts.bufferSize ?? 8,
      minIndex: opts.minIndex,
      maxIndex: opts.maxIndex
    },
    {
      paint: () => undefined,
      onSettle: () => undefined,
      onRangeChange: () => undefined
    }
  )
  return scroller
}

describe('TranslateStrip bounds', () => {
  it('does not pan into empty space past the start of the buffer', () => {
    const scroller = mountStrip()
    scroller.reset(10, { align: 'start' })
    const start = scroller.state.offset
    expect(start).toBe(-400)
    scroller.nudgeBy(2000)
    expect(scroller.state.offset).toBe(0)
  })

  it('does not pan into empty space past the end of the buffer', () => {
    const scroller = mountStrip()
    scroller.reset(10, { align: 'start' })
    scroller.nudgeBy(-5000)
    expect(scroller.state.offset).toBe(-600)
  })

  it('stops at minIndex instead of showing a hole above the first allowed week', () => {
    const scroller = mountStrip({ minIndex: 10, maxIndex: 10 })
    scroller.reset(10, { align: 'start' })
    const locked = scroller.state.offset
    expect(locked).toBe(-400)
    scroller.nudgeBy(800)
    expect(scroller.state.offset).toBe(locked)
    scroller.nudgeBy(-800)
    expect(scroller.state.offset).toBe(locked)
  })
})
