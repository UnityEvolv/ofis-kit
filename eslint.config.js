/**
 * One lint configuration for the whole workspace.
 *
 * The interesting part is not the recommended sets, it is which of the repo's
 * own rules apply where. Those boundaries are the layout's promises, and this
 * file is where they stop being prose.
 */
import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import ofiskit from 'eslint-plugin-ofiskit'

/**
 * The packages a React Native app will import one day, so none of them may
 * touch the DOM. The ui-* packages are deliberately absent: they are React DOM
 * and exist precisely to hold the web-only half.
 */
const AGNOSTIC = [
  'packages/template/**/*.ts',
  'packages/presence-store/**/*.ts',
  'packages/adapters/**/*.ts',
  'packages/realtime-core/**/*.ts',
  'packages/realtime-client/**/*.ts',
]

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/storybook-static/**',
      'app/public/**',
      'docs-site/**',
      'test-results/**',
      'playwright-report/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    plugins: { ofiskit },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': 'off',

      // Repo rules that apply everywhere.
      'ofiskit/no-hostname-literal': 'error',
      'ofiskit/no-provider-sdk-outside-adapter': 'error',
    },
  },

  {
    files: AGNOSTIC,
    rules: { 'ofiskit/no-dom-in-agnostic': 'error' },
  },

  // The web half: React DOM, the kit, and the icon rule that keeps the kit's
  // Icon the only way an icon reaches a screen.
  {
    files: ['packages/ui-map/**/*.{ts,tsx}', 'packages/ui-builder/**/*.{ts,tsx}', 'app/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },

  // The realtime client runs in a browser and on a phone. It gets the browser
  // globals it is allowed (navigator, RTCPeerConnection) without the DOM rule
  // being relaxed — that rule names the forbidden ones explicitly.
  {
    files: ['packages/realtime-client/**/*.ts'],
    languageOptions: { globals: { ...globals.browser } },
  },

  // Tests and anything that configures the process may name a host: a test
  // needs an address to connect to, and config is where a default belongs.
  {
    files: [
      '**/*.test.{ts,tsx}',
      '**/*.spec.{ts,tsx}',
      '**/test/**',
      '**/e2e/**',
      '**/*.config.{ts,js,mjs}',
      'server/src/config.ts',
      'app/src/config.ts',
      'scripts/**',
      'tools/**',
      'brand/**',
    ],
    rules: {
      'ofiskit/no-hostname-literal': 'off',
    },
  },
)
