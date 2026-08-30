import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'rollup'
import resolve from '@rollup/plugin-node-resolve'
import replace from '@rollup/plugin-replace'
import typescript from '@rollup/plugin-typescript'
import terser from '@rollup/plugin-terser'
import postcss from 'rollup-plugin-postcss'
import dts from 'rollup-plugin-dts'

const rootDir = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.join(rootDir, 'dist')

/** Public Free (Lite) build — no Pro code in output */
function buildLite() {
  const input = 'src/index.ts'

  const js = {
    input,
    output: [
      {
        file: path.join(outDir, 'rolldate-events.mjs'),
        format: 'es',
        sourcemap: true
      },
      {
        file: path.join(outDir, 'rolldate-events.cjs'),
        format: 'cjs',
        sourcemap: true,
        exports: 'named'
      }
    ],
    plugins: [
      replace({
        preventAssignment: true,
        values: { __PRO__: JSON.stringify(false) }
      }),
      resolve({ browser: true }),
      postcss({
        extract: path.join(outDir, 'rolldate-events.css'),
        minimize: true
      }),
      typescript({
        tsconfig: './tsconfig.build.json',
        compilerOptions: {
          declaration: false,
          declarationMap: false,
          outDir
        }
      }),
      terser({ format: { comments: false } })
    ]
  }

  const types = {
    input,
    output: [{ file: path.join(outDir, 'rolldate-events.d.ts'), format: 'es' }],
    plugins: [
      replace({
        preventAssignment: true,
        values: { __PRO__: JSON.stringify(false) }
      }),
      dts()
    ],
    external: [/\.css$/]
  }

  return [js, types]
}

export default defineConfig(buildLite())
