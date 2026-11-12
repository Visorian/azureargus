import { defineCommitlintConfig } from '@visorian/code-standards/commitlint'

export default defineCommitlintConfig({
  scopes: ['frontend', 'docs', 'deps', 'config', 'ci', 'release'],
})
