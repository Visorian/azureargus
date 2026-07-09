import { Buffer } from "buffer";
import process from "process";

const globals = globalThis as typeof globalThis & {
  Buffer?: typeof Buffer;
  process?: Partial<typeof process>;
};

export default defineNuxtPlugin(() => {
  const existingProcess = globals.process;

  globals.Buffer ??= Buffer;
  globals.process = {
    ...process,
    ...existingProcess,
    env: {
      ...process.env,
      ...existingProcess?.env,
    },
    nextTick: process.nextTick,
  };
});
