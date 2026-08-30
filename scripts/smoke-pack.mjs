/**
 * Install the local npm pack tarball and verify ESM / CJS / types / CSS exports.
 * Usage (from events/): npm run build && npm run smoke:pack
 */

import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const eventsDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rolldate-events-smoke-'))

function run(cmd, cwd) {
  execSync(cmd, { cwd, stdio: 'inherit', shell: true })
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'))
}

console.log('Smoke test workspace:', tmpRoot)

const packRaw = execSync('npm pack --ignore-scripts', { cwd: eventsDir, encoding: 'utf8' })
const match = packRaw.match(/rolldate-events-[\d.a-z-]+\.tgz/i)
if (!match) {
  throw new Error('npm pack did not return a tarball filename:\n' + packRaw)
}
const packOut = match[0]
const tgz = path.join(eventsDir, packOut)
const tgzAbs = path.resolve(tgz)

// --- ESM ---
const esmDir = path.join(tmpRoot, 'esm')
fs.mkdirSync(esmDir)
fs.writeFileSync(
  path.join(esmDir, 'package.json'),
  JSON.stringify({ name: 'smoke-esm', private: true, type: 'module' }, null, 2)
)
run(`npm install "${tgzAbs}"`, esmDir)
fs.writeFileSync(
  path.join(esmDir, 'test.mjs'),
  `import { RollDateEvents, isProBuild } from '@rolldate/events'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import assert from 'node:assert'

const require = createRequire(import.meta.url)
const pkgJson = require('@rolldate/events/package.json')
const cssRel = pkgJson.exports['./styles']
const cssFile = path.join(path.dirname(require.resolve('@rolldate/events/package.json')), cssRel.replace(/^\\.\\//, ''))

assert.strictEqual(typeof RollDateEvents, 'function')
assert.strictEqual(isProBuild(), false)
assert.ok(fs.existsSync(cssFile), 'CSS file missing: ' + cssFile)
console.log('ESM OK')
`
)
run('node test.mjs', esmDir)

// --- CJS ---
const cjsDir = path.join(tmpRoot, 'cjs')
fs.mkdirSync(cjsDir)
fs.writeFileSync(
  path.join(cjsDir, 'package.json'),
  JSON.stringify({ name: 'smoke-cjs', private: true }, null, 2)
)
run(`npm install "${tgzAbs}"`, cjsDir)
fs.writeFileSync(
  path.join(cjsDir, 'test.cjs'),
  `const { RollDateEvents, isProBuild } = require('@rolldate/events')
const assert = require('node:assert')
assert.strictEqual(typeof RollDateEvents, 'function')
assert.strictEqual(isProBuild(), false)
console.log('CJS OK')
`
)
run('node test.cjs', cjsDir)

// --- TypeScript ---
const tsDir = path.join(tmpRoot, 'ts')
fs.mkdirSync(tsDir)
fs.writeFileSync(
  path.join(tsDir, 'package.json'),
  JSON.stringify(
    {
      name: 'smoke-ts',
      private: true,
      devDependencies: {
        typescript: '^5.8.3',
        '@rolldate/events': `file:${tgzAbs.replace(/\\/g, '/')}`
      }
    },
    null,
    2
  )
)
fs.writeFileSync(
  path.join(tsDir, 'tsconfig.json'),
  JSON.stringify(
    {
      compilerOptions: {
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        noEmit: true,
        skipLibCheck: true
      },
      include: ['check.ts']
    },
    null,
    2
  )
)
fs.writeFileSync(
  path.join(tsDir, 'check.ts'),
  `import { RollDateEvents } from '@rolldate/events'
import type { Event, RollDateEventsOptions, VisibleRange } from '@rolldate/events'

const opts: RollDateEventsOptions = {
  events: [{ id: 1, title: 'A', start: '2026-01-01', end: '2026-01-01' } satisfies Event],
  onVisibleRangeChange: (range: VisibleRange) => range.from.getTime()
}

declare const el: HTMLElement
const cal = new RollDateEvents(el, opts)
cal.setView('week')
cal.destroy()
`
)
run('npm install', tsDir)
run('npx tsc -p tsconfig.json', tsDir)

// --- CSS file on disk ---
const pkgRoot = path.join(esmDir, 'node_modules', '@rolldate', 'events')
const cssFile = path.join(pkgRoot, 'dist', 'rolldate-events.css')
if (!fs.existsSync(cssFile)) {
  throw new Error('Missing dist/rolldate-events.css in installed package')
}

const pkg = readJson(path.join(pkgRoot, 'package.json'))
if (!pkg.exports?.['./styles']) {
  throw new Error('Missing ./styles export')
}

console.log('\nSmoke pack: all checks passed')
console.log('Tarball:', tgzAbs)

try {
  fs.unlinkSync(tgz)
} catch {
  /* ignore */
}
