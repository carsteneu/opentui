// Child process: performs ONE cold-import / TTFMF measurement in a fresh
// process and prints a single JSON object to stdout. Spawned by
// bench-cold-import.ts under either bun or node.
//
// Env:
//   OPENTUI_BENCH_ENTRY      module specifier/path to cold-import (src or dist)
//   OPENTUI_BENCH_SCENARIO   scenario label (root|minimal|zig|dist) provenance
//   OPENTUI_BENCH_RENDER     "0" to skip renderer construction + TTFMF
//   OPENTUI_BENCH_TELEMETRY  "1" to enable opt-in telemetry (marks)
//
// Output fields (ms):
//   importMs     t0 -> entry module import resolves
//   firstCommitAt t0 -> firstNativeCommit mark (telemetry on, render scenarios)
//   ttfmMs       t0 -> first commit. TTFMF. Measured as (performance.now - t0)
//                right after the first rendered frame resolves (so BEFORE
//                destroy), or as the precise firstNativeCommit mark when
//                telemetry is on. Equal to importMs when render is skipped.
import { performance } from "node:perf_hooks"

const entry = process.env.OPENTUI_BENCH_ENTRY
const scenario = process.env.OPENTUI_BENCH_SCENARIO ?? "root"
const isBun = !!process.versions.bun
// Node runs the bundled dist consumer, which does not expose the src telemetry
// or testing helpers; marks/telemetry and the headless render path are only
// available under bun. Node baseline = cold dist import time (importMs).
const doRender = isBun && process.env.OPENTUI_BENCH_RENDER !== "0"
const telemetryOn = isBun && process.env.OPENTUI_BENCH_TELEMETRY === "1"

if (!entry) {
  console.error("OPENTUI_BENCH_ENTRY is required")
  process.exit(2)
}

const t0 = performance.now()
// telemetry is loaded before the measured entry so import-time marks
// (opentui.nativeLoaded, opentui.importReady) fire; it is a no-dep module.
// Under node the src module is unavailable, so marks are skipped (node = dist
// cold-import baseline only).
const telemetryModule: null | {
  setTelemetryEnabled: (v: boolean) => void
  getTelemetrySnapshot: () => {
    marks: { name: string; atMs: number }[]
  }
} = isBun ? await import("../src/telemetry.js") : null
telemetryModule?.setTelemetryEnabled(telemetryOn)

let importMs: number | null = null
try {
  await import(entry)
} finally {
  importMs = performance.now() - t0
}

let firstCommitAt: number | null = null
let ttfmMs = importMs
if (doRender) {
  const testRendererModule = await import("../src/testing/test-renderer.js")
  const { TextRenderable } = await import("../src/renderables/Text.js")
  const testRenderer = await testRendererModule.createTestRenderer({ width: 80, height: 24, useThread: false })
  const text = new TextRenderable(testRenderer.renderer, { content: "cold-start", width: 10, height: 1 })
  testRenderer.renderer.root.add(text)
  await testRenderer.renderOnce()
  // TTFMF = first commit: stop the clock here, BEFORE destroy().
  ttfmMs = performance.now() - t0
  if (telemetryOn && telemetryModule) {
    const commit = telemetryModule.getTelemetrySnapshot().marks.find((m) => m.name === "opentui.firstNativeCommit")
    if (commit) {
      firstCommitAt = commit.atMs - t0
      ttfmMs = firstCommitAt
    }
  }
  testRenderer.renderer.destroy()
}

const round = (v: number | null): number | null => (v === null ? null : Math.round(v * 1000) / 1000)
console.log(
  JSON.stringify({
    scenario,
    runtime: process.versions.bun ? "bun" : "node",
    telemetry: telemetryOn,
    importMs: round(importMs),
    firstCommitAt: round(firstCommitAt),
    ttfmMs: round(ttfmMs),
  }),
)
