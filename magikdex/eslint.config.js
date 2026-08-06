import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // android/ios are the Capacitor native shells — the only JS inside them is
  // the copied dist bundle (gitignored), never lintable source.
  globalIgnores(['dist', 'android', 'ios']),
  {
    files: ['**/*.{js,jsx}'],
    ignores: ['api/**'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // Reading a `const`/`let` above its declaration is a temporal dead zone
      // ReferenceError at runtime, not a hoisting convenience. ReviewScreen shipped
      // exactly that — commanderFull read four lines before its useState — and
      // because a throw during render unmounts the whole tree, and App.jsx restores
      // a persisted brew session on load, it was a BLACK SCREEN on every reload for
      // anyone whose last session was in Review. Days to find, because a crash on a
      // phone reports nothing.
      //
      // functions:false — function declarations genuinely hoist, and calling a
      // helper defined lower in the file is a normal, safe pattern here.
      'no-use-before-define': ['error', {
        functions: false,
        classes: true,
        variables: true,
      }],
    },
  },
  // Vercel serverless functions run in Node, not the browser.
  {
    files: ['api/**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },
])
