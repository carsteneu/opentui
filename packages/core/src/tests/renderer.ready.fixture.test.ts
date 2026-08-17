import { expect, test } from "bun:test"
import { CliRenderEvents } from "../renderer.js"
import { ScrollBoxRenderable } from "../renderables/ScrollBox.js"
import { createReadyUiFixture } from "./fixtures/ready-ui-fixture.js"

test("fixture: commit a base surface, then load optional work, then application ready", async () => {
  const fixture = await createReadyUiFixture()

  try {
    fixture.renderText("basic app")

    // Optional tooling has not started before the base frame is committed.
    expect(fixture.loader.started).toBe(false)
    expect(fixture.ready.state.firstFrameCommitted).toBe(false)

    await fixture.renderOnce()
    await fixture.ready.firstFrameCommitted
    expect(fixture.ready.state.enhanced).toBe("pending")

    // Optional work begins only after the base surface is committed.
    const optional = fixture.loader.start()
    optional.then(() => fixture.ready.markEnhancedReady())
    expect(fixture.loader.started).toBe(true)

    fixture.loader.settleOk("toolkit")
    await fixture.ready.enhancedSettled
    expect(fixture.ready.state.enhanced).toBe("ok")
    expect(fixture.ready.state.firstFrameCommitted).toBe(true)

    fixture.ready.markApplicationReady()
    await fixture.ready.applicationReady
    expect(fixture.ready.state.applicationReady).toBe(true)
  } finally {
    fixture.ready.destroy()
    fixture.renderer.destroy()
  }
})

test("fixture: focus and escape stay functional and an optional failure does not undo the base frame", async () => {
  const fixture = await createReadyUiFixture()

  try {
    fixture.renderText("basic app")
    await fixture.renderOnce()
    await fixture.ready.firstFrameCommitted

    // Optional work is now loading (pending), not yet marked complete.
    const optional = fixture.loader.start()

    // Focus handling stays functional while optional work loads.
    const box = new ScrollBoxRenderable(fixture.renderer, { id: "box", width: 20, height: 10 })
    fixture.renderer.root.add(box)
    await fixture.renderOnce()
    await fixture.mockMouse.click(box.x + 1, box.y + 1)
    expect(box.focused).toBe(true)

    // Escape/cancel path stays functional while optional work loads.
    fixture.mockInput.pressEscape()
    await fixture.renderOnce()

    // A controlled optional failure is marked by the consumer and must not
    // undo the already-visible base frame.
    fixture.loader.settleFail(new Error("optional toolkit failed"))
    await optional.catch(() => {})
    fixture.ready.markEnhancedFailed(new Error("optional toolkit failed"))

    const outcome = await fixture.ready.enhancedSettled
    expect(outcome.ok).toBe(false)
    expect(fixture.ready.state.firstFrameCommitted).toBe(true)
    expect(fixture.ready.state.enhanced).toBe("failed")

    // The renderer is still alive and emitting frames after the failure.
    let frames = 0
    fixture.renderer.on(CliRenderEvents.FRAME, () => frames++)
    await fixture.renderOnce()
    expect(frames).toBeGreaterThan(0)
  } finally {
    fixture.ready.destroy()
    fixture.renderer.destroy()
  }
})
