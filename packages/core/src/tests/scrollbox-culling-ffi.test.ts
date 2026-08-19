// Wave-4 R-08: culled-layout FFI round-trip reduction.
//
// The culled child-refresh path (Renderable) calls updateFromLayout() on every
// child before viewport culling so screen coordinates are current. That is one
// getComputedLayout FFI read per child per rebuild frame — even on scroll frames
// where the Yoga layout is unchanged (only a translate on the content shifted
// the children). The layout-generation guard in updateFromLayout must elide the
// FFI read when no Yoga layout pass ran since the node was last read, while
// keeping culling correct (live screen getters still reflect the translate).

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createTestRenderer, type TestRenderer } from "../testing.js"
import { ManualClock } from "../testing/manual-clock.js"
import { ScrollBoxRenderable } from "../renderables/ScrollBox.js"
import { TextRenderable } from "../renderables/Text.js"
import { createWave3ScalingCounters } from "../benchmark/wave3-scaling-counters.js"

let testRenderer: TestRenderer
let renderOnce: () => Promise<void>
let clock: ManualClock

beforeEach(async () => {
  clock = new ManualClock()
  ;({ renderer: testRenderer, renderOnce } = await createTestRenderer({ width: 50, height: 10, clock }))
})

afterEach(() => {
  testRenderer.destroy()
})

function buildCulledScrollBox(count: number): ScrollBoxRenderable {
  const scrollBox = new ScrollBoxRenderable(testRenderer, {
    width: "100%",
    height: "100%",
    viewportCulling: true,
  })
  for (let i = 0; i < count; i++) {
    scrollBox.add(new TextRenderable(testRenderer, { content: `row-${i}`, height: 1 }))
  }
  testRenderer.root.add(scrollBox)
  return scrollBox
}

test("scroll frame with stable yoga layout performs zero updateFromLayout FFI reads", async () => {
  const scrollBox = buildCulledScrollBox(300)
  testRenderer.root.add(scrollBox)

  // Settle into a steady state: initial build + one dirty-settling frame, so the
  // retained render list is reusable and Yoga has no pending recalculation.
  await renderOnce()
  await renderOnce()
  await renderOnce()

  const counters = createWave3ScalingCounters()
  testRenderer.attachWave3ScalingCounters(counters)

  scrollBox.scrollTop = 50
  await renderOnce()
  await renderOnce() // scroll viewport settles to its own steady state

  testRenderer.attachWave3ScalingCounters(null)

  // Only the initial scroll frame may rebuild; the follow-up reinstates reuse.
  expect(counters.renderListRebuilds).toBeLessThanOrEqual(1)
  // Yoga never recalculated during the scroll: dirty subtree count stays 0, so
  // the per-child updateFromLayout reads must have been skipped by the epoch guard.
  expect(counters.dirtySubtreeLayouts).toBe(0)
  expect(counters.updateFromLayoutFfiCalls).toBe(0)
})

test("culling stays correct while scrolling (visible rows render, hidden rows elide)", async () => {
  const scrollBox = buildCulledScrollBox(300)
  testRenderer.root.add(scrollBox)

  await renderOnce()
  await renderOnce()

  scrollBox.scrollTop = 42
  await renderOnce()

  const counters = createWave3ScalingCounters()
  testRenderer.attachWave3ScalingCounters(counters)
  await renderOnce()
  testRenderer.attachWave3ScalingCounters(null)

  // Culling must keep the render list bounded to the viewport even though 300
  // children exist off-screen (did not regress to full-child traversal).
  expect(counters.renderCommands).toBeGreaterThan(0)
  expect(counters.renderCommands).toBeLessThan(60)
})

test("real layout mutation escapes the FFI guard (dirty subtree ⇒ reads + fresh geometry)", async () => {
  const scrollBox = buildCulledScrollBox(300)
  testRenderer.root.add(scrollBox)

  // Settle into steady state so the guard would be active on the next frame.
  await renderOnce()
  await renderOnce()
  await renderOnce()

  // A new child appended far below the viewport: its layout is unknown until a
  // real Yoga recalc reads it, so the epoch guard must NOT serve a stale zero.
  const MARKER = "marker-row-333"
  scrollBox.add(new TextRenderable(testRenderer, { content: MARKER, height: 1 }))
  await renderOnce() // dirty-subtree layout pass; marker layout is read via FFI

  const counters = createWave3ScalingCounters()
  testRenderer.attachWave3ScalingCounters(counters)
  await renderOnce() // settle follow-up frame
  testRenderer.attachWave3ScalingCounters(null)

  // Guard must not suppress the mandatory read on a genuinely dirty subtree.
  expect(counters.updateFromLayoutFfiCalls).toBeGreaterThan(0)

  // Fresh geometry: scroll the marker into view; its content must render.
  scrollBox.scrollTop = 300
  await renderOnce()
  const counter2 = createWave3ScalingCounters()
  testRenderer.attachWave3ScalingCounters(counter2)
  await renderOnce()
  testRenderer.attachWave3ScalingCounters(null)
  expect(counter2.renderCommands).toBeGreaterThan(0)
  expect(counter2.renderCommands).toBeLessThan(60) // culling still bounds output
})
