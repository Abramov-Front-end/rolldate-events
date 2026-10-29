/**
 * Calendar-level editable AND event.editable.
 * A local `true` cannot unlock a locked calendar.
 */

export function isEventEditable(
  event: { editable?: boolean } | undefined,
  calendarEditable: boolean
): boolean {
  if (!calendarEditable) return false
  return event?.editable !== false
}

export function eventEditableAttr(
  event: { editable?: boolean } | undefined,
  calendarEditable: boolean
): string {
  return isEventEditable(event, calendarEditable) ? 'true' : 'false'
}
