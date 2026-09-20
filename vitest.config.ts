import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

/**
 * Two projects, because the workspace has two kinds of code.
 *
 * The engine and the interfaces run on Node and must keep running on a phone,
 * so they are tested with no DOM present at all — a `document` reference fails
 * here as well as in lint. The ui-* packages and the app are React DOM and get
 * jsdom and the kit's matchers.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'engine',
          environment: 'node',
          include: [
            'packages/template/src/**/*.test.ts',
            'packages/presence-store/src/**/*.test.ts',
            'packages/adapters/src/**/*.test.ts',
            'packages/realtime-core/src/**/*.test.ts',
            'packages/realtime-client/src/**/*.test.ts',
            'server/src/**/*.test.ts',
            'tools/**/*.test.js',
          ],
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'web',
          environment: 'jsdom',
          setupFiles: ['./vitest.setup.ts'],
          include: [
            'packages/ui-map/src/**/*.test.{ts,tsx}',
            'packages/ui-builder/src/**/*.test.{ts,tsx}',
            'app/src/**/*.test.{ts,tsx}',
          ],
        },
      },
    ],
  },
})
