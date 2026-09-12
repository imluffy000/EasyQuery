/**
 * Lint for correctness, not style: the recommended JS and TypeScript rules,
 * plus the two React hooks rules that catch real bugs (hook order, and
 * effect dependencies -- the one that matters most for animation cleanup).
 *
 * The React Compiler rules bundled with eslint-plugin-react-hooks 6+ are not
 * enabled; the codebase does not target the compiler.
 */
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // tsc already enforces unused locals and parameters (tsconfig).
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
)
