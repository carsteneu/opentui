import { createTestRenderer, type TestRenderer } from "../../testing/test-renderer.js"
import {
  getRendererConsoleIntegration,
  getRendererLastDestroyCleanups,
  registerRendererConsoleIntegration,
  registerRendererLastDestroyCleanup,
} from "../../renderer-integration.js"

let renderer: TestRenderer | null = null
let secondRenderer: TestRenderer | null = null

try {
  const first = await createTestRenderer({ width: 20, height: 8, consoleMode: "disabled" })
  renderer = first.renderer
  await first.renderOnce()

  if (renderer.consoleMode !== "disabled") throw new Error("lean renderer enabled the console integration")

  let consoleUnavailable = false
  try {
    void renderer.console
  } catch (error) {
    consoleUnavailable = error instanceof Error && error.message.includes("Console overlay is not installed")
  }
  if (!consoleUnavailable) throw new Error("lean renderer exposed an unregistered console")

  let explicitOverlayRejected = false
  try {
    await createTestRenderer({ width: 20, height: 8, consoleMode: "console-overlay" })
  } catch (error) {
    explicitOverlayRejected = error instanceof Error && error.message.includes("Console overlay is not installed")
  }
  if (!explicitOverlayRejected) throw new Error("lean renderer accepted an unregistered explicit console overlay")

  const second = await createTestRenderer({ width: 20, height: 8, consoleMode: "disabled" })
  secondRenderer = second.renderer
  const originalConsole = global.console
  const consoleEntry = await import("../../console-entry.js")

  const firstConsole = renderer.console
  const firstConsoleAgain = renderer.console
  if (firstConsole !== firstConsoleAgain) throw new Error("late console integration materialized more than once")
  if ((firstConsole as any).clock !== (renderer as any).clock) {
    throw new Error("late console integration did not retain the renderer clock")
  }

  renderer.consoleMode = "console-overlay"
  if (renderer.consoleMode !== "console-overlay") throw new Error("late console integration did not activate")
  renderer.consoleMode = "disabled"
  if (global.console !== originalConsole) throw new Error("late console integration did not restore global console")

  const secondConsole = secondRenderer.console
  if (secondConsole === firstConsole) throw new Error("two renderers shared one TerminalConsole owner")
  const secondKeypressBaseline = secondRenderer.keyInput.listenerCount("keypress")
  secondConsole.show()
  const consoleListenerAttached = secondRenderer.keyInput.listenerCount("keypress") === secondKeypressBaseline + 1
  if (!consoleListenerAttached) throw new Error("late console integration did not attach its key listener exactly once")

  const originalConsoleIntegration = getRendererConsoleIntegration()
  if (!originalConsoleIntegration) throw new Error("late console import did not register an integration owner")
  const unregisterFirstConsoleOwner = registerRendererConsoleIntegration({
    create() {
      throw new Error("first test console owner must not materialize")
    },
    claimCapturedOutput() {
      return ""
    },
  })
  const unregisterSecondConsoleOwner = registerRendererConsoleIntegration({
    create() {
      throw new Error("second test console owner must not materialize")
    },
    claimCapturedOutput() {
      return ""
    },
  })
  unregisterFirstConsoleOwner()
  unregisterSecondConsoleOwner()
  const consoleOwnerDidNotResurrect = getRendererConsoleIntegration() === originalConsoleIntegration
  if (!consoleOwnerDidNotResurrect) throw new Error("unregistered console integration owner was resurrected")

  const cleanupId = "renderer-lean-lifecycle-owner"
  const unregisterFirstCleanupOwner = registerRendererLastDestroyCleanup({
    id: cleanupId,
    description: "first test cleanup owner",
    run() {},
  })
  const unregisterSecondCleanupOwner = registerRendererLastDestroyCleanup({
    id: cleanupId,
    description: "second test cleanup owner",
    run() {},
  })
  unregisterFirstCleanupOwner()
  unregisterSecondCleanupOwner()
  const cleanupOwnerDidNotResurrect = !getRendererLastDestroyCleanups().some((cleanup) => cleanup.id === cleanupId)
  if (!cleanupOwnerDidNotResurrect) throw new Error("unregistered last-destroy cleanup owner was resurrected")

  consoleEntry.capture.write("stdout", "late-capture")
  ;(renderer as any).dumpOutputCache()
  const capturedOutputClaimed = consoleEntry.capture.size === 0
  if (!capturedOutputClaimed) throw new Error("late console integration retained the constructor-time no-op capture")

  renderer.destroy()
  secondRenderer.consoleMode = "console-overlay"
  secondRenderer.consoleMode = "disabled"
  secondRenderer.destroy()
  const consoleListenerReleased = secondRenderer.keyInput.listenerCount("keypress") === secondKeypressBaseline
  if (!consoleListenerReleased) throw new Error("late console integration leaked its key listener after destroy")

  if (!renderer.isDestroyed || !secondRenderer.isDestroyed) throw new Error("late-integrated renderers did not destroy")

  process.stdout.write(
    `${JSON.stringify({
      kind: "renderer-lean-lifecycle",
      consoleMode: renderer.consoleMode,
      consoleUnavailable,
      explicitOverlayRejected,
      lateConsoleMaterialized: firstConsole === firstConsoleAgain,
      capturedOutputClaimed,
      separateConsoleOwners: firstConsole !== secondConsole,
      consoleOwnerDidNotResurrect,
      cleanupOwnerDidNotResurrect,
      consoleListenerAttached,
      consoleListenerReleased,
      destroyed: renderer.isDestroyed,
    })}\n`,
  )
} finally {
  renderer?.destroy()
  secondRenderer?.destroy()
}
