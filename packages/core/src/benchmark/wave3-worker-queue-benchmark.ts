/**
 * Wave-3 Loop C worker/queue burst benchmark.
 *
 * Measures the latest-wins backpressure contract on the real worker:
 *  - burst: N same-turn updates coalesce to <=2 posted jobs, >=N-2 superseded,
 *    single newest pending payload (pendingByteHighWater), active HWM <=1,
 *    and end-to-end latency from first update to final versioned ACK.
 *  - single update p95 (absolute; regression vs baseline is validated by the
 *    Loop-A paired harness at integration).
 *
 * Output: append-only JSON to .yesmem/bench/wave3-loop-c/wave3-loop-c-worker-queue.json
 */
import { join } from "path"
import { mkdirSync, appendFileSync } from "fs"
import { TreeSitterClient } from "../lib/tree-sitter/client.js"

const DATA_PATH = process.env.OTUI_BENCH_DATA_PATH ?? join(import.meta.dir, "..", ".yesmem", "bench-data")
const OUT = join(import.meta.dir, "..", "..", "..", "..", ".yesmem", "bench", "wave3-loop-c")
const OUT_FILE = join(OUT, "wave3-loop-c-worker-queue.json")

function nowMs(): number {
  return performance.now()
}

function appendEdit(content: string, next: string): unknown[] {
  return [
    {
      startIndex: content.length,
      oldEndIndex: content.length,
      newEndIndex: next.length,
      startPosition: { row: 0, column: content.length },
      oldEndPosition: { row: 0, column: content.length },
      newEndPosition: { row: 1, column: next.length - content.length },
    },
  ]
}

async function run() {
  const client = new TreeSitterClient({ dataPath: DATA_PATH })
  await client.initialize()
  const base = "const a = 1\n"
  await client.createBuffer(1, base, "javascript")

  // Warmup
  for (let w = 0; w < 3; w++) {
    await client.updateBuffer(1, appendEdit(base, `${base}const warm${w} = ${w}\n`), `${base}const warm${w} = ${w}\n`, 2 + w)
  }
  await client.resetBuffer(1, 100, base).catch(() => {})

  const runId = `${Date.now()}`
  const samples: unknown[] = []

  // --- Burst scenario: N same-turn updates coalesce to a single final ACK ---
  const BURST = 100
  const burstStart = nowMs()
  const burstCalls: Array<Promise<unknown>> = []
  const baseContent = "const a = 1\n"
  const postedBefore = client.getUpdateQueueStats().posted
  for (let i = 0; i < BURST; i++) {
    const content = `${baseContent}const v${i} = ${i}; ${"x".repeat(i + 1)}\n`
    burstCalls.push(client.updateBuffer(1, appendEdit(baseContent, content), content, 2000 + i))
  }
  const burstOutcomes = await Promise.all(burstCalls)
  const burstEnd = nowMs()

  const stats1 = client.getUpdateQueueStats()
  const burstPosted = stats1.posted - postedBefore
  const completed = burstOutcomes.filter((o: any) => o.status === "completed").length
  const superseded = burstOutcomes.filter((o: any) => o.status === "superseded").length

  // --- Single update p95 over reps (absolute; baseline comparison at integration) ---
  const REPS = 30
  const singleTimes: number[] = []
  for (let r = 0; r < REPS; r++) {
    const content = `${baseContent}const s${r} = ${r}\n`
    const t0 = nowMs()
    await client.updateBuffer(1, appendEdit(baseContent, content), content, 10000 + r)
    singleTimes.push(nowMs() - t0)
  }
  singleTimes.sort((a, b) => a - b)
  const p95 = singleTimes[Math.min(REPS - 1, Math.floor(REPS * 0.95))]

  const result = {
    runId,
    burstSize: BURST,
    endToEndMs: +(burstEnd - burstStart).toFixed(3),
    burstStats: {
      posted: burstPosted,
      completed,
      superseded,
      activeHighWater: stats1.activeHighWater,
      pendingJobsHighWater: stats1.pendingJobsHighWater,
      pendingByteHighWater: stats1.pendingByteHighWater,
      pendingJobsGate: stats1.activeHighWater <= 1 && stats1.pendingJobsHighWater <= 1 ? "PASS" : "FAIL",
      postedGate: burstPosted <= 2 ? "PASS" : "FAIL",
      supersededGate: superseded >= BURST - 2 ? "PASS" : "FAIL",
    },
    singleUpdate: {
      reps: REPS,
      p50Ms: +singleTimes[Math.floor(REPS / 2)].toFixed(3),
      p95Ms: +p95.toFixed(3),
    },
    host: {
      bun: process.versions.bun ?? "n/a",
      node: process.version,
    },
  }

  mkdirSync(OUT, { recursive: true })
  appendFileSync(OUT_FILE, JSON.stringify(result) + "\n")

  console.log(JSON.stringify(result, null, 2))
  await client.destroy().catch(() => {})
}

run().catch((error) => {
  console.error("wave3 worker-queue benchmark failed:", error)
  process.exit(1)
})
