import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
      // Warn, not error: this is a hot-reload ergonomics rule, and the files
      // that trip it (App.jsx's context, Dashboard's shared constants) export
      // alongside components deliberately. Left as an error it was 6 of the
      // failures blocking lint from being a gate anyone could rely on.
      'react-refresh/only-export-components': 'warn',
    },
  },
  // Server-side code: Vercel functions, the standalone scripts, the Telegram
  // bot, and the task-tracker dispatcher that only api/ imports. These run in
  // Node, so `process` and friends are globals — without this every
  // `process.env` read was a lint error, which is most of why `npm run lint`
  // had stopped being a signal anyone looked at.
  {
    files: ['api/**/*.js', 'scripts/**/*.js', 'bot/**/*.js', 'src/lib/integrations/**/*.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  // Tests run in Node under vitest.
  {
    files: ['test/**/*.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
])
