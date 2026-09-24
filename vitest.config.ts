import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/miniprogram/**/*.test.ts'],
    passWithNoTests: true,
  },
})
