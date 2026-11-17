import { defineOxlintConfig } from '@visorian/code-standards/oxlint'

export default defineOxlintConfig({
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
