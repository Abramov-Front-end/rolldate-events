/**
 * Week view — infinite vertical strip of weeks.
 * Same 7 columns; hours repeat per week; sticky header dates update.
 */

import type { LayoutPatch, NormalizedEvent, View, ViewContext } from '../types'
import { TimeStripController } from './TimeStrip'

export class WeekView implements View {
  readonly name = 'week' as const
  private strip = new TimeStripController('week')

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
