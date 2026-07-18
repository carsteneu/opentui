import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test"
import { createTestRenderer, type TestRenderer } from "../testing/test-renderer.js"
import { ManualClock } from "../testing/manual-clock.js"
import { TextRenderable } from "../renderables/Text.js"

// Native render status codes (mirror NATIVE_RENDER_STATUS_* in renderer.ts)
const STATUS_RENDERED = 0
const STATUS_SKIPPED = 1
const STATUS_FAILED = 2

type RendererInternals = {
  lib: {
    render: (...args: unknown[]) => number
    renderPartial: (...args: unknown[]) => number
  }
  lastFrameCommitted: boolean
  forceFullRepaintRequested: boolean
  _useThread: boolean
  _usesProcessStdout: boolean
  partialRequests: Set<unknown>
  partialFramePending: boolean
  ordinaryRenderGeneration: number
  committedOrdinaryRenderGeneration: number
  canPartialRender: () => boolean
  renderPartialFrame: (deltaTime: number) => { x: number; y: number; width: number; height: number } | null
  feedIdleRenderScheduled: boolean
}

describe("partial-render commit guard", () => {
  let renderer: TestRenderer
  let clock: ManualClock

  beforeEach(async () => {
    clock = new ManualClock()
    ;({ renderer } = await createTestRenderer({ clock, useThread: false }))
  })

  afterEach(() => {
    renderer.destroy()
  })

  test("lastFrameCommitted starts true", () => {
    const internals = renderer as unknown as RendererInternals
    expect(internals.lastFrameCommitted).toBe(true)
  })

  test("native FAILED clears lastFrameCommitted", async () => {
    const internals = renderer as unknown as RendererInternals
    const originalRender = internals.lib.render
    internals.lib.render = () => STATUS_FAILED

    renderer.requestRender()
    clock.advance(20)
    await Promise.resolve()
    await Promise.resolve()

    expect(internals.lastFrameCommitted).toBe(false)
    expect(internals.forceFullRepaintRequested).toBe(true)

    internals.lib.render = originalRender
  })

  test("successful frame after failure restores lastFrameCommitted", async () => {
    const internals = renderer as unknown as RendererInternals
    const originalRender = internals.lib.render

    internals.lib.render = () => STATUS_FAILED
    renderer.requestRender()
    clock.advance(20)
    await Promise.resolve()
    await Promise.resolve()
    expect(internals.lastFrameCommitted).toBe(false)

    internals.lib.render = () => STATUS_RENDERED
    renderer.requestRender()
    clock.advance(20)
    await Promise.resolve()
    await Promise.resolve()
    expect(internals.lastFrameCommitted).toBe(true)
    expect(internals.forceFullRepaintRequested).toBe(false)

    internals.lib.render = originalRender
  })

  test("threaded backpressure clears lastFrameCommitted", async () => {
    const internals = renderer as unknown as RendererInternals
    const originalRender = internals.lib.render
    const originalUseThread = internals._useThread
    const originalUsesProcessStdout = internals._usesProcessStdout

    internals._useThread = true
    internals._usesProcessStdout = true
    internals.lib.render = () => STATUS_SKIPPED

    renderer.requestRender()
    clock.advance(20)
    await Promise.resolve()
    await Promise.resolve()

    expect(internals.lastFrameCommitted).toBe(false)

    internals.lib.render = originalRender
    internals._useThread = originalUseThread
    internals._usesProcessStdout = originalUsesProcessStdout
  })

  test("canPartialRender bails when lastFrameCommitted is false", () => {
    const internals = renderer as unknown as RendererInternals
    internals.lastFrameCommitted = false
    internals.forceFullRepaintRequested = false
    internals.partialRequests.add({
      isDestroyed: false,
      isInRenderPath: () => true,
    })
    expect(internals.canPartialRender()).toBe(false)
  })

  test("canPartialRender rejects an uncommitted ordinary render request without walking the tree", () => {
    const internals = renderer as unknown as RendererInternals
    internals.partialRequests.add({
      isDestroyed: false,
      isInRenderPath: () => true,
    })
    internals.ordinaryRenderGeneration = 2
    internals.committedOrdinaryRenderGeneration = 1

    expect(internals.canPartialRender()).toBe(false)

    internals.committedOrdinaryRenderGeneration = 2
    expect(internals.canPartialRender()).toBe(true)
  })

  test("renderPartialFrame redraws only the bounded region without copying the full buffer", () => {
    const internals = renderer as unknown as RendererInternals
    const drawSpy = spyOn(renderer.nextRenderBuffer, "drawFrameBuffer")

    let rendered = false
    internals.partialRequests.add({
      isDestroyed: false,
      screenX: 5,
      screenY: 3,
      width: 2,
      height: 1,
      renderPartial: () => {
        rendered = true
        return { x: 5, y: 3, width: 2, height: 1 }
      },
    })

    const result = internals.renderPartialFrame(16)

    expect(result).toEqual({ x: 4, y: 3, width: 4, height: 1 })
    expect(drawSpy).not.toHaveBeenCalled()
    expect(rendered).toBe(true)
  })

  test("requestRender does not eagerly clear a pending partial frame", () => {
    const internals = renderer as unknown as RendererInternals
    internals.partialFramePending = true
    internals.partialRequests.add({
      isDestroyed: false,
      isInRenderPath: () => true,
    })
    expect(internals.partialRequests.size).toBe(1)

    renderer.requestRender()

    // The partial queue survives; the loop's guard decides whether the next
    // frame is partial (no outside dirty) or full (Code dirty → bail).
    expect(internals.partialFramePending).toBe(true)
    expect(internals.partialRequests.size).toBe(1)
  })

  test("a render request handled later in the same full frame is acknowledged", async () => {
    const internals = renderer as unknown as RendererInternals
    const text = new TextRenderable(renderer, {
      content: "same frame",
      renderBefore() {
        this.requestRender()
      },
    })
    renderer.root.add(text)

    await (renderer as unknown as { loop: () => Promise<void> }).loop()

    expect(text.isDirty).toBe(false)
    expect(internals.committedOrdinaryRenderGeneration).toBe(internals.ordinaryRenderGeneration)
  })

  test("a request that dirties an already rendered node keeps the follow-up frame", async () => {
    const internals = renderer as unknown as RendererInternals & { renderTimeout: unknown }
    const first = new TextRenderable(renderer, { content: "first" })
    renderer.root.add(first)
    renderer.addPostProcessFn(() => first.requestRender())

    await (renderer as unknown as { loop: () => Promise<void> }).loop()

    expect(first.isDirty).toBe(true)
    expect(internals.committedOrdinaryRenderGeneration).toBeLessThan(internals.ordinaryRenderGeneration)
    expect(internals.renderTimeout).not.toBeNull()
  })

})
