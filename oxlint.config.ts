import { defineOxlintConfig } from '@visorian/code-standards/oxlint'

export default defineOxlintConfig({
  debt: {
    maxWarnings: 815,
    rules: [
      'anti-slop/no-module-mocking',
      'anti-slop/no-unsafe-dictionary-type',
      'eslint/no-await-in-loop',
      'eslint/require-unicode-regexp',
      'typescript/explicit-module-boundary-types',
      'typescript/method-signature-style',
      'typescript/prefer-nullish-coalescing',
      'typescript/strict-boolean-expressions',
      'vitest/prefer-strict-equal',
      'vitest/require-mock-type-parameters',
    ],
  },
  overrides: [
    {
      files: ['tests/**'],
      rules: {
        // Streams and correlators are not arrays; combining push calls changes their behaviour.
        'unicorn/prefer-single-call': [
          'error',
          { ignore: ['request.push', 'correlator.push', 'excessLegacy.correlator.push'] },
        ],
      },
    },
  ],
})
