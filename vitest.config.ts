import { defineConfig } from 'vitest/config'

export default defineConfig({
  define: {
    __PRO__: false,
    __PRO_SHOWCASE__: false,
    __PRO_ALLOW_DEV_LICENSE__: false,
    __PRO_VERSION__: JSON.stringify('1.0.0'),
    __LICENSE_PUBLIC_KEY__: JSON.stringify('')
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts']
  }
})
