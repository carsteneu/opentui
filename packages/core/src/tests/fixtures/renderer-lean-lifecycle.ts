import { createTestRenderer, type TestRenderer } from "../../testing/test-renderer.js"

let renderer: TestRenderer | null = null

try {
  const first = await createTestRenderer({ width: 20, height: 8, consoleMode: "disabled" })
  renderer = first.renderer

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

  renderer.destroy()
  if (!renderer.isDestroyed) throw new Error("lean renderer did not destroy")

  process.stdout.write(
    `${JSON.stringify({
      kind: "renderer-lean-lifecycle",
      consoleMode: renderer.consoleMode,
      consoleUnavailable,
      explicitOverlayRejected,
      destroyed: renderer.isDestroyed,
    })}\n`,
  )
} finally {
  renderer?.destroy()
}
