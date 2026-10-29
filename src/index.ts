/**
 * Lite entry — public build without Pro modules in the graph when unused.
 */

import { RollDateEvents } from './RollDateEvents'

export { RollDateEvents }
export type {
  CalendarEvent,
  CalendarResource,
  CalendarViewName,
  DayOpenInfo,
  DayOpenSourceView,
  Event,
  EventChangeContext,
  EventChangeGesture,
  EventChangeInfo,
  EventChangeReason,
  EventChangeScope,
  EventChangeScopeInfo,
  ResolvableOccurrenceScope,
  EventChangeTransaction,
  EventMutation,
  EventRecurring,
  RollDateEventsOptions,
  ThemeMode,
  View,
  ViewContext,
  VisibleRange
} from './types'
export type { CalendarViewName as CalendarView } from './types'
export type { NormalizedEvent } from './types'

if (typeof window !== 'undefined') {
  ;(window as unknown as { RollDateEvents: typeof RollDateEvents }).RollDateEvents =
    RollDateEvents
}
