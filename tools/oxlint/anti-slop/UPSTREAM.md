# anti-slop (vendored subset)

Source: https://github.com/dmmulroy/anti-slop at commit `c44ef22` (2026-09-10), `src/`.

Only the rules enabled in `.oxlintrc.json` are vendored. Rule and shared files are unmodified
copies; `index.ts` registers the subset. `@oxlint/plugins` must stay pinned to the exact
`oxlint` version.

Vendored rules: no-chained-type-assertions, no-module-mocking, no-object-parameters,
no-reduce-accumulator-copy, no-reflect-apply, no-reflect-get, no-unknown-type-aliases,
no-unsafe-dictionary-type, no-widen-then-assert, require-safety-comment-for-type-assertion.
