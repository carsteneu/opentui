import { expect, test } from "bun:test"

import {
  getRendererConsoleIntegration,
  getRendererLastDestroyCleanups,
  registerRendererLastDestroyCleanup,
} from "../renderer-integration.js"
import { createTestRenderer } from "../testing/test-renderer.js"

test("lean renderer constructs and destroys without optional integrations", async () => {
  const first = await createTestRenderer({ width: 20, height: 8, consoleMode: "disabled" })

  try {
    expect(first.renderer.consoleMode).toBe("disabled")
    expect(() => first.renderer.console).toThrow("Console overlay is not installed")
    await expect(createTestRenderer({ width: 20, height: 8, consoleMode: "console-overlay" })).rejects.toThrow(
      "Console overlay is not installed",
    )
  } finally {
    first.renderer.destroy()
  }

  expect(first.renderer.isDestroyed).toBe(true)
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
