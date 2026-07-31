import { defineConfig } from 'vitest/config'

// Separate from vite.config.ts on purpose: the app's PWA/tailwind plugins add
// build-time overhead the unit tests don't need. `npm test` / `npx vitest run`
// picks this up automatically.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./src/test/setup.ts'],
  },
})
