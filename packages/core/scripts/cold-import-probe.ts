// Child process: performs ONE cold-import measurement in a fresh process and
// prints a single JSON object to stdout. Spawned by bench-cold-import.ts.
//
// Env:
//   OPENTUI_BENCH_ENTRY    module specifier/path to cold-import
//   OPENTUI_BENCH_SCENARIO scenario label (root|minimal|zig) for provenance
//   OPENTUI_BENCH_RENDER   "0" to skip renderer construction
//   OPENTUI_BENCH_TELEMETRY "1" to enable opt-in telemetry (marks/importReady)
//
// Output fields (ms):
//   importMs        t0 -> entry module import resolves
//   overallMs       t0 -> after first native commit (cold TTFMF) or import if no render
//   importReadyAt   importReady mark offset from t0 (telemetry on, root only)
//   firstCommitAt   firstNativeCommit mark offset from t0 (telemetry on)
import { performance } from "node:perf_hooks"

const entry = process.env.OPENTUI_BENCH_ENTRY
const scenario = process.env.OPENTUI_BENCH_SCENARIO ?? "root"
const doRender = process.env.OPENTUI_BENCH_RENDER !== "0"
const telemetryOn = process.env.OPENTUI_BENCH_TELEMETRY === "1"

if (!entry) {
  console.error("OPENTUI_BENCH_ENTRY is required")
  process.exit(2)
}

const t0 = performance.now()
// telemetry module is loaded before the measured entry so module-scope marks
// (opentui.importReady) fire; it is a no-dep module, negligible on import time.
const telemetryModule = await import("../src/telemetry.js")
telemetryModule.setTelemetryEnabled(telemetryOn)

let importMs: number | null = null
try {
  await import(entry)
} finally {
  importMs = performance.now() - t0
}

let importReadyAt: number | null = null
if (telemetryOn) {
  const ready = telemetryModule.getTelemetrySnapshot().marks.find((m) => m.name === "opentui.importReady")
  if (ready) importReadyAt = ready.atMs - t0
}

let firstCommitAt: number | null = null
let overallMs = importMs
if (doRender) {
  const testRendererModule = await import("../src/testing/test-renderer.js")
  const { TextRenderable } = await import("../src/renderables/Text.js")
  const testRenderer = await testRendererModule.createTestRenderer({ width: 80, height: 24, useThread: false })
  const text = new TextRenderable(testRenderer.renderer, { content: "cold-start", width: 10, height: 1 })
  testRenderer.renderer.root.add(text)
  await testRenderer.renderOnce()
  testRenderer.renderer.destroy()
  overallMs = performance.now() - t0
  if (telemetryOn) {
    const commit = telemetryModule.getTelemetrySnapshot().marks.find((m) => m.name === "opentui.firstNativeCommit")
    if (commit) firstCommitAt = commit.atMs - t0
  }
}

const round = (v: number | null): number | null => (v === null ? null : Math.round(v * 1000) / 1000)
console.log(
  JSON.stringify({
    scenario,
    runtime: process.versions.bun ? "bun" : "node",
    telemetry: telemetryOn,
    importMs: round(importMs),
    importReadyAt: round(importReadyAt),
    firstCommitAt: round(firstCommitAt),
    overallMs: round(overallMs),
  }),
)
