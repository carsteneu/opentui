import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { hostname, platform, release } from "node:os"
import { join, resolve } from "node:path"
import { performance } from "node:perf_hooks"

import { createRendererReady } from "../../../packages/core/src/renderer-ready.js"
import { CliRenderEvents } from "../../../packages/core/src/renderer.js"
import { createTestRenderer } from "../../../packages/core/src/testing.js"

const EXPECTED_NATIVE_SHA256 = "e7e9764462f2ee7f2c808856b60101ff659c6bda4a1df7cf235e418cf481a15c"
const DEFAULT_SAMPLES = 30
const WARMUP_PAIRS = 5

interface Summary {
  samples: number
  p50Ms: number
  p95Ms: number
  minMs: number
  maxMs: number
  meanMs: number
}

interface ScenarioRow {
  firstFrameMs: number
  enhancedAfterFrameMs: number
  applicationFromStartMs: number
}

interface ListenerCounts {
  frame: number
  renderError: number
  destroy: number
}

function option(name: string, fallback?: string): string {
  const prefix = `--${name}=`
  const value = process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? fallback
  if (value === undefined || value.length === 0) throw new Error(`missing --${name}=...`)
  return value
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) throw new Error("cannot summarize an empty sample")
  const index = Math.max(0, Math.ceil(fraction * sorted.length) - 1)
  return sorted[index]!
}

function median(sorted: readonly number[]): number {
  if (sorted.length === 0) throw new Error("cannot summarize an empty sample")
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!
}

function summarize(values: readonly number[]): Summary {
  const sorted = [...values].sort((left, right) => left - right)
  return {
    samples: sorted.length,
    p50Ms: median(sorted),
    p95Ms: percentile(sorted, 0.95),
    minMs: sorted[0]!,
    maxMs: sorted.at(-1)!,
    meanMs: sorted.reduce((total, value) => total + value, 0) / sorted.length,
  }
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

function listenerCounts(renderer: { listenerCount(event: string): number }): ListenerCounts {
  return {
    frame: renderer.listenerCount(CliRenderEvents.FRAME),
    renderError: renderer.listenerCount(CliRenderEvents.RENDER_ERROR),
    destroy: renderer.listenerCount(CliRenderEvents.DESTROY),
  }
}

function listenerDelta(after: ListenerCounts, before: ListenerCounts): ListenerCounts {
  return {
    frame: after.frame - before.frame,
    renderError: after.renderError - before.renderError,
    destroy: after.destroy - before.destroy,
  }
}

function activeHandleNames(): string[] | null {
  const getActiveHandles = (process as unknown as { _getActiveHandles?: () => unknown[] })._getActiveHandles
  if (getActiveHandles === undefined) return null
  return getActiveHandles()
    .map((handle) => (handle as { constructor?: { name?: string } }).constructor?.name ?? "unknown")
    .sort()
}

async function renderWithoutReady(): Promise<number> {
  const setup = await createTestRenderer({})
  try {
    const started = performance.now()
    await setup.renderOnce()
    return performance.now() - started
  } finally {
    setup.renderer.destroy()
  }
}

async function renderWithReady(): Promise<number> {
  const setup = await createTestRenderer({})
  const ready = createRendererReady(setup.renderer)
  try {
    const started = performance.now()
    await setup.renderOnce()
    await ready.firstFrameCommitted
    const elapsed = performance.now() - started
    ready.markEnhancedReady()
    await ready.enhancedSettled
    ready.markApplicationReady()
    await ready.applicationReady
    return elapsed
  } finally {
    ready.destroy()
    setup.renderer.destroy()
  }
}

async function measureScenario(delayMs: number, fail: boolean): Promise<ScenarioRow> {
  const setup = await createTestRenderer({})
  const ready = createRendererReady(setup.renderer)
  try {
    const started = performance.now()
    await setup.renderOnce()
    await ready.firstFrameCommitted
    const firstFrameMs = performance.now() - started

    const enhancedStarted = performance.now()
    await Bun.sleep(delayMs)
    if (fail) ready.markEnhancedFailed(new Error("controlled optional failure"))
    else ready.markEnhancedReady()
    await ready.enhancedSettled
    const enhancedAfterFrameMs = performance.now() - enhancedStarted

    ready.markApplicationReady()
    await ready.applicationReady
    return {
      firstFrameMs,
      enhancedAfterFrameMs,
      applicationFromStartMs: performance.now() - started,
    }
  } finally {
    ready.destroy()
    setup.renderer.destroy()
  }
}

async function auditDestroy(stage: "before-frame" | "after-frame" | "after-application") {
  const setup = await createTestRenderer({})
  const before = listenerCounts(setup.renderer)
  const ready = createRendererReady(setup.renderer)

  if (stage !== "before-frame") {
    await setup.renderOnce()
    await ready.firstFrameCommitted
  }
  if (stage === "after-application") {
    ready.markEnhancedReady()
    await ready.enhancedSettled
    ready.markApplicationReady()
    await ready.applicationReady
  }

  ready.destroy()
  const after = listenerCounts(setup.renderer)
  setup.renderer.destroy()
  return { stage, before, after, delta: listenerDelta(after, before) }
}

async function main(): Promise<void> {
  const output = resolve(option("output"))
  const samples = Number.parseInt(option("samples", String(DEFAULT_SAMPLES)), 10)
  if (!Number.isSafeInteger(samples) || samples < 2) throw new Error("--samples must be an integer >= 2")

  const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim()
  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()
  const assetRoot = process.env.OTUI_ASSET_ROOT
  const nativeOrigin = process.env.OTUI_NATIVE_ORIGIN
  if (!assetRoot || !nativeOrigin) {
    throw new Error("set OTUI_ASSET_ROOT and OTUI_NATIVE_ORIGIN so the test artifact has explicit provenance")
  }
  const nativePath = join(assetRoot, "@opentui", "core-linux-x64", "libopentui.so")
  const nativeSha256 = sha256(nativePath)
  if (nativeSha256 !== EXPECTED_NATIVE_SHA256) {
    throw new Error(`native SHA-256 mismatch: expected ${EXPECTED_NATIVE_SHA256}, got ${nativeSha256}`)
  }

  for (let index = 0; index < WARMUP_PAIRS; index++) {
    await renderWithoutReady()
    await renderWithReady()
  }

  const withoutReady: number[] = []
  const withReady: number[] = []
  for (let index = 0; index < samples; index++) {
    if (index % 2 === 0) {
      withoutReady.push(await renderWithoutReady())
      withReady.push(await renderWithReady())
    } else {
      withReady.push(await renderWithReady())
      withoutReady.push(await renderWithoutReady())
    }
  }

  const scenarioSamples = Math.max(10, Math.min(samples, 30))
  const scenarios = {
    fast: [] as ScenarioRow[],
    slow25ms: [] as ScenarioRow[],
    controlledFailure: [] as ScenarioRow[],
  }
  for (let index = 0; index < scenarioSamples; index++) scenarios.fast.push(await measureScenario(0, false))
  for (let index = 0; index < scenarioSamples; index++) scenarios.slow25ms.push(await measureScenario(25, false))
  for (let index = 0; index < scenarioSamples; index++) {
    scenarios.controlledFailure.push(await measureScenario(0, true))
  }

  const handlesBeforeDestroyAudit = activeHandleNames()
  const destroyAudit = await Promise.all([
    auditDestroy("before-frame"),
    auditDestroy("after-frame"),
    auditDestroy("after-application"),
  ])
  await Bun.sleep(10)
  const handlesAfterDestroyAudit = activeHandleNames()
  const readySource = readFileSync(join(repoRoot, "packages/core/src/renderer-ready.ts"), "utf8")

  const summarizeScenario = (rows: readonly ScenarioRow[]) => ({
    samples: rows.length,
    firstFrame: summarize(rows.map((row) => row.firstFrameMs)),
    enhancedAfterFrame: summarize(rows.map((row) => row.enhancedAfterFrameMs)),
    applicationFromStart: summarize(rows.map((row) => row.applicationFromStartMs)),
    raw: rows,
  })

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scope: "Loop D readiness helper render-cycle characterization; not a cold-start or Wave-2 TTFMF gate",
    environment: {
      host: hostname(),
      os: `${platform()} ${release()}`,
      bun: Bun.version,
      sourceCommit,
      workingTreeNote: "measurement script/report are added by the following documentation commit",
    },
    nativeArtifact: {
      path: nativePath,
      sha256: nativeSha256,
      expectedSha256: EXPECTED_NATIVE_SHA256,
      origin: nativeOrigin,
      committed: false,
    },
    pairedRenderCycle: {
      order: "alternating within one warmed process; this is paired descriptive data, not a cold-process A/B",
      warmupPairs: WARMUP_PAIRS,
      withoutReady: { summary: summarize(withoutReady), raw: withoutReady },
      withReady: { summary: summarize(withReady), raw: withReady },
    },
    optionalScenarios: {
      note: "optional work starts only after firstFrameCommitted; slow time is intentionally injected",
      fast: summarizeScenario(scenarios.fast),
      slow25ms: summarizeScenario(scenarios.slow25ms),
      controlledFailure: summarizeScenario(scenarios.controlledFailure),
    },
    cleanupAudit: {
      listeners: destroyAudit,
      activeHandleProbeSupported: handlesBeforeDestroyAudit !== null,
      activeHandlesBefore: handlesBeforeDestroyAudit,
      activeHandlesAfter: handlesAfterDestroyAudit,
      helperTimerCallsInSource: {
        setTimeout: (readySource.match(/\bsetTimeout\s*\(/g) ?? []).length,
        setInterval: (readySource.match(/\bsetInterval\s*\(/g) ?? []).length,
      },
    },
  }

  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
}

await main()
