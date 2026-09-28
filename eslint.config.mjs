import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import tseslint from 'typescript-eslint'

export default defineConfig([
  globalIgnores(['node_modules/', 'miniprogram/miniprogram_npm/', 'server/.venv/', 'server/var/']),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { Buffer: 'readonly', console: 'readonly', fetch: 'readonly', process: 'readonly' },
    },
  },
  {
    files: ['server/apps/**/static/**/*.js'],
    languageOptions: {
      globals: { document: 'readonly', window: 'readonly', fetch: 'readonly' },
    },
  },
])
