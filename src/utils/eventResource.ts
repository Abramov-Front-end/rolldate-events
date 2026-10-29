/**
 * allowedResourceIds — restricts resource *changes* only.
 * Stay / same-resource time move / resize are always allowed.
 * Public type is `undefined | string[]` (no null).
 */

import type { EventMovePatch } from '../types'

export function copyAllowedResourceIds(ids?: string[]): string[] | undefined {
  return ids ? ids.slice() : undefined
}

export function normalizeResourceId(id?: string): string {
  return id == null ? '' : String(id)
}

/** Intersection of event and calendar lists. `undefined` means no restriction. */
export function effectiveAllowedResourceIds(
  event?: { allowedResourceIds?: string[] },
  calendarAllowedResourceIds?: string[]
): string[] | undefined {
  const local = event?.allowedResourceIds
  const global = calendarAllowedResourceIds
  if (global === undefined) return local === undefined ? undefined : local.slice()
  if (local === undefined) return global.slice()
  const allow = new Set(global)
  return local.filter((id) => allow.has(id))
}

/**
 * Missing `resourceId` on the patch keeps the current resource.
 * An explicit `resourceId: undefined` is a change to unassigned.
 */
export function nextResourceIdFromPatch(
  currentResourceId: string | undefined,
  patch?: EventMovePatch
): string | undefined {
  if (patch && Object.prototype.hasOwnProperty.call(patch, 'resourceId')) {
    return patch.resourceId
  }
  return currentResourceId
}

export function isResourceChangeAllowed(args: {
  currentResourceId?: string
  nextResourceId?: string
  event?: { allowedResourceIds?: string[] }
  calendarAllowedResourceIds?: string[]
  /** Calendar `resources` ids. Omitted only in isolated tests that skip the known-id check. */
  knownResourceIds?: readonly string[]
}): boolean {
  const current = normalizeResourceId(args.currentResourceId)
  const next = normalizeResourceId(args.nextResourceId)
  if (current === next) return true
  if (next === '') return false
  if (args.knownResourceIds && !args.knownResourceIds.includes(next)) return false
  const allowed = effectiveAllowedResourceIds(args.event, args.calendarAllowedResourceIds)
  if (allowed === undefined) return true
  return allowed.includes(next)
}
