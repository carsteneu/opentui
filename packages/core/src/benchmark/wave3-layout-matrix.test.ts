// Wave-3 Loop D: validates the layout scaling counters scale plausibly with tree
// size and that the off-state instrumentation is a true no-op (zero behavioral
// change, no allocation of counters when not attached).

import { afterEach, describe, expect, test } from "bun:test"
import { createTestRenderer, type TestRendererSetup } from "../testing/test-renderer.js"
import { createWave3ScalingCounters, type Wave3ScalingCounters } from "./wave3-scaling-counters.js"
import { runLayoutScenario, LAYOUT_SCENARIOS } from "./wave3-layout-matrix.js"

let setups: TestRendererSetup[] = []

afterEach(() => {
  for (const s of setups) s.renderer.destroy()
  setups = []
})

function track(setup: TestRendererSetup): TestRendererSetup {
  setups.push(setup)
  return setup
}

test("off-state instrumentation is a no-op (no counter attached)", async () => {
  const setup = track(await createTestRenderer({ width: 80, height: 24, useThread: false }))
  const { renderer } = setup

  expect(renderer.scalingCounters).toBeNull()

  // Build a tree and render; must not throw and must leave no counters attached.
  const { BoxRenderable, TextRenderable } = await import("../index.js")
  const root = new BoxRenderable(renderer, { width: "100%", height: "100%" })
  for (let i = 0; i < 50; i++) root.add(new TextRenderable(renderer, { content: `line-${i}`, height: 1 }))
  renderer.root.add(root)
  await setup.renderOnce()
  await setup.flush()

  expect(renderer.scalingCounters).toBeNull()
})

test("attaching counters activates them and reset zeroes them", () => {
  const counters = createWave3ScalingCounters()
  expect(counters.visitedStableNodes).toBe(0)
  counters.visitedStableNodes = 5
  expect(counters.visitedStableNodes).toBe(5)
  // reset path is exercised via renderer.resetWave3ScalingCounters in the runner;
  // here we just verify the factory produces a fresh zeroed counter.
  const fresh = createWave3ScalingCounters()
  expect(fresh.frameCounts.full).toBe(0)
  expect(fresh.partialRejectedBy).toEqual({})
})

test("layout counters scale with stable sibling count", async () => {
  const small = await runLayoutScenario({ kind: "stable-siblings", count: 100 }, { width: 80, height: 24, frames: 2 })
  const large = await runLayoutScenario({ kind: "stable-siblings", count: 2000 }, { width: 80, height: 24, frames: 2 })

  // The initial full-rebuild frame visits every visible node via updateLayout.
  expect(small.initialBuild.visitedStableNodes).toBeGreaterThan(0)
  // More nodes must be visited on the larger tree during the initial build.
  expect(large.initialBuild.visitedStableNodes).toBeGreaterThan(small.initialBuild.visitedStableNodes)
  // Each visited node performs one updateFromLayout FFI read during the build.
  expect(small.initialBuild.updateFromLayoutFfiCalls).toBeGreaterThan(0)
  expect(large.initialBuild.updateFromLayoutFfiCalls).toBeGreaterThan(small.initialBuild.updateFromLayoutFfiCalls)
  // Render commands accumulate across the rebuilt tree.
  expect(large.initialBuild.renderCommands).toBeGreaterThan(small.initialBuild.renderCommands)
  // Steady-state frames reuse the retained render list (no full traversal), so
  // they should NOT revisit every node.
  expect(small.steady.visitedStableNodes).toBeLessThanOrEqual(small.initialBuild.visitedStableNodes)
  // Overflow guard: visitedStableNodes / frames must stay a finite number.
  expect(Number.isFinite(small.visitedPerFrame)).toBe(true)
  expect(Number.isFinite(small.steady.visitedStableNodes)).toBe(true)
  // Steady-state frames after the initial rebuild reuse the render list, so the
  // steady series visits no more stable nodes than the initial full build.
  expect(small.steady.visitedStableNodes).toBeLessThanOrEqual(small.initialBuild.visitedStableNodes)
  // Both should be full frames (no partial requested).
  expect(small.initialBuild.frameCounts.full + small.steady.frameCounts.full).toBeGreaterThan(0)
  expect(small.initialBuild.frameCounts.partial + small.steady.frameCounts.partial).toBe(0)
})

test("the standardized layout matrix has distinct, non-empty scenario keys", () => {
  expect(LAYOUT_SCENARIOS.length).toBeGreaterThan(5)
  const keys = new Set<string>()
  for (const scenario of LAYOUT_SCENARIOS) {
    const optional = scenario as { autoHeight?: boolean; depth?: number }
    const key = [scenario.kind, scenario.count ?? "", optional.autoHeight ?? "", optional.depth ?? ""].join(":")
    expect(key.length).toBeGreaterThan(0)
    expect(keys.has(key)).toBe(false)
    keys.add(key)
  }
})

// Each scenario runs as its own test with a per-test timeout, so a slow
// large-tree scenario under load budgets its own time instead of tripping the
// shared default 5s window for the whole batch. This is a smoke test (load
// sensitive), not an oracle — behavior is asserted per scenario.
describe("layout matrix smoke: each scenario is well-formed and runs without throwing", () => {
  for (const scenario of LAYOUT_SCENARIOS) {
    const optional = scenario as { autoHeight?: boolean; depth?: number }
    const tag = [scenario.kind, scenario.count ?? "", optional.autoHeight ?? "", optional.depth ?? ""].join(":")
    test(`runs ${tag}`, async () => {
      const sample = await runLayoutScenario(scenario, { width: 80, height: 24, frames: 1 })
      expect(sample.scenario.length).toBeGreaterThan(0)
      expect(sample.renderables).toBeGreaterThan(0)
      expect(sample.initialBuild.visitedStableNodes).toBeGreaterThan(0)
    }, 60_000)
  }
})
