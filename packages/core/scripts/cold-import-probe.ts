// Child process: performs ONE cold-import / TTFMF measurement in a fresh
// process and prints a single JSON object to stdout. Spawned by
// bench-cold-import.ts under either bun or node.
//
// Env:
//   OPENTUI_BENCH_ENTRY      module specifier/path to cold-import (src or dist)
//   OPENTUI_BENCH_SRC        absolute path to the TARGET core/src that this arm
//                            renders from (each arm imports completely from its
//                            own tree — no cross-worktree mixing).
//   OPENTUI_BENCH_SCENARIO   scenario label (root|zig|dist) provenance
//   OPENTUI_BENCH_RENDER     "0" to skip renderer construction + TTFMF
//   OPENTUI_BENCH_TELEMETRY  "1" to enable opt-in telemetry (marks/spans)
//
// Output fields (ms):
//   importMs      t0 -> entry module import resolves
//   firstCommitAt t0 -> firstNativeCommit mark (DIAGNOSTIC ONLY, telemetry on)
//   ttfmMs        t0 -> first committed frame (renderOnce() resolves). The gate
//                  metric uses this SAME boundary in every arm so no arm is
//                  favored by an earlier telemetry mark.
//   marks/spans   lifecycle marks + spans snapshot (telemetry on, bun only)
import { performance } from "node:perf_hooks"
import { join } from "node:path"

const entry = process.env.OPENTUI_BENCH_ENTRY
const src = process.env.OPENTUI_BENCH_SRC
const scenario = process.env.OPENTUI_BENCH_SCENARIO ?? "root"
const isBun = !!process.versions.bun
// Node runs the bundled dist consumer, which does not expose src telemetry or
// the headless render path; node baseline = cold dist import time (importMs).
const doRender = isBun && process.env.OPENTUI_BENCH_RENDER !== "0"
const telemetryOn = isBun && process.env.OPENTUI_BENCH_TELEMETRY === "1"

if (!entry) {
  console.error("OPENTUI_BENCH_ENTRY is required")
  process.exit(2)
}

const t0 = performance.now()
// Preload telemetry ONLY when enabled, so the disabled and fastpatch arms
// measure the true unobserved import path (the branch index.ts itself imports
// telemetry; fastpatch index.ts does not — that delta is the real regression
// signal). Enabled arm needs telemetry active before the measured entry so the
// import-time marks (nativeLoaded, importReady) fire.
let telemetryModule:
  | null
  | {
      setTelemetryEnabled: (v: boolean) => void
      getTelemetrySnapshot: () => {
        marks: { name: string; atMs: number }[]
        spans: { name: string; startMs: number; endMs: number }[]
      }
    } = null
if (isBun && telemetryOn && src) {
  const mod = (await import(join(src, "telemetry.js"))) as {
    setTelemetryEnabled: (v: boolean) => void
    getTelemetrySnapshot: () => {
      marks: { name: string; atMs: number }[]
      spans: { name: string; startMs: number; endMs: number }[]
    }
  }
  mod.setTelemetryEnabled(true)
  telemetryModule = mod
}

let importMs: number | null = null
try {
  await import(entry)
} finally {
  importMs = performance.now() - t0
}

let firstCommitAt: number | null = null
let ttfmMs = importMs
let marks: { name: string; atMs: number }[] = []
let spans: { name: string; startMs: number; endMs: number }[] = []
if (doRender && src) {
  const testRendererModule = await import(join(src, "testing/test-renderer.js"))
  const { TextRenderable } = await import(join(src, "renderables/Text.js"))
  const testRenderer = await testRendererModule.createTestRenderer({ width: 80, height: 24, useThread: false })
  const text = new TextRenderable(testRenderer.renderer, { content: "cold-start", width: 10, height: 1 })
  testRenderer.renderer.root.add(text)
  await testRenderer.renderOnce()
  // TTFMF = first committed frame: stop the clock here (BEFORE destroy).
  // IDENTICAL boundary for every arm; the enabled arm does NOT reuse an earlier
  // telemetry mark here so it is never favored.
  ttfmMs = performance.now() - t0
  if (telemetryModule) {
    const snap = telemetryModule.getTelemetrySnapshot()
    const commit = snap.marks.find((m) => m.name === "opentui.firstNativeCommit")
    if (commit) firstCommitAt = commit.atMs - t0
    marks = snap.marks
    spans = snap.spans
  }
  testRenderer.renderer.destroy()
}

const round = (v: number | null): number | null => (v === null ? null : Math.round(v * 1000) / 1000)
console.log(
  JSON.stringify({
    scenario,
    runtime: isBun ? "bun" : "node",
    telemetry: telemetryOn,
    importMs: round(importMs),
    firstCommitAt: round(firstCommitAt),
    ttfmMs: round(ttfmMs),
    marks,
    spans,
  }),
)
