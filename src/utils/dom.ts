/**
 * Shared DOM helpers for views
 */

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/'/g, '&#39;')
}

export function clearEl(el: HTMLElement): void {
  while (el.firstChild) el.removeChild(el.firstChild)
}
