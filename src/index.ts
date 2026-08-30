/**
 * Lite entry — public build without Pro modules in the graph when unused.
 */

import { RollDateEvents } from './RollDateEvents'

export { RollDateEvents }
export type {
  CalendarEvent,
  CalendarViewName,
  Event,
  EventRecurring,
  RollDateEventsOptions,
  ThemeMode,
  View,
  ViewContext,
  VisibleRange
} from './types'
export type { CalendarViewName as CalendarView } from './types'
export { isProBuild, isProFeature } from './features'

if (typeof window !== 'undefined') {
  ;(window as unknown as { RollDateEvents: typeof RollDateEvents }).RollDateEvents =
    RollDateEvents
}
