import { defineConfig } from 'vitest/config'

export default defineConfig({
  define: {
    __PRO__: false
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts']
  }
})
