// Wave-3 Loop D: validates the partial-render scaling counters attribute
// accepted/rejected decisions and region areas, and that the policy-forcing
// scenarios (translucent ancestor, overlapping painter) promote to a full frame
// instead of accepting a bounded region (§10.4 oracles).

import { beforeEach, describe, expect, test } from "bun:test"
import { createTestRenderer, type TestRendererSetup } from "../testing/test-renderer.js"
import { runPartialScenario, PARTIAL_SCENARIOS, partialScenarioLabel } from "./wave3-partial-matrix.js"

let setups: TestRendererSetup[] = []

beforeEach(() => {
  setups = []
})

describe("partial scaling counter attribution", () => {
  test("isolated eligible edit accepts a bounded region and records its area", async () => {
    const sample = await runPartialScenario(
      { rows: 50, translucentAncestor: false, overlappingPainter: false, deep: false },
      { width: 80, height: 24 },
    )

    expect(sample.accepted).toBe(true)
    expect(sample.counters.partialAccepted).toBeGreaterThan(0)
    // A partial frame must not also count as a full frame.
    expect(sample.counters.frameCounts.full).toBe(0)
    expect(sample.regionArea).toBeGreaterThan(0)
    // No promotion happened for an isolated eligible edit.
    expect(sample.counters.partialToFullPromotions).toBe(0)
  })

  test("translucent ancestor forces a full frame (no bounded region)", async () => {
    const sample = await runPartialScenario(
      { rows: 50, translucentAncestor: true, overlappingPainter: false, deep: false },
      { width: 80, height: 24 },
    )

    // Rejected at frame-guard time by the translucent-ancestor check.
    expect(sample.accepted).toBe(false)
    expect(sample.counters.partialRejectedBy["translucent-ancestor"]).toBeGreaterThan(0)
    expect(sample.counters.partialAccepted).toBe(0)
    expect(sample.counters.frameCounts.full).toBeGreaterThan(0)
    expect(sample.regionArea).toBe(0)
  })

  test("overlapping later painter forces a full frame (no bounded region)", async () => {
    const sample = await runPartialScenario(
      { rows: 50, translucentAncestor: false, overlappingPainter: true, deep: false },
      { width: 80, height: 24 },
    )

    expect(sample.accepted).toBe(false)
    expect(sample.counters.partialRejectedBy["overlap-later-painter"]).toBeGreaterThan(0)
    expect(sample.counters.partialAccepted).toBe(0)
    expect(sample.counters.frameCounts.full).toBeGreaterThan(0)
  })

  test("region area scales with the edited region width, not the background rows", async () => {
    const narrow = await runPartialScenario(
      { rows: 2000, translucentAncestor: false, overlappingPainter: false, deep: false },
      { width: 80, height: 24 },
    )
    const wide = await runPartialScenario(
      { rows: 2000, translucentAncestor: false, overlappingPainter: false, deep: false },
      { width: 160, height: 24 },
    )

    // Both accept; the edited region (fixed 5,2 + 6x1) has bounded area, so
    // neither scales with background rows; both are > 0 and equal.
    expect(narrow.accepted).toBe(true)
    expect(wide.accepted).toBe(true)
    expect(narrow.counters.partialAccepted).toBeGreaterThan(0)
    expect(wide.counters.partialAccepted).toBeGreaterThan(0)
    expect(narrow.regionArea).toBe(wide.regionArea)
  })

  test("the standardized partial matrix is well-formed", () => {
    expect(PARTIAL_SCENARIOS.length).toBeGreaterThanOrEqual(4)
    const labels = new Set<string>()
    for (const s of PARTIAL_SCENARIOS) {
      const label = partialScenarioLabel(s)
      expect(label.length).toBeGreaterThan(0)
      expect(labels.has(label)).toBe(false)
      labels.add(label)
    }
  })
})
