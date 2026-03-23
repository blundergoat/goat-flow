import tseslint from 'typescript-eslint';

export default tseslint.config(
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Enforce consistent type imports (import type { X })
      '@typescript-eslint/consistent-type-imports': 'error',

      // Catch floating promises (missing await)
      '@typescript-eslint/no-floating-promises': 'error',

      // Catch misused promises (promise in if condition, etc.)
      '@typescript-eslint/no-misused-promises': 'error',

      // Flag unnecessary conditions (always-true/false checks)
      '@typescript-eslint/no-unnecessary-condition': 'warn',

      // Allow non-null assertions — we're migrating away but not there yet
      '@typescript-eslint/no-non-null-assertion': 'warn',

      // Allow explicit any in a few places (JSON parsing boundaries)
      '@typescript-eslint/no-explicit-any': 'warn',

      // Allow explicit === false style (project preference over !)
      '@typescript-eslint/no-unnecessary-boolean-literal-compare': 'off',

      // Flag functions with too many branches
      'complexity': ['warn', { max: 15 }],

      // Allow unused vars with _ prefix
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],

      // Relax for this project — zero-dep constraint means some patterns differ
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
  {
    ignores: ['dist/**', 'test/**', 'node_modules/**', '*.js', '*.mjs'],
  },
);
