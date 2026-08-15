import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { TextRenderable } from "../renderables/Text.js"
import { getTelemetrySnapshot, isTelemetryEnabled, resetTelemetry, setTelemetryEnabled } from "../telemetry.js"
import { createTestRenderer, type TestRenderer } from "../testing/test-renderer.js"

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

  test("constructor + first frame emit B7 lifecycle marks", async () => {
    const testRenderer = await createTestRenderer({ width: 10, height: 4, useThread: false })
    renderer = testRenderer.renderer
    const text = new TextRenderable(renderer, { content: "abc", width: 3, height: 1 })
    renderer.root.add(text)

    const marks: string[] = getTelemetrySnapshot().marks.map((m) => m.name)
    expect(marks).toContain("opentui.nativeLoaded")
    expect(marks).toContain("opentui.rendererCreated")

    await testRenderer.renderOnce()

    const afterMarks: string[] = getTelemetrySnapshot().marks.map((m) => m.name)
    expect(afterMarks).toContain("opentui.firstJsRender")
    expect(afterMarks).toContain("opentui.firstNativeCommit")
    expect(afterMarks).toContain("opentui.firstOutputWrite")
  })

  test("renderOnce records one full request frame with explained histogram", async () => {
    const testRenderer = await createTestRenderer({ width: 10, height: 4, useThread: false })
    renderer = testRenderer.renderer
    const text = new TextRenderable(renderer, { content: "abc", width: 3, height: 1 })
    renderer.root.add(text)
    await testRenderer.renderOnce()

    const counters = getTelemetrySnapshot().counters
    const hist = getTelemetrySnapshot().histogram
    const total = counters["frame.total"] ?? 0
    const explained =
      (hist["frame.type.full"] ?? 0) + (hist["frame.type.partial"] ?? 0) + (hist["frame.type.splitFooter"] ?? 0)
    expect(total).toBeGreaterThanOrEqual(1)
    // every frame falls into exactly one source bucket
    expect(counters["frame.source.request"] ?? 0).toBe(total)
    // Every frame is exactly one of full/partial/splitFooter -> 100% explained.
    expect(explained).toBe(total)
    expect(hist["frame.type.full"] ?? 0).toBe(total)
    expect(counters["frame.native.rendered"] ?? 0).toBe(total)
  })

  test("multiple rendered frames keep the explained invariant", async () => {
    const testRenderer = await createTestRenderer({ width: 10, height: 4, useThread: false })
    renderer = testRenderer.renderer
    const text = new TextRenderable(renderer, { content: "abc", width: 3, height: 1 })
    renderer.root.add(text)
    await testRenderer.renderOnce()
    await testRenderer.renderOnce()
    await testRenderer.renderOnce()

    const counters = getTelemetrySnapshot().counters
    const hist = getTelemetrySnapshot().histogram
    const explained =
      (hist["frame.type.full"] ?? 0) + (hist["frame.type.partial"] ?? 0) + (hist["frame.type.splitFooter"] ?? 0)
    expect(counters["frame.total"]).toBe(3)
    expect(explained).toBe(3)
    expect(counters["frame.native.rendered"]).toBe(3)
  })
})
