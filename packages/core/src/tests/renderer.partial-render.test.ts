import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { TextRenderable } from "../renderables/Text.js"
import { ManualClock } from "../testing/manual-clock.js"
import { createTestRenderer, type TestRenderer } from "../testing/test-renderer.js"
import type { Renderable } from "../Renderable.js"
import type { OptimizedBuffer } from "../buffer.js"
import { CliRenderEvents, type CliRendererErrorEvent } from "../renderer.js"

const STATUS_RENDERED = 0
const STATUS_SKIPPED = 1
const STATUS_FAILED = 2

type PartialRenderRegion = {
  x: number
  y: number
  width: number
  height: number
}

type RendererInternals = {
  lib: {
    render: (...args: unknown[]) => number
    renderPartial: (...args: unknown[]) => number
    hasActiveImageState: (...args: unknown[]) => boolean
  }
  lastFrameCommitted: boolean
  forceFullRepaintRequested: boolean
  _useThread: boolean
  _usesProcessStdout: boolean
  partialRequests: Set<Renderable>
  partialFramePending: boolean
  ordinaryRenderGeneration: number
  committedOrdinaryRenderGeneration: number
  canPartialRender: () => boolean
  renderPartialFrame: (deltaTime: number) => PartialRenderRegion | null
  renderTimeout: unknown
  updateScheduled: boolean
  loop: () => Promise<void>
}

class CallbackTextRenderable extends TextRenderable {
  public onRender?: () => void

  public override render(buffer: OptimizedBuffer, deltaTime: number): void {
    this.onRender?.()
    super.render(buffer, deltaTime)
  }
}

describe("partial rendering", () => {
  let renderer: TestRenderer
  let clock: ManualClock

  beforeEach(async () => {
    clock = new ManualClock()
    ;({ renderer } = await createTestRenderer({ clock, useThread: false }))
  })

  afterEach(() => {
    renderer.destroy()
  })

  test("tracks whether native output committed", async () => {
    const internals = renderer as unknown as RendererInternals
    const originalRender = internals.lib.render
    try {
      expect(internals.lastFrameCommitted).toBe(true)

      internals.lib.render = () => STATUS_FAILED
      renderer.requestRender()
      clock.advance(20)
      await Promise.resolve()
      await Promise.resolve()

      expect(internals.lastFrameCommitted).toBe(false)
      expect(internals.forceFullRepaintRequested).toBe(false)

      internals.lib.render = () => STATUS_RENDERED
      renderer.requestRender()
      clock.advance(20)
      await Promise.resolve()
      await Promise.resolve()

      expect(internals.lastFrameCommitted).toBe(true)
      expect(internals.forceFullRepaintRequested).toBe(false)
    } finally {
      internals.lib.render = originalRender
    }
  })

  test("treats threaded backpressure as uncommitted", async () => {
    const internals = renderer as unknown as RendererInternals
    const originalRender = internals.lib.render
    try {
      internals._useThread = true
      internals._usesProcessStdout = true
      internals.lib.render = () => STATUS_SKIPPED

      renderer.requestRender()
      clock.advance(20)
      await Promise.resolve()
      await Promise.resolve()

      expect(internals.lastFrameCommitted).toBe(false)
    } finally {
      internals.lib.render = originalRender
    }
  })

  test("rejects an uncommitted ordinary request without walking the tree", async () => {
    const internals = renderer as unknown as RendererInternals
    const target = new TextRenderable(renderer, { content: "partial", width: 7, height: 1 })
    renderer.root.add(target)
    target.setPartialEligible(true)
    await internals.loop()
    internals.partialRequests.add(target)
    internals.ordinaryRenderGeneration = 2
    internals.committedOrdinaryRenderGeneration = 1

    expect(internals.canPartialRender()).toBe(false)

    internals.committedOrdinaryRenderGeneration = 2
    expect(internals.canPartialRender()).toBe(true)
  })

  test("redraws only bounded cells without copying the full buffer", async () => {
    const internals = renderer as unknown as RendererInternals
    const target = new TextRenderable(renderer, {
      content: "ok",
      position: "absolute",
      left: 5,
      top: 3,
      width: 2,
      height: 1,
    })
    renderer.root.add(target)
    await internals.loop()
    const drawSpy = spyOn(renderer.nextRenderBuffer, "drawFrameBuffer")
    internals.partialRequests.add(target)

    expect(internals.renderPartialFrame(16)).toEqual({ x: 4, y: 3, width: 4, height: 1 })
    expect(drawSpy).not.toHaveBeenCalled()
  })

  test("dispatches eligible frames through the native region entrypoint", async () => {
    const internals = renderer as unknown as RendererInternals
    const target = new TextRenderable(renderer, {
      content: "ok",
      position: "absolute",
      left: 5,
      top: 3,
      width: 2,
      height: 1,
    })
    renderer.root.add(target)
    target.setPartialEligible(true)
    await internals.loop()
    const originalRenderPartial = internals.lib.renderPartial.bind(internals.lib)
    const calls: unknown[][] = []

    try {
      internals.lib.renderPartial = (...args) => {
        calls.push(args)
        return originalRenderPartial(...args)
      }
      target.requestRender()
      await internals.loop()

      expect(calls).toHaveLength(1)
      expect(calls[0].slice(1)).toEqual([4, 3, 4, 1])
    } finally {
      internals.lib.renderPartial = originalRenderPartial
    }
  })

  test("normal requests leave partial coalescing to the frame guard", () => {
    const internals = renderer as unknown as RendererInternals
    const target = new TextRenderable(renderer, { content: "partial", width: 7, height: 1 })
    renderer.root.add(target)
    internals.partialFramePending = true
    internals.partialRequests.add(target)

    renderer.requestRender()

    expect(internals.partialFramePending).toBe(true)
    expect(internals.partialRequests).toContain(target)
  })

  test("promotes partial requests while native image state is active", async () => {
    const internals = renderer as unknown as RendererInternals
    const originalHasActiveImageState = internals.lib.hasActiveImageState
    const target = new TextRenderable(renderer, { content: "partial", width: 7, height: 1 })
    renderer.root.add(target)
    target.setPartialEligible(true)
    await internals.loop()
    internals.partialRequests.add(target)

    try {
      internals.lib.hasActiveImageState = () => true
      expect(internals.canPartialRender()).toBe(false)
    } finally {
      internals.lib.hasActiveImageState = originalHasActiveImageState
    }
  })

  test("rejects a detached partial renderable", async () => {
    const internals = renderer as unknown as RendererInternals
    const target = new TextRenderable(renderer, { content: "detached", width: 8, height: 1 })
    renderer.root.add(target)
    target.setPartialEligible(true)
    await internals.loop()
    renderer.root.remove(target)
    await internals.loop()
    internals.partialRequests.add(target)

    expect(internals.canPartialRender()).toBe(false)
  })

  test("promotes translated renderables so stale cells are cleared", async () => {
    const internals = renderer as unknown as RendererInternals
    const target = new TextRenderable(renderer, {
      content: "move",
      position: "absolute",
      left: 2,
      top: 1,
      width: 4,
      height: 1,
    })
    renderer.root.add(target)
    target.setPartialEligible(true)
    await internals.loop()

    target.translateX = 3

    expect(internals.partialRequests).toContain(target)
    expect(internals.canPartialRender()).toBe(false)
  })

  test("schedules a full follow-up for an ordinary request raised during a partial frame", async () => {
    const internals = renderer as unknown as RendererInternals
    const requestRender = renderer.requestRender.bind(renderer)
    internals.updateScheduled = false
    renderer.requestRender = () => {}
    const other = new TextRenderable(renderer, { content: "other", width: 5, height: 1 })
    let otherRequests = 0
    const target = new CallbackTextRenderable(renderer, {
      content: "partial",
      width: 7,
      height: 1,
    })
    renderer.root.add(other)
    renderer.root.add(target)
    target.setPartialEligible(true)
    await internals.loop()
    renderer.requestRender = requestRender
    target.onRender = () => {
      otherRequests++
      other.requestRender()
    }

    internals.partialRequests.add(target)
    internals.partialFramePending = true
    expect(internals.canPartialRender()).toBe(true)
    await internals.loop()

    expect(otherRequests).toBe(1)
    expect(internals.committedOrdinaryRenderGeneration).toBeLessThan(internals.ordinaryRenderGeneration)
    expect(internals.renderTimeout).not.toBeNull()
  })

  test("keeps a follow-up frame when a node remains dirty", async () => {
    const internals = renderer as unknown as RendererInternals
    const first = new TextRenderable(renderer, { content: "first" })
    renderer.root.add(first)
    renderer.addPostProcessFn(() => first.requestRender())

    await internals.loop()

    expect(first.isDirty).toBe(true)
    expect(internals.committedOrdinaryRenderGeneration).toBeLessThan(internals.ordinaryRenderGeneration)
    expect(internals.renderTimeout).not.toBeNull()
  })

  test("attributes partial render failures to the active renderable", async () => {
    const internals = renderer as unknown as RendererInternals
    const target = new CallbackTextRenderable(renderer, { content: "partial", width: 7, height: 1 })
    renderer.root.add(target)
    target.setPartialEligible(true)
    await internals.loop()
    const error = new Error("partial failed")
    let event: CliRendererErrorEvent | undefined
    renderer.on(CliRenderEvents.RENDER_ERROR, (value: CliRendererErrorEvent) => {
      event = value
    })
    target.onRender = () => {
      throw error
    }

    target.requestRender()
    await internals.loop()

    expect(event).toEqual({ error, renderable: target })
    expect(internals.lastFrameCommitted).toBe(false)
  })
})
