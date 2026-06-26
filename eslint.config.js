import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    // Cloudflare Pages Functions: server-side handlers, not React modules, so the
    // Fast Refresh component-export rule doesn't apply. Workers/runtime globals.
    files: ['functions/**/*.ts'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.serviceworker },
    },
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
])
