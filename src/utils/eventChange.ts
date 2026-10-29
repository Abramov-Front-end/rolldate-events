/**
 * Pro integration helpers for beforeEventMove / beforeEventResize / revert.
 */

import type {
  CalendarViewName,
  Event,
  EventChangeGesture,
  EventChangeInfo,
  EventChangeScope,
  EventChangeTransaction,
  EventMutation,
  EventRecurring,
  ResolvableOccurrenceScope
} from '../types'
import { copyAllowedResourceIds } from './eventResource'

function cloneDateish<T extends Date | string | undefined>(value: T): T {
  return (value instanceof Date ? new Date(value.getTime()) : value) as T
}

function cloneRecurring(rule: EventRecurring): EventRecurring {
  const next: EventRecurring = {
    ...rule,
    endDate: cloneDateish(rule.endDate)
  }
  if (rule.excludedOccurrenceIndexes) {
    next.excludedOccurrenceIndexes = rule.excludedOccurrenceIndexes.slice()
  }
  return next
}

function cloneRecurringSource(
  source: NonNullable<Event['recurringSource']>
): NonNullable<Event['recurringSource']> {
  return { seriesId: source.seriesId, occurrenceIndex: source.occurrenceIndex }
}

/** Deep-enough copy so callback snapshots cannot alias store Dates or nested rules. */
export function cloneEvent(event: Event): Event {
  const next: Event = {
    ...event,
    start: cloneDateish(event.start),
    end: cloneDateish(event.end)
  }
  if (event.recurring) next.recurring = cloneRecurring(event.recurring)
  if (event.allowedResourceIds) {
    next.allowedResourceIds = copyAllowedResourceIds(event.allowedResourceIds)
  }
  if (event.recurringSource) next.recurringSource = cloneRecurringSource(event.recurringSource)
  return next
}

export function isResolvableOccurrenceScope(
  value: unknown
): value is ResolvableOccurrenceScope {
  return value === 'this' || value === 'series'
}

export function cloneEventMutation(mutation: EventMutation): EventMutation {
  if (mutation.type === 'update') {
    return {
      type: 'update',
      oldEvent: cloneEvent(mutation.oldEvent),
      newEvent: cloneEvent(mutation.newEvent)
    }
  }
  if (mutation.type === 'create') {
    return { type: 'create', event: cloneEvent(mutation.event) }
  }
  return { type: 'remove', event: cloneEvent(mutation.event) }
}

export function cloneTransaction(tx: EventChangeTransaction): EventChangeTransaction {
  const next: EventChangeTransaction = {
    reason: tx.reason,
    scope: tx.scope,
    sourceEventId: tx.sourceEventId,
    mutations: tx.mutations.map(cloneEventMutation)
  }
  if (tx.occurrenceIndex != null) next.occurrenceIndex = tx.occurrenceIndex
  return next
}

export function invertMutations(mutations: EventMutation[]): EventMutation[] {
  const inverse: EventMutation[] = []
  for (let i = mutations.length - 1; i >= 0; i--) {
    const mutation = mutations[i]
    if (mutation.type === 'update') {
      inverse.push({
        type: 'update',
        oldEvent: cloneEvent(mutation.newEvent),
        newEvent: cloneEvent(mutation.oldEvent)
      })
    } else if (mutation.type === 'create') {
      inverse.push({ type: 'remove', event: cloneEvent(mutation.event) })
    } else {
      inverse.push({ type: 'create', event: cloneEvent(mutation.event) })
    }
  }
  return inverse
}

function synthesizeTransaction(args: {
  oldEvent: Event
  newEvent: Event
  reason: EventChangeGesture
  scope?: EventChangeScope
}): EventChangeTransaction {
  return {
    reason: args.reason,
    scope: args.scope || 'single',
    sourceEventId: args.oldEvent.id,
    mutations: [
      {
        type: 'update',
        oldEvent: cloneEvent(args.oldEvent),
        newEvent: cloneEvent(args.newEvent)
      }
    ]
  }
}

export function buildEventChangeInfo(args: {
  oldEvent: Event
  newEvent: Event
  reason: EventChangeGesture
  view: CalendarViewName
  transaction?: EventChangeTransaction
}): EventChangeInfo {
  const oldEvent = cloneEvent(args.oldEvent)
  const newEvent = cloneEvent(args.newEvent)
  const info: EventChangeInfo = {
    oldEvent,
    newEvent,
    reason: args.reason,
    view: args.view,
    transaction: cloneTransaction(
      args.transaction || synthesizeTransaction({ oldEvent, newEvent, reason: args.reason })
    )
  }
  if (oldEvent.resourceId) info.oldResourceId = String(oldEvent.resourceId)
  if (newEvent.resourceId) info.newResourceId = String(newEvent.resourceId)
  return info
}

export function isResizeGesture(reason: string): boolean {
  return reason === 'resize' || reason === 'resize-start' || reason === 'resize-end'
}

export async function allowEventChange(
  hook: ((info: EventChangeInfo) => boolean | Promise<boolean>) | undefined,
  info: EventChangeInfo
): Promise<boolean> {
  if (!hook) return true
  try {
    return (await hook(info)) !== false
  } catch {
    return false
  }
}

export function createRevert(apply: () => void): () => void {
  let used = false
  return () => {
    if (used) return
    used = true
    apply()
  }
}

export function allocateEventId(
  taken: Iterable<Event['id']>,
  factory?: () => Event['id']
): Event['id'] | null {
  const used = new Set([...taken].map(String))
  if (factory) {
    const id = factory()
    if (used.has(String(id))) return null
    return id
  }
  let n = 1
  let id = `rde-${n}`
  while (used.has(id)) {
    n += 1
    id = `rde-${n}`
  }
  return id
}
