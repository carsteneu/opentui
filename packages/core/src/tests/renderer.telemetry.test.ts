import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { TextRenderable } from "../renderables/Text.js"
import { getTelemetrySnapshot, isTelemetryEnabled, resetTelemetry, setTelemetryEnabled } from "../telemetry.js"
import { createTestRenderer, type TestRenderer } from "../testing/test-renderer.js"

const SOURCES = ["frame.source.rAF", "frame.source.requestPartial", "frame.source.timer", "frame.source.live", "frame.source.request"] as const

function explainedFrames(snap: ReturnType<typeof getTelemetrySnapshot>): number {
  return (
    (snap.histogram["frame.type.full"] ?? 0) +
    (snap.histogram["frame.type.partial"] ?? 0) +
    (snap.histogram["frame.type.splitFooter"] ?? 0)
  )
}

function sourcedFrames(snap: ReturnType<typeof getTelemetrySnapshot>): number {
  return SOURCES.reduce((sum, source) => sum + (snap.counters[source] ?? 0), 0)
}

describe("renderer frame telemetry (A2/B7)", () => {
  let renderer: TestRenderer | null = null

  beforeEach(() => {
    setTelemetryEnabled(true)
  })

  afterEach(async () => {
    renderer?.destroy()
    renderer = null
    setTelemetryEnabled(false)
    resetTelemetry()
  })

  test("disabled telemetry records nothing (zero-cost off state)", async () => {
    setTelemetryEnabled(false)
    resetTelemetry()
    const testRenderer = await createTestRenderer({ width: 10, height: 4, useThread: false })
    renderer = testRenderer.renderer
    const text = new TextRenderable(renderer, { content: "abc", width: 3, height: 1 })
    renderer.root.add(text)
    await testRenderer.renderOnce()
    expect(isTelemetryEnabled()).toBe(false)
    const snap = getTelemetrySnapshot()
    expect(snap.enabled).toBe(false)
    expect(snap.counters).toEqual({})
    expect(snap.marks).toEqual([])
  })

  test("constructor + first JS-visible frame emit B7 lifecycle marks", async () => {
    const testRenderer = await createTestRenderer({ width: 10, height: 4, useThread: false })
    renderer = testRenderer.renderer
    const text = new TextRenderable(renderer, { content: "abc", width: 3, height: 1 })
    renderer.root.add(text)

    // rendererCreated fires in the CliRenderer constructor (post-enable).
    expect(getTelemetrySnapshot().marks.map((m) => m.name)).toContain("opentui.rendererCreated")

    await testRenderer.renderOnce()

    const afterMarks: string[] = getTelemetrySnapshot().marks.map((m) => m.name)
    expect(afterMarks).toContain("opentui.firstJsRender")
    expect(afterMarks).toContain("opentui.firstNativeCommit")
    // TestRenderer uses memory-buffered output, so an observed output write mark
    // must NOT fire — it is only claimed against a real sink (process stdout/feed).
    expect(afterMarks).not.toContain("opentui.firstOutputWrite")
  })

  test("renderOnce records one full request frame, fully explained by type AND source", async () => {
    const testRenderer = await createTestRenderer({ width: 10, height: 4, useThread: false })
    renderer = testRenderer.renderer
    const text = new TextRenderable(renderer, { content: "abc", width: 3, height: 1 })
    renderer.root.add(text)
    await testRenderer.renderOnce()

    const snap = getTelemetrySnapshot()
    const total = snap.counters["frame.total"] ?? 0
    expect(total).toBeGreaterThanOrEqual(1)
    // 100% explained by type (full/partial/splitFooter) AND by source bucket.
    expect(explainedFrames(snap)).toBe(total)
    expect(sourcedFrames(snap)).toBe(total)
    expect(snap.histogram["frame.type.full"] ?? 0).toBe(total)
    expect(snap.counters["frame.source.request"] ?? 0).toBe(total)
    expect(snap.counters["frame.native.rendered"] ?? 0).toBe(total)
  })

  test("multiple rendered frames keep the explained invariant across type and source", async () => {
    const testRenderer = await createTestRenderer({ width: 10, height: 4, useThread: false })
    renderer = testRenderer.renderer
    const text = new TextRenderable(renderer, { content: "abc", width: 3, height: 1 })
    renderer.root.add(text)
    await testRenderer.renderOnce()
    await testRenderer.renderOnce()
    await testRenderer.renderOnce()

    const snap = getTelemetrySnapshot()
    expect(snap.counters["frame.total"]).toBe(3)
    expect(explainedFrames(snap)).toBe(3)
    expect(sourcedFrames(snap)).toBe(3)
    expect(snap.counters["frame.native.rendered"]).toBe(3)
  })

  test("partial render records a requestPartial source and partial type, still fully explained", async () => {
    const testRenderer = await createTestRenderer({ width: 10, height: 4, useThread: false })
    renderer = testRenderer.renderer
    const text = new TextRenderable(renderer, { content: "abc", width: 3, height: 1 })
    renderer.root.add(text)
    await testRenderer.renderOnce()

    // Initial full frame established a committed base; now request a partial
    // render of the mounted renderable and drive one coalesced frame.
    renderer.requestPartialRender(text)
    await testRenderer.renderOnce()

    const snap = getTelemetrySnapshot()
    const total = snap.counters["frame.total"] ?? 0
    expect(total).toBeGreaterThanOrEqual(2)
    expect(explainedFrames(snap)).toBe(total)
    expect(sourcedFrames(snap)).toBe(total)
    // The second frame is a partial request; partial type must be present.
    expect((snap.histogram["frame.type.partial"] ?? 0)).toBeGreaterThanOrEqual(1)
    expect((snap.counters["frame.source.requestPartial"] ?? 0)).toBeGreaterThanOrEqual(1)
  })
})
