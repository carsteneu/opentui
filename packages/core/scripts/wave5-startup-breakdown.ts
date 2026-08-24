// Wave-5 startup-symbol-binding breakdown probe (child process).
//
// One cold start in a fresh process: imports the target tree's renderer-entry,
// constructs the render library through resolveRenderLib(), and commits the
// first native frame via TextRenderable. Every boundary is recorded as a
// telemetry mark so ALL segments (import / coreBind / ctor / firstFrame /
// TTFMF) share one performance.now() source and the baseline (pre-split, full
// 395-symbol dlopen) compares against the CORE/DEFERRED candidate on an
// identical definition.
//
// Args:
//   --native-path=<abs .so>   path to the per-arm native to bind
//
// Prints a single WAVE5_BREAKDOWN_RESULT <json> line. One process per run.
import { createHash } from "node:crypto"
import { join, resolve, isAbsolute } from "node:path"

const RESULT_PREFIX = "WAVE5_BREAKDOWN_RESULT "

function requiredArg(name: string): string {
  const prefix = `--${name}=`
  const value = process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length)
  if (!value) throw new Error(`--${name} is required`)
  return value
}

interface Mark {
  name: string
  atMs: number
}

function atMs(marks: Mark[], name: string): number | null {
  for (const entry of marks) {
    if (entry.name === name) return entry.atMs
  }
  return null
}

function delta(marks: Mark[], end: string, start: string): number | null {
  const endMs = atMs(marks, end)
  const startMs = atMs(marks, start)
  return endMs !== null && startMs !== null ? endMs - startMs : null
}

async function main(): Promise<void> {
  const nativePath = requiredArg("native-path")
  if (!isAbsolute(nativePath)) throw new Error("--native-path must be absolute")
  const src = join(resolve(import.meta.dir, ".."), "src")

  const telemetry = await import(join(src, "telemetry.js"))
  telemetry.setTelemetryEnabled(true)
  telemetry.mark("opentui.wave5.start")

  await import(join(src, "renderer-entry.js"))
  telemetry.mark("opentui.wave5.importEnd")

  const zig = await import(join(src, "zig.js"))
  zig.setRenderLibPath(nativePath)
  telemetry.mark("opentui.wave5.beforeResolve")
  const lib = zig.resolveRenderLib()
  telemetry.mark("opentui.wave5.ctorEnd")

  const { createTestRenderer } = await import(join(src, "testing/test-renderer.js"))
  const { TextRenderable } = await import(join(src, "renderables/Text.js"))
  const setup = await createTestRenderer({ width: 80, height: 24, useThread: false })
  const text = new TextRenderable(setup.renderer, { content: "cold-start", width: 10, height: 1 })
  setup.renderer.root.add(text)
  await setup.renderOnce()
  telemetry.mark("opentui.wave5.frameEnd")
  setup.renderer.destroy()
  ;(lib as unknown as { dispose(): void }).dispose()

  const marks = telemetry.getTelemetrySnapshot().marks
  const accesses = marks
    .filter((entry) => entry.name.startsWith("opentui.symbolAccess."))
    .map((entry) => ({ name: entry.name.slice("opentui.symbolAccess.".length), atMs: entry.atMs }))
  const deferredBounds = marks
    .filter((entry) => entry.name.startsWith("opentui.deferredBound."))
    .map((entry) => entry.name.slice("opentui.deferredBound.".length))
  const start = atMs(marks, "opentui.wave5.start")
  const importEnd = atMs(marks, "opentui.wave5.importEnd")
  const beforeResolve = atMs(marks, "opentui.wave5.beforeResolve")
  const ctorEnd = atMs(marks, "opentui.wave5.ctorEnd")
  const frameEnd = atMs(marks, "opentui.wave5.frameEnd")
  const coreBound = atMs(marks, "opentui.coreBound")
  const preCoreBind = atMs(marks, "opentui.preCoreBind")
  const nativeLoaded = atMs(marks, "opentui.nativeLoaded")
  const fullBound = atMs(marks, "opentui.fullBound")
  const firstJsRender = atMs(marks, "opentui.firstJsRender")
  const firstNativeCommit = atMs(marks, "opentui.firstNativeCommit")
  const firstOutputWrite = atMs(marks, "opentui.firstOutputWrite")

  const ttfmSource = firstOutputWrite ?? firstNativeCommit
  const result = {
    schemaVersion: 2,
    runtime: { bun: Bun.version, node: process.version },
    nativeSha256: createHash("sha256")
      .update(Buffer.from(await Bun.file(nativePath).arrayBuffer()))
      .digest("hex"),
    // Segment durations in ms, all derived from the shared mark clock.
    importMs: delta(marks, "opentui.wave5.importEnd", "opentui.wave5.start"),
    coreBindMs:
      nativeLoaded !== null && preCoreBind !== null
        ? nativeLoaded - preCoreBind
        : nativeLoaded !== null && beforeResolve !== null
          ? nativeLoaded - beforeResolve
          : null,
    libResolveMs: delta(marks, "opentui.wave5.ctorEnd", "opentui.wave5.beforeResolve"),
    fullBoundMs: fullBound !== null && coreBound !== null ? fullBound - coreBound : null,
    firstFrameMs: delta(marks, "opentui.wave5.frameEnd", "opentui.wave5.ctorEnd"),
    ttfmFromEnvMs: ttfmSource !== null && start !== null ? ttfmSource - start : null,
    frameEndMs: frameEnd !== null && start !== null ? frameEnd - start : null,
    marks: {
      coreBound,
      nativeLoaded,
      fullBound,
      firstJsRender,
      firstNativeCommit,
      firstOutputWrite,
    },
    accesses,
    deferredBounds,
    correct: firstNativeCommit !== null && firstNativeCommit > start,
  }
  process.stdout.write(`${RESULT_PREFIX}${JSON.stringify(result)}\n`)
}

main().catch((error) => {
  console.error("wave5 startup breakdown probe failed:", error)
  process.exitCode = 1
})
