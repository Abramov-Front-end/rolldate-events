import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const eventsDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

describe('public @rolldate/events package', () => {
  it('does not ship Pro artifacts in the published file list', () => {
    const pkg = JSON.parse(readFileSync(path.join(eventsDir, 'package.json'), 'utf8'))
    expect(pkg.name).toBe('@rolldate/events')
    expect(pkg.exports['.']).toBeTruthy()
    expect(pkg.exports['./pro']).toBeUndefined()
    expect(pkg.files.join('\n')).not.toMatch(/dist\/pro|index\.pro|src\/pro/)
  })

  it('npm pack dry-run excludes the Pro build', () => {
    const raw = execSync('npm pack --dry-run --json --ignore-scripts', {
      cwd: eventsDir,
      encoding: 'utf8'
    })
    const report = JSON.parse(raw)
    const files = (report[0]?.files ?? []).map((f: { path: string }) => f.path.replace(/\\/g, '/'))
    expect(files.some((f: string) => f.includes('dist/pro'))).toBe(false)
    expect(files.some((f: string) => f.includes('index.pro'))).toBe(false)
    expect(files.some((f: string) => f.includes('src/pro/'))).toBe(false)
    expect(files.some((f: string) => f.includes('pro-package'))).toBe(false)
  })
})
