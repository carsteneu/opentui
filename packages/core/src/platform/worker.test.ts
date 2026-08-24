import { test, expect } from "bun:test"
import { fileURLToPath } from "node:url"

import { resolveWorkerSpecifier } from "./worker.js"

const sourceFallback = new URL("./worker-startup.fixture.ts", import.meta.url)
const existingBundlePath = fileURLToPath(new URL("./worker-startup.fixture.ts", import.meta.url))
const missingBundlePath = fileURLToPath(new URL("./does-not-exist.worker.js", import.meta.url))

test("keeps an existing worker bundle path verbatim", () => {
  const resolved = resolveWorkerSpecifier(existingBundlePath, sourceFallback)
  expect(resolved).toBe(existingBundlePath)
})

test("falls back to the source entrypoint when the bundle is missing on a source-capable runtime", () => {
  const resolved = resolveWorkerSpecifier(missingBundlePath, sourceFallback)
  expect(resolved).toBe(sourceFallback.href)
})

test("does not fall back when the runtime cannot execute source entrypoints", () => {
  const resolved = resolveWorkerSpecifier(missingBundlePath, sourceFallback, false)
  expect(resolved).toBe(missingBundlePath)
})

test("does not fall back without a source fallback", () => {
  const resolved = resolveWorkerSpecifier(missingBundlePath, undefined)
  expect(resolved).toBe(missingBundlePath)
})

test("passes URL specifiers through unchanged without checking for a source fallback", () => {
  const url = new URL("./does-not-exist.worker.js", import.meta.url)
  const resolved = resolveWorkerSpecifier(url, sourceFallback)
  expect(resolved).toBe(url)
})

test("passes runtime scheme specifiers through unchanged", () => {
  const remote = "https://example.com/worker.mjs"
  const resolved = resolveWorkerSpecifier(remote, sourceFallback)
  expect(resolved).toBe(remote)

  const data = "data:text/javascript,postMessage(1)"
  const dataResolved = resolveWorkerSpecifier(data, sourceFallback)
  expect(dataResolved).toBe(data)
})
