// oxlint-disable-next-line unicorn/prefer-node-protocol -- bare specifier is aliased to the npm `buffer` polyfill for the browser bundle
import { Buffer } from 'buffer'
// oxlint-disable-next-line unicorn/prefer-node-protocol -- bare specifier is aliased to `process/browser` for the browser bundle
import process from 'process'

// Node globals are declared by @types/node but may be missing in the browser, so widen them before polyfilling.
const globals: { Buffer?: typeof Buffer; process?: Partial<typeof process> } = globalThis

export default defineNuxtPlugin(() => {
  const existingProcess = globals.process

  globals.Buffer ??= Buffer
  globals.process = {
    ...process,
    ...existingProcess,
    env: {
      ...process.env,
      ...existingProcess?.env,
    },
    nextTick: process.nextTick.bind(process),
  }
})
