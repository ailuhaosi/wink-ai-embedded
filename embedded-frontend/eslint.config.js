import antfu from '@antfu/eslint-config'

export default antfu(
  {
    vue: true,
    typescript: true,
    formatters: false,
    stylistic: {
      indent: 2,
      quotes: 'single',
      semi: true,
    },
    ignores: [
      'dist/**',
      'public/wasm/**',
      'node_modules/**',
      '**/*.min.js',
      'scripts/**',
      '*.config.js',
      '*.config.ts',
    ],
  },
  {
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error', 'log', 'info', 'debug'] }],
      'vue/no-mutating-props': 'error',
      'vue/custom-event-name-casing': 'off',
      'jsonc/sort-keys': 'off',
      'perfectionist/sort-imports': 'off',
      'perfectionist/sort-named-imports': 'off',
      'import/order': 'off',
      'antfu/top-level-function': 'off',
      'antfu/if-newline': 'off',
      'unicorn/prefer-node-protocol': 'off',
      'style/max-statements-per-line': 'off',
      'ts/no-explicit-any': 'off',
      'ts/ban-ts-comment': 'off',
      'vue/html-self-closing': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/multiline-html-element-content-newline': 'off',
      'vue/max-attributes-per-line': 'off',
      '@typescript-eslint/no-magic-numbers': [
        'warn',
        {
          ignore: [-1, 0, 1, 2, 8, 10],
          ignoreEnums: true,
          ignoreNumericLiteralTypes: true,
          ignoreReadonlyClassProperties: true,
          ignoreArrayIndexes: true,
        },
      ],
    },
  },
  {
    files: ['src/workers/**'],
    rules: {
      'no-restricted-globals': 'off',
      'no-new-func': 'off',
    },
  },
)
