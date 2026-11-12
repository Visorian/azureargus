import { defineOxfmtConfig } from '@visorian/code-standards/oxfmt'

export default defineOxfmtConfig({
  tailwindStylesheet: './app/assets/css/main.css',
  ignore: ['infrastructure/**/azuredeploy*.json'],
})
