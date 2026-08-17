import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import {
  getRendererConsoleIntegration,
  getRendererLastDestroyCleanups,
  registerRendererLastDestroyCleanup,
} from "../renderer-integration.js"
import { createTestRenderer } from "../testing/test-renderer.js"

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..")

test("lean renderer constructs and destroys without optional integrations", () => {
  const fixturePath = resolve(packageDir, "src/tests/fixtures/renderer-lean-lifecycle.ts")
  const result = spawnSync(process.execPath, [fixturePath], { encoding: "utf8" })

  expect(result.status, result.stderr || result.stdout).toBe(0)
  expect(result.stdout.trim()).toBe(
    JSON.stringify({
      kind: "renderer-lean-lifecycle",
      consoleMode: "disabled",
      consoleUnavailable: true,
      explicitOverlayRejected: true,
      destroyed: true,
    }),
  )
})

test("root import installs console ownership and runs optional cleanup only after the last renderer", async () => {
  await import("../index.js")

  expect(getRendererConsoleIntegration()).not.toBeNull()
  expect(getRendererLastDestroyCleanups().some((cleanup) => cleanup.id === "tree-sitter-client")).toBe(true)

  let cleanupCalls = 0
  const unregister = registerRendererLastDestroyCleanup({
    id: "renderer-integration-test",
    description: "renderer integration test",
    run() {
      cleanupCalls++
    },
  })

  const first = await createTestRenderer({ width: 20, height: 8, consoleMode: "disabled" })
  const second = await createTestRenderer({ width: 20, height: 8, consoleMode: "disabled" })

  try {
    expect(first.renderer.console.constructor.name).toBe("TerminalConsole")
    expect(second.renderer.console.constructor.name).toBe("TerminalConsole")

    first.renderer.destroy()
    await Promise.resolve()
    expect(cleanupCalls).toBe(0)

    second.renderer.destroy()
    await Promise.resolve()
    expect(cleanupCalls).toBe(1)
  } finally {
    first.renderer.destroy()
    second.renderer.destroy()
    unregister()
  }
})
