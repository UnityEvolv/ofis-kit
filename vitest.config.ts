import { defineConfig } from 'vitest/config'

/**
 * Enough of a runner for the layout to prove its own rules.
 *
 * The test harness story sets up the rest — the browser environment, the
 * component tests, the two-browser call test. This is here because the repo
 * layout story ships three lint rules and a claim that each one fails on the
 * mistake it exists to catch, and a claim like that is worth nothing until
 * something runs it.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tools/**/*.test.js', 'packages/*/src/**/*.test.ts'],
  },
})
