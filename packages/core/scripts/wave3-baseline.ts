// Loop A (D3-D5): Wave-3 frozen-baseline raw-data runner.
//
// Produces the frozen fccae215 baseline matrix using the Wave-3 streaming E2E
// harness. Both arms here are the SAME frozen-baseline binary (the candidate from
// other loops is not integrated yet), so the paired analysis doubles as a balance
// check: pairedChange ~ 0 and secondPositionEffect small. Raw samples are written
// append-only to .yesmem/bench/wave3-loop-a/.
//
// The worker chain is measured through the controlled completion seam (the real
// tree-sitter worker requires a fully staged @opentui/core asset package not
// present in this source-tree test context - see report SS5.7). Native provenance
// is taken from the pinned staged artifact when present, else the pinned hash.
//
// Usage: bun scripts/wave3-baseline.ts [--pairs N] [--scenario code-stream:100|code-stream:5000]

import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { runWave3CodeGeneration, assertWave3SampleGreen, Wave3Arm, Wave3Sample } from "../src/benchmark/wave3-harness.js"
import { analyzeMarkdownStreaming } from "../src/benchmark/wave3-markdown-attribution.js"
import { MockTreeSitterClient } from "../src/testing/mock-tree-sitter-client.js"
import {
  createPairedSchedule,
  analyzePairedObservations,
} from "../src/benchmark/ffi-fast-path-paired-analysis.js"

const PINNED_NATIVE_SHA = "e7e9764462f2ee7f2c808856b60101ff659c6bda4a1df7cf235e418cf481a15c"

interface SampleRow {
  pair: number
  order: string
  scenario: string
  arm: string
  mainThreadSumMs: number
  updateToCommitMs: number
  nativeFrameCount: number
  cellsUpdated: number
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN
  const index = (sorted.length - 1) * p
  const lower = Math.floor(index)
  const fraction = index - lower
  return sorted[lower]! + (sorted[Math.min(lower + 1, sorted.length - 1)]! - sorted[lower]!) * fraction
}

function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  return {
    n: values.length,
    mean: values.reduce((a, b) => a + b, 0) / (values.length || 1),
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    min: sorted[0],
    max: sorted[sorted.length - 1],
  }
}

function sha256File(path: string): string | null {
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex")
  } catch {
    return null
  }
}

function captureHostProvenance(): Record<string, string> {
  const proven: Record<string, string> = {}
  for (const [key, cmd] of [
    ["commit", "git rev-parse HEAD"],
    ["opentui", "jq -r '.name + \"@\" + .version' package.json"],
    ["bun", "bun --version"],
    ["node", "node --version"],
    ["loadavg", "cat /proc/loadavg"],
  ] as const) {
    try {
      proven[key] = execFileSync("bash", ["-lc", cmd], { encoding: "utf8" }).trim()
    } catch (error) {
      proven[key] = `unavailable: ${error}`
    }
  }
  try {
    proven["governor"] = readFileSync("/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor", "utf8").trim()
  } catch {
    proven["governor"] = "unavailable"
  }
  return proven
}

function arg(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`)
  if (index === -1 || index + 1 >= process.argv.length) return fallback
  const parsed = Number(process.argv[index + 1])
  return Number.isFinite(parsed) ? parsed : fallback
}

function buildScenarioContent(kind: string): { content: string; keyword: string } {
  const count = kind.includes("5000") ? 5000 : 100
  const lines: string[] = []
  for (let i = 0; i < count; i++) lines.push(`let VAL_${i}: number = ${i}`)
  // Verified styled text must be inside the 24-row viewport (line 0 is visible).
  return { content: lines.join("\n"), keyword: "VAL_0" }
}

async function main(): Promise<void> {
  const pairs = arg("pairs", 10)
  const scenarioKey = process.argv.find((a) => a.startsWith("--scenario="))?.split("=")[1] ?? "code-stream:100"
  const { content, keyword } = buildScenarioContent(scenarioKey)
  const scenario = `code-stream:80x24:${scenarioKey}`

  const nativeSha = sha256File(
    join(process.cwd(), ".yesmem/native-assets/@opentui/core-linux-x64/libopentui.so"),
  ) ?? PINNED_NATIVE_SHA
  if (nativeSha !== PINNED_NATIVE_SHA) {
    console.warn(`[wave3] native hash differs from pinned (${nativeSha.slice(0, 12)}...)`)
  }

    const schedule = createPairedSchedule([scenarioKey], ["bun"], pairs, 2026)
    const rows: SampleRow[] = []

    for (let pair = 0; pair < pairs; pair++) {
      // Alternate the lead arm per pair so the schedule is balanced (both strata).
      const lead: Wave3Arm = pair % 2 === 0 ? "baseline" : "candidate"
      const follow: Wave3Arm = lead === "baseline" ? "candidate" : "baseline"
      const pairOrder = `${lead}-first`
      for (const arm of [lead, follow]) {
        // Warmup runs (balanced, not recorded) keep caches warm.
        for (let w = 0; w < 3; w++) {
          await runWave3CodeGeneration({
            content,
            expectedStyledText: keyword,
            treeSitterClient: cloneMockClient(content, keyword),
            expectedNativeSha256: nativeSha,
            sourceClean: true,
            arm,
            scenario,
          })
        }
        const sample = await runWave3CodeGeneration({
          content,
          expectedStyledText: keyword,
          treeSitterClient: cloneMockClient(content, keyword),
          expectedNativeSha256: nativeSha,
          sourceClean: true,
          arm,
          scenario,
        })
        assertWave3SampleGreen(sample)
        rows.push({
          pair,
          order: pairOrder,
          scenario,
          arm,
          mainThreadSumMs: sample.mainThreadSumMs,
          updateToCommitMs: sample.stages.nativeCommit[1] - sample.stages.append[0],
          nativeFrameCount: sample.counts.nativeFrameCount,
          cellsUpdated: sample.counts.cellsUpdated,
        })
      }
    }

  // Balanced paired analysis: baseline-vs-candidate are the same binary here, so a
  // large |pairedChange| or secondPositionEffect flags an imbalance in the harness.
  const observations = []
  for (let pair = 0; pair < pairs; pair++) {
    const base = rows.find((r) => r.pair === pair && r.arm === "baseline")!
    const cand = rows.find((r) => r.pair === pair && r.arm === "candidate")!
    observations.push({
      pair,
      order: base.order,
      gapMs: 0,
      baselineNsPerOp: base.mainThreadSumMs * 1e6,
      candidateNsPerOp: cand.mainThreadSumMs * 1e6,
    })
  }
  const analysis = analyzePairedObservations(observations, 2000, 0.95, 7)

  const mdReport = analyzeMarkdownStreaming("prose", 8192, 16)

  const outDir = join(process.cwd(), ".yesmem/bench/wave3-loop-a")
  mkdirSync(outDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const provenance = captureHostProvenance()
  const payload = {
    schemaVersion: 1,
    scenario,
    pairs,
    pairCount: analysis.pairs,
    nativeSha,
    pinnedNativeSha: PINNED_NATIVE_SHA,
    provenance: { ...provenance, sampleCount: rows.length },
    byArm: {
      baseline: stats(rows.filter((r) => r.arm === "baseline").map((r) => r.mainThreadSumMs)),
      candidate: stats(rows.filter((r) => r.arm === "candidate").map((r) => r.mainThreadSumMs)),
    },
    updateToCommit: {
      baseline: stats(rows.filter((r) => r.arm === "baseline").map((r) => r.updateToCommitMs)),
      candidate: stats(rows.filter((r) => r.arm === "candidate").map((r) => r.updateToCommitMs)),
    },
    paired: {
      pairedChange: analysis.pairedChange,
      ci: analysis.ci,
      secondPositionEffect: analysis.secondPositionEffect,
      orderCounts: analysis.orderCounts,
    },
    markdownAttribution: {
      category: mdReport.category,
      finalBytes: mdReport.finalContentBytes,
      stepCount: mdReport.steps.length,
      tailClassCounts: mdReport.aggregate.tailClassCounts,
      meanParseDurationMs: mdReport.aggregate.meanParseDurationMs,
      allStableRefsPreserved: mdReport.aggregate.allStableRefsPreserved,
    },
  }
  const rawFile = join(outDir, `baseline-${scenarioKey}-${stamp}.json`)
  writeFileSync(rawFile, JSON.stringify(payload, null, 2))
  console.log(`[wave3] wrote ${rawFile}`)
  console.log(JSON.stringify(payload.byArm, null, 2))
  console.log(`[wave3] pairedChange=${analysis.pairedChange} secondPositionEffect=${analysis.secondPositionEffect}`)
}

// A fresh styled mock per run so no sample shares client state.
function cloneMockClient(content: string, keyword: string): MockTreeSitterClient {
  const client = new MockTreeSitterClient({ autoResolveTimeout: 2 })
  const start = content.indexOf(keyword)
  const end = start === -1 ? 0 : start + keyword.length
  client.setMockResult({ highlights: [[start, end, "keyword"] as [number, number, string]] })
  return client
}

main().catch((error) => {
  console.error("[wave3] baseline run failed:", error)
  process.exitCode = 1
})
