import { createHash } from "node:crypto"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { isAbsolute, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { makeCodeContent, makeWarmAppendWorkload } from "./wave3-real-worker-workload.js"

interface ProbeResult {
  schemaVersion: 1
  role: "baseline" | "candidate"
  root: string
  revision: string
  scenario: string
  runtime: { bun: string; node: string }
  nativeSha256: string
  timings: {
    setterMs: number
    renderKickWallMs: number
    workerAndPipelineWallMs: number
    commitRenderWallMs: number
    updateToStyledCommitMs: number
    converterMs: number
    processCpuUserMicros: number
    processCpuSystemMicros: number
  }
  counts: {
    nativeFrameDelta: number
    cellsUpdated: number
    highlightCount: number
    chunkCount: number
  }
  correctness: {
    styledVerified: boolean
    finalMarkerVisible: boolean
    frameSha256: string
    spansSha256: string
    chunksSha256: string
  }
}

const RESULT_PREFIX = "WAVE3_RESULT "

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
  const diagnostics = process.argv.includes("--diagnostics")
  let highlightAcceptedAt = 0
  let chunksReadyAt = 0
  let styledTextMs = 0
  let styledTextCalls = 0

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
  const dataPath = mkdtempSync(join(tmpdir(), `opentui-wave3-${role}-`))
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
    onHighlight: diagnostics
      ? (highlights: any[]) => {
          highlightAcceptedAt = performance.now()
          return highlights
        }
      : undefined,
    onChunks: diagnostics
      ? (chunks: any[]) => {
          chunksReadyAt = performance.now()
          return chunks
        }
      : undefined,
  })

  if (diagnostics) {
    const textBuffer = (code as any).textBuffer
    const setStyledText = textBuffer.setStyledText.bind(textBuffer)
    textBuffer.setStyledText = (...args: unknown[]) => {
      const start = performance.now()
      try {
        return setStyledText(...args)
      } finally {
        styledTextMs += performance.now() - start
        styledTextCalls++
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
    const cpuBefore = process.cpuUsage()
    highlightAcceptedAt = 0
    chunksReadyAt = 0
    styledTextMs = 0
    styledTextCalls = 0
    const updateStart = performance.now()
    for (const content of updates) code.content = content
    const setterEnd = performance.now()

    await setup.renderOnce()
    const renderKickEnd = performance.now()
    await withTimeout(code.highlightingDone, 30_000, "measured highlight")
    const pipelineEnd = performance.now()
    if (scenario === "warm-1000-append100") code.scrollY = code.maxScrollY
    await setup.flush({ maxPasses: 200 })
    const commitEnd = performance.now()
    const cpu = process.cpuUsage(cpuBefore)
    const nativeAfter = setup.getNativeStats()
    const workerPerformance = await withTimeout(client.getPerformance(), 30_000, "worker performance")

    const frame = setup.captureCharFrame()
    const spans = setup.captureSpans()
    const expectedRed = RGBA.fromValues(255, 0, 0, 255)
    const styledVerified = spans.lines.some((line: any) =>
      line.spans.some((span: any) => span.text.includes("const") && span.fg?.equals(expectedRed)),
    )
    const finalMarkerVisible = frame.includes(marker!)
    if (!styledVerified || !finalMarkerVisible || nativeAfter.nativeFrameCount <= nativeBefore.nativeFrameCount) {
      throw new Error(
        `styled native commit invariant failed: styled=${styledVerified} marker=${finalMarkerVisible} ` +
          `frames=${nativeBefore.nativeFrameCount}->${nativeAfter.nativeFrameCount}`,
      )
    }

    const finalContent = updates.at(-1)!
    const highlightResult = await withTimeout(
      client.highlightOnce(finalContent, "typescript"),
      30_000,
      "oracle highlight",
    )
    const converterStart = performance.now()
    const chunks = converterModule.treeSitterToTextChunks(finalContent, highlightResult.highlights ?? [], syntaxStyle)
    const converterEnd = performance.now()

    const result: ProbeResult = {
      schemaVersion: 1,
      role,
      root,
      revision,
      scenario,
      runtime: { bun: Bun.version, node: process.version },
      nativeSha256: expectedNativeSha,
      timings: {
        setterMs: setterEnd - updateStart,
        renderKickWallMs: renderKickEnd - setterEnd,
        workerAndPipelineWallMs: pipelineEnd - renderKickEnd,
        commitRenderWallMs: commitEnd - pipelineEnd,
        updateToStyledCommitMs: commitEnd - updateStart,
        converterMs: converterEnd - converterStart,
        processCpuUserMicros: cpu.user,
        processCpuSystemMicros: cpu.system,
      },
      counts: {
        nativeFrameDelta: nativeAfter.nativeFrameCount - nativeBefore.nativeFrameCount,
        cellsUpdated: nativeAfter.cellsUpdated,
        highlightCount: (highlightResult.highlights ?? []).length,
        chunkCount: chunks.length,
      },
      correctness: {
        styledVerified,
        finalMarkerVisible,
        frameSha256: sha256(frame),
        spansSha256: sha256(normalizeForDigest(spans)),
        chunksSha256: sha256(normalizeForDigest(chunks)),
      },
    }

    if (diagnostics) {
      process.stdout.write(
        `WAVE3_STAGE_DIAGNOSTIC ${JSON.stringify({
          workerResponseWallMs: highlightAcceptedAt - renderKickEnd,
          converterWallMs: chunksReadyAt - highlightAcceptedAt,
          styledTextMs,
          styledTextCalls,
          postChunksWallMs: pipelineEnd - chunksReadyAt,
        })}\n`,
      )
    }
    process.stdout.write(`WAVE3_WORKER_PERFORMANCE ${JSON.stringify(workerPerformance)}\n`)
    process.stdout.write(`${RESULT_PREFIX}${JSON.stringify(result)}\n`)
  } finally {
    code.destroy()
    setup.renderer.destroy()
    syntaxStyle.destroy()
    await client.destroy().catch(() => undefined)
  }
}

main().catch((error) => {
  console.error("wave3 real-worker probe failed:", error)
  process.exitCode = 1
})
