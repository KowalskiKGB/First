import { renameSync } from 'node:fs'

const TRANSIENT_WINDOWS_ERRORS = new Set(['EACCES', 'EBUSY', 'EPERM'])
const waitSync = delay => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay)

export function renameWithRetry(source, destination, { attempts = 20, rename = renameSync, wait = waitSync } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      rename(source, destination)
      return
    } catch (error) {
      if (!TRANSIENT_WINDOWS_ERRORS.has(error?.code) || attempt === attempts) throw error
      wait(250)
    }
  }
}
