// Wave-3 Loop D: partial-render scaling matrix (§10.4).
//
// Attributes partial-render decisions and regions for large trees. Loop D only
// instruments (E-/F-optimization is Wave 4). The SAFETY oracle for output
// equivalence is owned by renderer.partial-render.test.ts; this harness adds the
// scaling counters (accepted / rejected-by-reason / region-area / promotions)
// that let a runner build a partial-scaling curve and detect policy regressions.

import { BoxRenderable, TextRenderable } from "../index.js"
import { createTestRenderer, type TestRendererSetup } from "../testing/test-renderer.js"
import { createWave3ScalingCounters, type Wave3ScalingCounters } from "./wave3-scaling-counters.js"

export const PARTIAL_MATRIX_SCHEMA_VERSION = 1

export interface PartialScenario {
  /** Number of background rows the (non-eligible) tree holds. */
  rows: number
  /** Whether the edited leaf has an opaque ancestor (safe) or a translucent one (forced full). */
  translucentAncestor: boolean
  /** Whether a non-partial-eligible painter overlaps the edited region (forced full). */
  overlappingPainter: boolean
  /** Whether the edited leaf sits deep in the tree (deep-path scenario). */
  deep: boolean
}

export function partialScenarioLabel(s: PartialScenario): string {
  const flags = [
    `${s.rows}rows`,
    s.translucentAncestor ? "translucent" : "opaque",
    s.overlappingPainter ? "overlap" : "isolated",
    s.deep ? "deep" : "shallow",
  ]
  return `partial-${flags.join("-")}`
}

export interface PartialSample {
  schemaVersion: number
  scenario: string
  width: number
  height: number
  rows: number
  /** Was the partial accepted (rendered as a bounded region) or promoted to full? */
  accepted: boolean
  counters: Wave3ScalingCounters
  /** Bounded area redrawn across the measurement, cells. */
  regionArea: number
}

export interface PartialRunOptions {
  width?: number
  height?: number
}

/**
 * Build a tree, render an initial full frame, edit one leaf, then run one frame
 * with the opt-in counters attached. Returns whether the frame went partial and
 * attributed counters. Provenance is validated by the caller before persisting.
 */
export async function runPartialScenario(
  scenario: PartialScenario,
  opts: PartialRunOptions = {},
): Promise<PartialSample> {
  const width = opts.width ?? 80
  const height = opts.height ?? 24

  const setup: TestRendererSetup = await createTestRenderer({ width, height, useThread: false })
  const counters = createWave3ScalingCounters()
  setup.renderer.attachWave3ScalingCounters(counters)

  const root = new BoxRenderable(setup.renderer, { width: "100%", height: "100%", flexDirection: "column" })
  for (let i = 0; i < scenario.rows; i++) {
    root.add(new TextRenderable(setup.renderer, { content: `row-${i}`, height: 1 }))
  }

  // The edited region: a small box placed over the rows. A translucent ancestor
  // (opacity < 1) is the policy path that forces a full render.
  const targetOuter = new BoxRenderable(setup.renderer, { width: "100%", height: "100%" })
  const targetParent = new BoxRenderable(setup.renderer, {
    position: "absolute",
    left: 5,
    top: 2,
    width: 6,
    height: 1,
    opacity: scenario.translucentAncestor ? 0.5 : 1,
  })
  const target = new TextRenderable(setup.renderer, { content: "edit", width: 6, height: 1 })
  targetParent.add(target)
  // Deep paths nest the edited region below several wrapper boxes so the
  // partial decision walks a deeper ancestry (worst-case bounds/opacity walk).
  if (scenario.deep) {
    let shelf = targetOuter
    for (let d = 0; d < 40; d++) {
      const next = new BoxRenderable(setup.renderer, { width: "100%", height: "100%" })
      shelf.add(next)
      shelf = next
    }
    shelf.add(targetParent)
    root.add(targetOuter)
  } else {
    root.add(targetParent)
  }
  target.setPartialEligible(true)

  if (scenario.overlappingPainter) {
    const overlap = new TextRenderable(setup.renderer, {
      position: "absolute",
      left: 3,
      top: 2,
      width: 6,
      height: 1,
    })
    root.add(overlap)
  }

  setup.renderer.root.add(root)
  await setup.renderOnce()
  await setup.flush()

  // Reset counters to attribute only the measured partial/decision frame.
  setup.renderer.resetWave3ScalingCounters(counters)

  // Trigger a render of the eligible target only.
  target.requestRender()
  await setup.renderOnce()

  const regionArea = counters.partialAccepted > 0 ? counters.partialRegionAreas : 0
  const accepted = counters.partialAccepted > 0 && counters.partialToFullPromotions === 0

  setup.renderer.attachWave3ScalingCounters(null)
  setup.renderer.destroy()

  return {
    schemaVersion: PARTIAL_MATRIX_SCHEMA_VERSION,
    scenario: partialScenarioLabel(scenario),
    width,
    height,
    rows: scenario.rows,
    accepted,
    counters,
    regionArea,
  }
}

export const PARTIAL_SCENARIOS: PartialScenario[] = [
  // Steady-state scaling: more background rows, partial should stay accepted.
  { rows: 10, translucentAncestor: false, overlappingPainter: false, deep: false },
  { rows: 2000, translucentAncestor: false, overlappingPainter: false, deep: false },
  { rows: 10000, translucentAncestor: false, overlappingPainter: false, deep: false },
  // Policy forcing full renders (regression canaries).
  { rows: 100, translucentAncestor: true, overlappingPainter: false, deep: false },
  { rows: 100, translucentAncestor: false, overlappingPainter: true, deep: false },
  { rows: 100, translucentAncestor: false, overlappingPainter: false, deep: true },
]
