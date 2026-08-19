// Wave-3 Loop D: layout scaling matrix (§10.3).
//
// Measures and attributes render-tree scaling for large trees WITHOUT changing
// production layout/render-list/culling/partial policy — this loop only
// instruments and reports (E-/F-optimization is Wave 4). Uses the opt-in
// scaling counters added to renderer.ts/Renderable.ts and the headless
// TestRenderer. Pure-function matrix helpers; the CLI runner lives in
// scripts/wave3-render-scaling.ts.
//
// The harness is asset-path-free and arm-agnostic: it does not read private
// native paths or hardcode hashes. It returns structured samples a runner can
// persist with commit/native/host provenance.

import { BoxRenderable, ScrollBoxRenderable, TextRenderable } from "../index.js"
import { createTestRenderer, type TestRendererSetup } from "../testing/test-renderer.js"
import { createWave3ScalingCounters, type Wave3ScalingCounters } from "./wave3-scaling-counters.js"
import type { RenderContext } from "../types.js"

export const LAYOUT_MATRIX_SCHEMA_VERSION = 1

export type LayoutScenario =
  | { kind: "stable-siblings"; count: number }
  | { kind: "streaming-child"; count: number; autoHeight: boolean }
  | { kind: "culling"; count: number }
  | { kind: "dirty-leaf"; count: number; depth: number }
  | { kind: "interactions"; count: number }

export interface LayoutSample {
  schemaVersion: number
  scenario: string
  width: number
  height: number
  renderables: number
  /** Counters attributed to the initial full-render (render-list rebuild) frame. */
  initialBuild: Wave3ScalingCounters
  /** Counters attributed to the steady-state frame series (subject of scaling). */
  steady: Wave3ScalingCounters
  /** Number of steady-state frames measured. */
  steadyFrames: number
  /** Total wall time across the steady-state series, ms. */
  steadyWallMs: number
  /** Nodes visited per steady-state frame (0 when the render list is reused). */
  visitedPerFrame: number
  /** FFI layout reads per steady-state frame. */
  ffiPerFrame: number
}

export interface LayoutRunOptions {
  width?: number
  height?: number
  /** Number of steady-state renderOnce() frames to accumulate. */
  frames?: number
}

const COLORS = {
  panel: "#1c2026",
  element: "#282e38",
  text: "#c8d2dc",
} as const

function buildStableSiblings(ctx: RenderContext, count: number): BoxRenderable {
  const root = new BoxRenderable(ctx, { width: "100%", height: "100%", flexDirection: "column" })
  for (let i = 0; i < count; i++) {
    const row = new BoxRenderable(ctx, {
      height: 1,
      width: "100%",
      backgroundColor: COLORS.element,
    })
    row.add(new TextRenderable(ctx, { content: `item-${i}` }))
    root.add(row)
  }
  return root
}

function buildStreamingChild(ctx: RenderContext, count: number, autoHeight: boolean): BoxRenderable {
  const root = new BoxRenderable(ctx, {
    width: "100%",
    height: autoHeight ? "auto" : "100%",
    flexDirection: "column",
    overflow: "hidden",
  })
  for (let i = 0; i < count; i++) {
    root.add(new TextRenderable(ctx, { content: `line-${i}`, height: autoHeight ? "auto" : 1 }))
  }
  return root
}

function buildCulling(ctx: RenderContext, count: number): BoxRenderable {
  const scrollBox = new ScrollBoxRenderable(ctx, {
    width: "100%",
    height: "100%",
    viewportCulling: true,
  })
  for (let i = 0; i < count; i++) {
    scrollBox.add(new TextRenderable(ctx, { content: `row-${i}`, height: 1 }))
  }
  return scrollBox
}

function buildNested(ctx: RenderContext, count: number, depth: number): BoxRenderable {
  const root = new BoxRenderable(ctx, { width: "100%", height: "100%" })
  let shelf = root
  for (let d = 0; d < depth; d++) {
    const next = new BoxRenderable(ctx, { width: "100%", height: "100%" })
    shelf.add(next)
    shelf = next
  }
  for (let i = 0; i < count; i++) {
    shelf.add(new TextRenderable(ctx, { content: `deep-${i}`, height: 1 }))
  }
  return root
}

function buildInteractions(ctx: RenderContext, count: number): BoxRenderable {
  const root = new BoxRenderable(ctx, { width: "100%", height: "100%", flexDirection: "column" })
  for (let i = 0; i < count; i++) {
    const el = new BoxRenderable(ctx, { width: "100%", height: 1 })
    const text = new TextRenderable(ctx, { content: `focus-${i}` })
    el.add(text)
    root.add(el)
  }
  return root
}

function buildScenario(ctx: RenderContext, scenario: LayoutScenario): BoxRenderable {
  switch (scenario.kind) {
    case "stable-siblings":
      return buildStableSiblings(ctx, scenario.count)
    case "streaming-child":
      return buildStreamingChild(ctx, scenario.count, scenario.autoHeight)
    case "culling":
      return buildCulling(ctx, scenario.count)
    case "dirty-leaf":
      return buildNested(ctx, scenario.count, scenario.depth)
    case "interactions":
      return buildInteractions(ctx, scenario.count)
  }
}

function scenarioLabel(scenario: LayoutScenario): string {
  switch (scenario.kind) {
    case "stable-siblings":
      return `stable-siblings-${scenario.count}`
    case "streaming-child":
      return `streaming-child-${scenario.count}-${scenario.autoHeight ? "autoheight" : "fixed"}`
    case "culling":
      return `culling-${scenario.count}`
    case "dirty-leaf":
      return `dirty-leaf-${scenario.count}-depth-${scenario.depth}`
    case "interactions":
      return `interactions-${scenario.count}`
  }
}

function countRenderables(node: BoxRenderable): number {
  let total = 1
  for (const child of node.getChildren()) {
    total += countRenderables(child as BoxRenderable)
  }
  return total
}

/**
 * Build the scenario, render an initial full frame (render-list rebuild, counts
 * the full-traversal cost), then a steady-state series (render-list reuse). The
 * two attribution buckets are returned separately so a scaling curve can
 * distinguish one-time rebuild cost from per-frame reuse.
 */
export async function runLayoutScenario(scenario: LayoutScenario, opts: LayoutRunOptions = {}): Promise<LayoutSample> {
  const width = opts.width ?? 80
  const height = opts.height ?? 24
  const frames = opts.frames ?? 1

  const setup: TestRendererSetup = await createTestRenderer({ width, height, useThread: false })
  const initialBuild = createWave3ScalingCounters()
  const steady = createWave3ScalingCounters()

  const root = buildScenario(setup.renderer, scenario)
  setup.renderer.root.add(root)

  // Initial full frame: rebuilds the render list (full traversal) and performs
  // the first layout. Attribution of this one-time full cost is isolated.
  setup.renderer.attachWave3ScalingCounters(initialBuild)
  await setup.renderOnce()
  setup.renderer.attachWave3ScalingCounters(null)

  // Steady-state series: the tree is stable, so the retained render list is
  // reused. Counts visited nodes / FFI reads / commands on each frame.
  setup.renderer.attachWave3ScalingCounters(steady)
  const steadyStart = performance.now()
  for (let i = 0; i < frames; i++) {
    await setup.renderOnce()
  }
  const steadyWallMs = performance.now() - steadyStart

  setup.renderer.attachWave3ScalingCounters(null)
  const renderables = countRenderables(root)
  setup.renderer.destroy()

  return {
    schemaVersion: LAYOUT_MATRIX_SCHEMA_VERSION,
    scenario: scenarioLabel(scenario),
    width,
    height,
    renderables,
    initialBuild,
    steady,
    steadyFrames: frames,
    steadyWallMs,
    visitedPerFrame: steady.visitedStableNodes / frames,
    ffiPerFrame: steady.updateFromLayoutFfiCalls / frames,
  }
}

export const LAYOUT_SCENARIOS: LayoutScenario[] = [
  { kind: "stable-siblings", count: 10 },
  { kind: "stable-siblings", count: 1000 },
  { kind: "stable-siblings", count: 10000 },
  { kind: "streaming-child", count: 1000, autoHeight: false },
  { kind: "streaming-child", count: 1000, autoHeight: true },
  { kind: "culling", count: 100 },
  { kind: "culling", count: 1000 },
  { kind: "culling", count: 5000 },
  { kind: "culling", count: 10000 },
  { kind: "dirty-leaf", count: 100, depth: 1 },
  { kind: "dirty-leaf", count: 100, depth: 50 },
  { kind: "interactions", count: 100 },
]
