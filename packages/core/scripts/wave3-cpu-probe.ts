// Loop B real-worker CPU probe (child process).
//
// Runs ONE update→styled-commit through the REAL tree-sitter worker chain and
// measures the DISJOINT main-thread stages at external public seams — NOT
// process.cpuUsage() (which includes the worker) and NOT overlapping diagnostic
// windows. Worker wait and worker CPU are tracked separately and never enter the
// main-thread sum.
//
// The instrumentation lives entirely OUTSIDE the runtime (onHighlight/onChunks
// callbacks, a textBuffer write wrapper, client.getPerformance) so the identical
// measurement contract applies to both A/B arms regardless of which tree's
// runtime is loaded. It changes no runtime policy.
//
// Invoked as: bun scripts/wave3-cpu-probe.ts --root=<abs> --role=baseline|candidate
//   --revision=<commit> --scenario=<cold-1000|warm-1000-append100>
//   --native-path=<abs .so> --native-sha=<hash>
//
// Prints a single WAVE3_CPU_RESULT <json> line plus WAVE3_WORKER_PERFORMANCE.
import { createHash } from "node:crypto"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { isAbsolute, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { makeCodeContent, makeWarmAppendWorkload } from "./wave3-real-worker-workload.js"
import {
  buildDisjointStages,
  computeMainThreadSum,
  classifyWave3CpuResult,
} from "../src/benchmark/wave3-cpu-harness.js"
import type { Wave3CpuStageSpan } from "../src/benchmark/wave3-cpu-harness.js"

const RESULT_PREFIX = "WAVE3_CPU_RESULT "

interface CpuProbeResult {
  schemaVersion: 1
  role: "baseline" | "candidate"
  root: string
  revision: string
  scenario: string
  runtime: { bun: string; node: string }
  nativeSha256: string
  stages: readonly Wave3CpuStageSpan[]
  mainThreadSumMs: number
  workerWaitMs: number
  workerCpuMs: number
  updateToStyledCommitMs: number
  styledVerified: boolean
  nativeFrameDelta: number
  counts: {
    cellsUpdated: number
    highlightCount: number
    chunkCount: number
    setStyledCalls: number
    appendStyledCalls: number
  }
  correctness: { frameSha256: string; spansSha256: string; chunksSha256: string; finalMarkerVisible: boolean }
  verdict: "PASS" | "FAIL" | "UNCLEAR"
}

function requiredArg(name: string): string {
  const prefix = `--${name}=`
  const value = process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length)
  if (!value) throw new Error(`--${name} is required`)
  return value
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex")
}

function sourceUrl(root: string, relativePath: string): string {
  return pathToFileURL(join(root, "packages/core/src", relativePath)).href
}

function normalizeForDigest(value: unknown): string {
  return JSON.stringify(value, (_key, nested) => {
    if (nested && typeof nested === "object" && "r" in nested && "g" in nested && "b" in nested && "a" in nested) {
      const color = nested as { r: number; g: number; b: number; a: number }
      return [color.r, color.g, color.b, color.a]
    }
    return nested
  })
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

async function main(): Promise<void> {
  const rootArg = requiredArg("root")
  if (!isAbsolute(rootArg)) throw new Error("--root must be absolute")
  const root = resolve(rootArg)
  const role = requiredArg("role")
  if (role !== "baseline" && role !== "candidate") throw new Error("--role must be baseline or candidate")
  const revision = requiredArg("revision")
  const scenario = requiredArg("scenario")
  const nativePath = requiredArg("native-path")
  const expectedNativeSha = requiredArg("native-sha")

  let highlightAcceptedAt = 0
  let chunksReadyAt = 0
  let firstBufferWriteStart = 0
  let lastBufferWriteEnd = 0
  let anyBufferWrite = false
  let setStyledCalls = 0
  let appendStyledCalls = 0
  let bufferWriteSamples: number[] = []

  const [
    { createTestRenderer },
    { CodeRenderable },
    { SyntaxStyle },
    { RGBA },
    treeSitterModule,
    converterModule,
    zig,
  ] = await Promise.all([
    import(sourceUrl(root, "testing/test-renderer.ts")),
    import(sourceUrl(root, "renderables/Code.ts")),
    import(sourceUrl(root, "syntax-style.ts")),
    import(sourceUrl(root, "lib/RGBA.ts")),
    import(sourceUrl(root, "lib/tree-sitter/client.ts")),
    import(sourceUrl(root, "lib/tree-sitter-styled-text.ts")),
    import(sourceUrl(root, "zig.ts")),
  ])

  zig.setRenderLibPath(nativePath)
  const dataPath = mkdtempSync(join(tmpdir(), `opentui-wave3cpu-${role}-`))
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
    onHighlight: (highlights: unknown[]) => {
      highlightAcceptedAt = performance.now()
      return highlights
    },
    onChunks: (chunks: unknown[]) => {
      chunksReadyAt = performance.now()
      return chunks
    },
  })

  {
    const textBuffer = (code as any).textBuffer as {
      setStyledText: (...args: unknown[]) => unknown
      appendStyledText?: (...args: unknown[]) => unknown
    }
    const setStyledText = textBuffer.setStyledText.bind(textBuffer)
    const appendStyledText = textBuffer.appendStyledText?.bind(textBuffer)
    textBuffer.setStyledText = (...args: unknown[]) => {
      const start = performance.now()
      try {
        return setStyledText(...args)
      } finally {
        const end = performance.now()
        bufferWriteSamples.push(end - start)
        if (!anyBufferWrite) firstBufferWriteStart = start
        lastBufferWriteEnd = end
        anyBufferWrite = true
        setStyledCalls++
      }
    }
    if (appendStyledText) {
      textBuffer.appendStyledText = (...args: unknown[]) => {
        const start = performance.now()
        try {
          return appendStyledText(...args)
        } finally {
          const end = performance.now()
          bufferWriteSamples.push(end - start)
          if (!anyBufferWrite) firstBufferWriteStart = start
          lastBufferWriteEnd = end
          anyBufferWrite = true
          appendStyledCalls++
        }
      }
    }
  }

  try {
    setup.renderer.root.add(code)
    await setup.renderOnce()

    let updates: string[]
    let marker: string
    if (scenario === "cold-1000") {
      marker = "COLD_FINAL"
      updates = [makeCodeContent(1000, marker)]
    } else if (scenario === "warm-1000-append100") {
      const workload = makeWarmAppendWorkload(1000, 100)
      code.content = workload.initial
      await setup.renderOnce()
      await withTimeout(code.highlightingDone, 30_000, "warmup highlight")
      await setup.flush({ maxPasses: 200 })
      updates = workload.updates
      marker = workload.finalMarker
    } else {
      throw new Error(`unsupported scenario: ${scenario}`)
    }

    const nativeBefore = setup.getNativeStats()
    highlightAcceptedAt = 0
    chunksReadyAt = 0
    firstBufferWriteStart = 0
    lastBufferWriteEnd = 0
    anyBufferWrite = false
    setStyledCalls = 0
    appendStyledCalls = 0
    bufferWriteSamples = []

    const tUpdateStart = performance.now()
    for (const content of updates) code.content = content
    const tSetterEnd = performance.now()

    await setup.renderOnce()
    const tRenderKickEnd = performance.now()
    await withTimeout(code.highlightingDone, 30_000, "measured highlight")
    if (scenario === "warm-1000-append100") code.scrollY = code.maxScrollY
    await setup.flush({ maxPasses: 200 })
    const tStyledCommitEnd = performance.now()
    const nativeAfter = setup.getNativeStats()

    // Worker wait is the separated window between the render-side job post and
    // the accepted-generation callback; it is REPORTED but never summed.
    const workerWaitMs = Math.max(0, highlightAcceptedAt - tRenderKickEnd)
    const workerPerf = await withTimeout(client.getPerformance(), 30_000, "worker performance")
    const workerCpuMs = (workerPerf.averageParseTime ?? 0) + (workerPerf.averageQueryTime ?? 0)
    const textBufferWriteMs = bufferWriteSamples.reduce((total, value) => total + value, 0)

    // Build the disjoint main-thread stage set. The textBuffer stage is the
    // union window [first write start, last write end]; individual native write
    // durations are kept as a diagnostic.
    const stages: Wave3CpuStageSpan[] = buildDisjointStages([
      { stage: "contentUpdate", startMs: tUpdateStart, endMs: tSetterEnd },
      { stage: "workerPost", startMs: tSetterEnd, endMs: tRenderKickEnd },
      {
        stage: "converter",
        startMs: highlightAcceptedAt === 0 ? tRenderKickEnd : highlightAcceptedAt,
        endMs: chunksReadyAt === 0 ? tRenderKickEnd : chunksReadyAt,
      },
      {
        stage: "safeAppend",
        startMs: chunksReadyAt === 0 ? tRenderKickEnd : chunksReadyAt,
        endMs: anyBufferWrite ? firstBufferWriteStart : tRenderKickEnd,
      },
      {
        stage: "textbuffer",
        startMs: anyBufferWrite ? firstBufferWriteStart : tRenderKickEnd,
        endMs: anyBufferWrite ? lastBufferWriteEnd : tRenderKickEnd,
      },
    ])

    if (!anyBufferWrite || !client) {
      throw new Error("CPU probe invariant failed: no styled text buffer write in the measured generation")
    }

    const frame = setup.captureCharFrame()
    const spans = setup.captureSpans()
    const expectedRed = RGBA.fromValues(255, 0, 0, 255)
    const styledVerified = spans.lines.some((line: any) =>
      line.spans.some((span: any) => span.text.includes("const") && span.fg?.equals(expectedRed)),
    )
    const finalMarkerVisible = frame.includes(marker!)
    const nativeFrameDelta = nativeAfter.nativeFrameCount - nativeBefore.nativeFrameCount
    if (!finalMarkerVisible || nativeFrameDelta < 1) {
      throw new Error(
        `styled native commit invariant failed: marker=${finalMarkerVisible} frames=${nativeBefore.nativeFrameCount}->${nativeAfter.nativeFrameCount}`,
      )
    }

    const finalContent = updates.at(-1)!
    const highlightResult = await withTimeout(
      client.highlightOnce(finalContent, "typescript"),
      30_000,
      "oracle highlight",
    )
    const chunks = converterModule.treeSitterToTextChunks(finalContent, highlightResult.highlights ?? [], syntaxStyle)

    const mainThreadSumMs = computeMainThreadSum(stages)
    const updateToStyledCommitMs = tStyledCommitEnd - tUpdateStart
    const classification = classifyWave3CpuResult({
      stages,
      workerWaitMs,
      workerCpuMs,
      updateToStyledCommitMs,
      styledVerified,
      nativeFrameDelta,
    })

    const result: CpuProbeResult = {
      schemaVersion: 1,
      role,
      root,
      revision,
      scenario,
      runtime: { bun: Bun.version, node: process.version },
      nativeSha256: expectedNativeSha,
      stages,
      mainThreadSumMs,
      workerWaitMs,
      workerCpuMs,
      updateToStyledCommitMs,
      styledVerified,
      nativeFrameDelta,
      counts: {
        cellsUpdated: nativeAfter.cellsUpdated,
        highlightCount: (highlightResult.highlights ?? []).length,
        chunkCount: chunks.length,
        setStyledCalls,
        appendStyledCalls,
      },
      correctness: {
        frameSha256: sha256(frame),
        spansSha256: sha256(normalizeForDigest(spans)),
        chunksSha256: sha256(normalizeForDigest(chunks)),
        finalMarkerVisible,
      },
      verdict: classification.verdict,
    }

    process.stdout.write(
      `WAVE3_CPU_DIAGNOSTIC ${JSON.stringify({ textBufferWriteMs, bufferWriteSamples, classification })}\n`,
    )
    process.stdout.write(`WAVE3_WORKER_PERFORMANCE ${JSON.stringify(workerPerf)}\n`)
    process.stdout.write(`${RESULT_PREFIX}${JSON.stringify(result)}\n`)
  } finally {
    code.destroy()
    setup.renderer.destroy()
    syntaxStyle.destroy()
    await client.destroy().catch(() => undefined)
  }
}

main().catch((error) => {
  console.error("wave3 cpu probe failed:", error)
  process.exitCode = 1
})
