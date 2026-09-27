// ESLint only lints Vue templates; everything else is covered by oxlint (.oxlintrc.json).
import tsParser from '@typescript-eslint/parser'
import oxlint from 'eslint-plugin-oxlint'
import vue from 'eslint-plugin-vue'

// Layout rules that conflict with oxfmt.
const formatterRules = Object.fromEntries(
  [
    'vue/first-attribute-linebreak',
    'vue/html-closing-bracket-newline',
    'vue/html-closing-bracket-spacing',
    'vue/html-indent',
    'vue/html-quotes',
    'vue/max-attributes-per-line',
    'vue/multiline-html-element-content-newline',
    'vue/mustache-interpolation-spacing',
    'vue/no-multi-spaces',
    'vue/no-spaces-around-equal-signs-in-attribute',
    'vue/singleline-html-element-content-newline',
  ].map((rule) => [rule, 'off']),
)

const config = [
  { ignores: ['**/.nuxt/**', '**/.output/**', '**/dist/**'] },
  ...vue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: { parser: tsParser },
    },
    rules: {
      ...formatterRules,
      'vue/block-lang': ['error', { script: { lang: 'ts' } }],
      'vue/block-order': ['error', { order: ['script', 'template', 'style'] }],
      'vue/component-api-style': ['error', ['script-setup']],
      'vue/component-name-in-template-casing': [
        'error',
        'PascalCase',
        { registeredComponentsOnly: false },
      ],
      'vue/custom-event-name-casing': ['error', 'camelCase'],
      'vue/define-macros-order': [
        'error',
        { order: ['defineOptions', 'defineModel', 'defineProps', 'defineEmits', 'defineSlots'] },
      ],
      'vue/eqeqeq': 'error',
      'vue/html-button-has-type': 'error',
      'vue/html-self-closing': [
        'error',
        {
          html: { void: 'always', normal: 'always', component: 'always' },
          svg: 'always',
          math: 'always',
        },
      ],
      'vue/no-constant-condition': 'error',
      'vue/no-duplicate-attr-inheritance': 'error',
      'vue/no-empty-component-block': 'error',
      'vue/no-implicit-coercion': 'error',
      'vue/no-multiple-objects-in-class': 'error',
      'vue/no-ref-object-reactivity-loss': 'error',
      'vue/no-root-v-if': 'error',
      'vue/no-setup-props-reactivity-loss': 'error',
      'vue/no-static-inline-styles': 'error',
      'vue/no-template-target-blank': 'error',
      'vue/no-unused-emit-declarations': 'error',
      'vue/no-unused-properties': 'error',
      'vue/no-unused-refs': 'error',
      'vue/no-use-v-else-with-v-for': 'error',
      'vue/no-useless-concat': 'error',
      'vue/no-useless-mustaches': 'error',
      'vue/no-useless-v-bind': 'error',
      'vue/no-v-text': 'error',
      'vue/prefer-define-options': 'error',
      'vue/prefer-separate-static-class': 'error',
      'vue/prefer-template': 'error',
      'vue/prefer-true-attribute-shorthand': 'error',
      'vue/prefer-use-template-ref': 'error',
      'vue/require-explicit-slots': 'error',
      'vue/require-macro-variable-name': 'error',
      'vue/require-typed-object-prop': 'error',
      'vue/slot-name-casing': 'error',
    },
  },
  {
    files: ['app/app.vue', 'app/error.vue', 'app/layouts/**/*.vue', 'app/pages/**/*.vue'],
    rules: { 'vue/multi-word-component-names': 'off' },
  },
  // Must stay last: turns off every rule oxlint already enforces.
  ...oxlint.buildFromOxlintConfigFile('./.oxlintrc.json'),
]

export default config
