/** One-time dev warnings — deduped by key */

const seen = new Set<string>()

export function devWarn(key: string, message: string): void {
  if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'production') return
  if (seen.has(key)) return
  seen.add(key)
  console.warn(message)
}

/** Reset for tests */
export function resetDevWarnings(): void {
  seen.clear()
}
