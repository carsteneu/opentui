// Wave-3 memory gate (Loop C) — portable A/B probe (eventloop-p99 + heap).
//
// Self-contained and arm-agnostic: relies ONLY on public seams present on both
// candidate (ab2b9ebc) and baseline (fccae215) — CodeRenderable streaming,
// createTestRenderer, SyntaxStyle, TreeSitterClient, native getAllocatorStats,
// process.memoryUsage, setTimeout/performance.now. It deliberately does NOT read
// client internals or queue stats (those are candidate-only).
//
// Usage: bun src/benchmark/wave3-memory-ab-probe.ts
//        --role=baseline|candidate --out=<json path>
//        [--mutations=2000] [--window-lines=1000] [--settle-every=64] [--gc=0|1]
//
// The identical source file is copied into both arms so a single measurement
// procedure yields comparable eventloop-p99 and heap-window data.

import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { execSync } from "node:child_process"
import { CodeRenderable } from "../renderables/Code.js"
import { SyntaxStyle } from "../syntax-style.js"
import { RGBA } from "../lib/RGBA.js"
import { createTestRenderer } from "../testing/test-renderer.js"
import { TreeSitterClient } from "../lib/tree-sitter/index.js"
import { resolveRenderLib } from "../zig.js"
import { forceGC, startEventLoopLagSampler } from "./wave3-memory-portable.js"

function argString(name: string): string | undefined {
  const prefix = `--${name}=`
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length)
}
function argNumber(name: string, fallback: number): number {
  const raw = argString(name)
  if (raw === undefined) return fallback
  const v = Number(raw)
  return Number.isFinite(v) ? v : fallback
}

function makeTsContent(lines: number): string {
  const out: string[] = []
  for (let i = 0; i < lines; i++) {
    const variant = i % 3
    if (variant === 0) out.push(`const item${i} = { id: ${i}, name: "item_${i % 7}", qty: ${i * 2} }`)
    else if (variant === 1)
      out.push(
        `function process_${i}(${i % 5 > 0 ? "entry" : "value"}: number): boolean { return entry${i % 5 > 0 ? ` + ${i}` : ""} > ${i}; }`,
      )
    else out.push(`// handle id ${i} case for rolling ab probe`)
  }
  return out.join("\n")
}

function rollingShift(content: string, offset: number): string {
  const lines = content.split("\n")
  lines.shift()
  lines.push(
    offset % 2 === 0
      ? `const r${offset} = { id: ${offset}, qty: ${offset + 1} }`
      : `function roll_${offset}(x: number): number { return x + ${offset}; }`,
  )
  return lines.join("\n")
}

async function readRevision(root: string): Promise<string> {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: root, encoding: "utf8" }).trim()
  } catch {
    return "unknown"
  }
}

async function main(): Promise<void> {
  const role = argString("role")
  if (role !== "baseline" && role !== "candidate") throw new Error("--role=baseline|candidate is required")
  const out = argString("out")
  if (!out) throw new Error("--out=<json path> is required")
  const mutations = argNumber("mutations", 2000)
  const windowLines = argNumber("window-lines", 1000)
  const settleEvery = argNumber("settle-every", 64)
  const doGc = argNumber("gc", 1) === 1
  const width = 250
  const height = 60

  const root = resolve(import.meta.dir, "..", "..", "..")
  const revision = await readRevision(root)
  const dataPath = mkdtempSync(join(tmpdir(), `opentui-wave3-ab-${role}-`))
  const client = new TreeSitterClient({ dataPath })

  const setup = await createTestRenderer({ width, height })
  const syntaxStyle = SyntaxStyle.fromStyles({ keyword: { fg: "#ff0000" }, number: { fg: "#00ffff" } })
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
  setup.renderer.root.add(code)

  const settle = async (): Promise<void> => {
    const deadline = performance.now() + 15_000
    await setup.renderOnce()
    while (performance.now() < deadline) {
      await setup.renderOnce()
      if (!code.isHighlighting) {
        await code.highlightingDone.catch(() => undefined)
        return
      }
      await new Promise((r) => setTimeout(r, 1))
    }
  }

  try {
    const fullContent = makeTsContent(windowLines)
    const windowContentBytes = Buffer.byteLength(fullContent, "utf8")
    code.content = fullContent
    await settle()
    if (doGc) forceGC()

    const eventLoopSampler = startEventLoopLagSampler({})
    const heapWindows: number[][] = []
    let mutation = 0
    for (; mutation < mutations; mutation++) {
      code.content =
        mutation % 256 === 0 ? makeTsContent(windowLines) : rollingShift(fullContent, (mutation * 7) % windowLines)
      if (mutation > 0 && mutation % settleEvery === 0) {
        await settle()
        if (doGc) forceGC()
        const m = process.memoryUsage()
        heapWindows.push([m.heapUsed, m.heapTotal, (m as { arrayBuffers?: number }).arrayBuffers ?? 0, m.rss])
      }
    }
    await settle()
    if (doGc) forceGC()
    const eventLoop = eventLoopSampler.stop()
    const native = resolveRenderLib().getAllocatorStats()
    const finalMemory = process.memoryUsage()

    setup.renderer.destroy()
    syntaxStyle.destroy()
    await client.destroy()

    mkdirSync(resolve(out, ".."), { recursive: true })
    writeFileSync(
      out,
      JSON.stringify(
        {
          schemaVersion: 1,
          role,
          revision,
          runtime: { bun: process.versions.bun ?? null, node: process.versions.node ?? null },
          width,
          height,
          windowLines,
          windowContentBytes,
          mutations,
          settleEvery,
          gc: doGc,
          eventLoop,
          heapWindows,
          finalMemory: {
            heapUsed: finalMemory.heapUsed,
            heapTotal: finalMemory.heapTotal,
            arrayBuffers: (finalMemory as { arrayBuffers?: number }).arrayBuffers ?? 0,
            rss: finalMemory.rss,
          },
          native: {
            activeAllocations: native.activeAllocations,
            totalRequestedBytes: native.totalRequestedBytes,
          },
        },
        null,
        2,
      ),
    )
    console.log(
      `${role} revision=${revision} eventLoopP99=${eventLoop.p99.toFixed(2)}ms p95=${eventLoop.p95.toFixed(2)} windows=${heapWindows.length} out=${out}`,
    )
  } finally {
    setup.renderer.destroy()
    syntaxStyle.destroy()
    await client.destroy()
  }
}

main().catch((error) => {
  console.error(`wave3-memory-ab-probe (${argString("role")}) failed:`, error)
  process.exitCode = 1
})
