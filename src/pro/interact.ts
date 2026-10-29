/** Public Free repository stub — Pro drag/resize is not shipped here. */
import type { EventChangeGesture, EventMovePatch, NormalizedEvent } from '../types'

export interface InteractHost {
  getEvent(id: string): NormalizedEvent | undefined
  visibleHours: { start: number; end: number }
  snapMinutes: number
  viewName: string
  calendarEditable?: boolean
  minDate?: Date
  maxDate?: Date
  allowedResourceIds?: string[]
  knownResourceIds?: readonly string[]
  allowOverlap?: boolean
  overlapEvents?: () => readonly NormalizedEvent[]
  isBusy?(): boolean
  onEventMove(
    event: NormalizedEvent,
    start: Date,
    end: Date,
    reason: EventChangeGesture,
    patch?: EventMovePatch
  ): void
  nudgeStrip?(delta: number): void
  scrollTimeBand?(delta: number): void
  previewTimedMove?(
    id: string,
    start: Date,
    end: Date,
    originDay: Date,
    resourceId?: string,
    clientY?: number,
    resize?: boolean
  ): { top: number; height: number; leftPct: number; widthPct: number; order?: number } | null
  clearTimedPreview?(): void
}

export function bindInteract(_root: HTMLElement, _host: InteractHost): () => void {
  return () => undefined
}
