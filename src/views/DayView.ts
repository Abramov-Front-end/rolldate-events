/**
 * Day view — infinite vertical strip of days.
 * Hours repeat for each next day; sticky header updates.
 */

import type { LayoutPatch, NormalizedEvent, View, ViewContext } from '../types'
import { TimeStripController } from './TimeStrip'

export class DayView implements View {
  readonly name = 'day' as const
  private strip = new TimeStripController('day')

  render(ctx: ViewContext): void {
    this.strip.mount(ctx)
  }

  syncEvents(events: NormalizedEvent[]): void {
    this.strip.syncEvents(events)
  }

  goToDate(date: Date): void {
    this.strip.goToDate(date)
  }

  applyLayout(patch: LayoutPatch): void {
    this.strip.applyLayout(patch)
  }

  destroy(): void {
    this.strip.destroy()
  }
}
