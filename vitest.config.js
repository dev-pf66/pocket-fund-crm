import { defineConfig } from 'vitest/config'

// Deliberately separate from vite.config.js: these are node-environment unit
// tests over the api/ and src/lib/ modules, so they want none of the React
// plugin or JSX handling the app build needs.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.js'],
    setupFiles: ['./test/setup.js']
  }
})
