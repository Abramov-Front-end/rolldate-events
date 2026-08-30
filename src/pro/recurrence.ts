/** Public Free repository stub — recurrence expansion is not shipped here. */
import type { NormalizedEvent } from '../types'

export function expandRecurring(
  event: NormalizedEvent,
  _rangeFrom: Date,
  _rangeTo: Date
): NormalizedEvent[] {
  return [event]
}
