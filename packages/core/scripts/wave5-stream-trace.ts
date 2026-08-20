// Wave-5 streaming-path symbol trace (child process).
//
// M1 trace for the CodeRenderable cold-start scenario (the primary OpenTUI
// workload that drives the wave5-cpu-gate "cold-1000" shape): a streaming
// CodeRenderable with a TreeSitter worker, an empty warmup frame (first native
// commit), then a 1000-line styled update rendered to a native styled commit.
//
// Runs with OTUI_WAVE5_TRACE_SYMBOLS=1 so the staged library binds the full
// table eagerly (trace baseline) while every first property access is recorded
// as an `opentui.symbolAccess.<name>` telemetry mark. The recorded set is the
// cold code-streaming working set: symbols the real (staged) cold run must bind
// eagerly in CORE, otherwise each first use after the first native commit pays
// an individual trap-miss dlopen inside the measured CPU window.
//
// Args:
//   --native-path=<abs .so>   path to the per-arm native to bind
//   --out=<abs .json>         where to write the committed trace fixture
//   --scenario=<name>         cold-1000 (default) | warm-1000-append100
//
// Prints a single WAVE5_STREAM_TRACE_RESULT <json> line. One process per run.
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { isAbsolute, join, resolve, dirname } from "node:path"
import { pathToFileURL } from "node:url"

// Trace mode must be visible to zig.ts when the staged library is created.
process.env.OTUI_WAVE5_TRACE_SYMBOLS = "1"

const RESULT_PREFIX = "WAVE5_STREAM_TRACE_RESULT "

function requiredArg(name: string): string {
  const prefix = `--${name}=`
  const value = process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length)
  if (!value) throw new Error(`--${name} is required`)
  return value
}

function sourceUrl(root: string, relativePath: string): string {
  return pathToFileURL(join(root, "packages/core/src", relativePath)).href
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs} ms`)), timeoutMs)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

interface Mark {
  name: string
  atMs: number
}

async function main(): Promise<void> {
  const nativePath = requiredArg("native-path")
  if (!isAbsolute(nativePath)) throw new Error("--native-path must be absolute")
  const outPath = requiredArg("out")
  if (!isAbsolute(outPath)) throw new Error("--out must be absolute")
  const scenario =
    process.argv.find((argument) => argument.startsWith("--scenario="))?.slice("--scenario=".length) ?? "cold-1000"
  if (scenario !== "cold-1000" && scenario !== "warm-1000-append100") {
    throw new Error(`unsupported scenario: ${scenario}`)
  }
  // Scripts live in packages/core/scripts; source modules resolve from the
  // package root.
  const packageRoot = resolve(import.meta.dir, "..")
  // sourceUrl() resolves relative to the workspace root (packages/core/...).
  const workspaceRoot = resolve(packageRoot, "..", "..")

  const telemetryModule = await import(join(packageRoot, "src/telemetry.js"))
  telemetryModule.setTelemetryEnabled(true)
  telemetryModule.mark("opentui.wave5.stream.start")

  const { createTestRenderer } = await import(sourceUrl(workspaceRoot, "testing/test-renderer.ts"))
  const { CodeRenderable } = await import(sourceUrl(workspaceRoot, "renderables/Code.ts"))
  const { SyntaxStyle } = await import(sourceUrl(workspaceRoot, "syntax-style.ts"))
  const { RGBA } = await import(sourceUrl(workspaceRoot, "lib/RGBA.ts"))
  const treeSitterModule = await import(sourceUrl(workspaceRoot, "lib/tree-sitter/client.ts"))
  const { treeSitterToTextChunks } = await import(sourceUrl(workspaceRoot, "lib/tree-sitter-styled-text.ts"))
  const zig = await import(sourceUrl(workspaceRoot, "zig.ts"))
  void treeSitterToTextChunks

  zig.setRenderLibPath(nativePath)
  const dataPath = join(packageRoot, ".yesmem", "tmp", `wave5-stream-${process.pid}`)
  mkdirSync(dataPath, { recursive: true })
  const client = new treeSitterModule.TreeSitterClient({ dataPath })
  const setup = await createTestRenderer({ width: 80, height: 24 })
  const syntaxStyle = SyntaxStyle.fromStyles({
    keyword: { fg: "#ff0000" },
    number: { fg: "#00ffff" },
    type: { fg: "#ffff00" },
  })
  const code = new CodeRenderable(setup.renderer, {
    content: "",
    filetype: "typescript",
    syntaxStyle,
    treeSitterClient: client,
    streaming: true,
    drawUnstyledText: false,
    width: "100%",
    height: "100%",
    fg: RGBA.fromValues(255, 255, 255, 255),
  })

  try {
    setup.renderer.root.add(code)
    // Warmup empty frame: first native commit happens here.
    await setup.renderOnce()

    const marker = scenario === "cold-1000" ? "COLD_STREAM_FINAL" : ""
    const { makeCodeContent, makeWarmAppendWorkload } = await import("./wave3-real-worker-workload.js")
    let finalMarker = marker
    let warmUpdates: string[] = []
    if (scenario === "warm-1000-append100") {
      const workload = makeWarmAppendWorkload(1000, 100)
      finalMarker = workload.finalMarker
      warmUpdates = workload.updates
      code.content = workload.initial
      await setup.renderOnce()
      await withTimeout(code.highlightingDone, 30_000, "warmup highlight")
      await setup.flush({ maxPasses: 200 })
      for (const content of warmUpdates) code.content = content
    } else {
      code.content = makeCodeContent(1000, marker)
    }

    const tUpdateStart = performance.now()
    await setup.renderOnce()
    await withTimeout(code.highlightingDone, 30_000, "measured highlight")
    if (scenario === "warm-1000-append100") code.scrollY = code.maxScrollY
    await setup.flush({ maxPasses: 200 })
    const tStyledCommitEnd = performance.now()

    const frame = setup.captureCharFrame()
    const spans = setup.captureSpans()
    const expectedRed = RGBA.fromValues(255, 0, 0, 255)
    const styledVerified = spans.lines.some((line: any) =>
      line.spans.some((span: any) => span.text.includes("const") && span.fg?.equals(expectedRed)),
    )
    const finalMarkerVisible = frame.includes(finalMarker)
    if (!finalMarkerVisible) throw new Error("stream trace: final marker not visible")

    const marks = telemetryModule.getTelemetrySnapshot().marks as Mark[]
    const firstNativeCommitAtMs = marks.find((m) => m.name === "opentui.firstNativeCommit")?.atMs ?? null
    const fullBoundAtMs = marks.find((m) => m.name === "opentui.fullBound")?.atMs ?? null
    const accesses = marks
      .filter((m) => m.name.startsWith("opentui.symbolAccess."))
      .map((m) => ({ name: m.name.slice("opentui.symbolAccess.".length), atMs: m.atMs }))
      .sort((a, b) => a.atMs - b.atMs)

    const fixture = {
      scenario,
      bun: Bun.version,
      nativeSha256: createHash("sha256").update(readFileSync(nativePath)).digest("hex"),
      updateMs: tStyledCommitEnd - tUpdateStart,
      firstNativeCommitAtMs,
      fullBoundAtMs,
      styledVerified,
      finalMarkerVisible,
      accessCount: accesses.length,
      accesses,
    }
    mkdirSync(dirname(outPath), { recursive: true })
    writeFileSync(outPath, JSON.stringify(fixture, null, 1) + "\n")
    console.log(RESULT_PREFIX + JSON.stringify(fixture))
  } finally {
    setup.renderer.destroy()
  }

  // The TreeSitter worker keeps the event loop alive; the trace is complete at
  // this point, so exit explicitly instead of hanging.
  process.exit(0)
}

// top-level await keeps this process alive through the worker round-trips.
await main()
