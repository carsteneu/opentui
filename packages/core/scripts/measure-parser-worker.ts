/**
 * Loop C (B5) — isolated cold-import measurement of the eager parser-worker
 * asset resolution in runtime-assets.bun.ts.
 *
 * Measures (all under Bun, cold = fresh subprocess per sample):
 *   1. worker-resolve : the exact eager operation, `import("@opentui/core/parser.worker",
 *                       { with: { type: "file" } })`, which resolves the bundled worker
 *                       path at runtime-assets module scope on the import path.
 *   2. runtime-assets  : full module-scope eval of src/platform/runtime-assets.bun.ts
 *                       (includes the eager worker resolve + its static import graph).
 *   3. root            : full `@opentui/core` cold root import (denominator for the gate).
 *
 * Run from packages/core:  bun scripts/measure-parser-worker.ts [samples]
 * Raw samples are appended to .yesmem/tmp/raw/measure-parser-worker-<ts>.json.
 */
import { execFileSync, spawnSync } from "node:child_process"
import { mkdirSync, appendFileSync } from "node:fs"
import { join } from "node:path"

const samples = Number(process.argv[2] ?? 30)
const warmup = 3
const BUN = process.env.BUN_PATH ?? join(process.env.HOME ?? "", ".bun", "bin", "bun")
const WORKER_SNIPPET = `const t=performance.now(); await import("@opentui/core/parser.worker",{with:{type:"file"}}); console.log((performance.now()-t)*1e6);`
const ASSETS_SNIPPET = `const t=performance.now(); await import("./src/platform/runtime-assets.bun.ts"); console.log((performance.now()-t)*1e6);`
const ROOT_SNIPPET = `const t=performance.now(); await import("@opentui/core"); console.log((performance.now()-t)*1e6);`

// Order is stable; we round-robin scenarios per sample so cold-start drift is paired.
const SCENARIOS = [
  { name: "worker-resolve", snippet: WORKER_SNIPPET },
  { name: "runtime-assets", snippet: ASSETS_SNIPPET },
  { name: "root", snippet: ROOT_SNIPPET },
] as const

type Row = { scenario: string; idx: number; ns: number }

function runScenarion(snippet: string): number {
  const r = spawnSync(BUN, ["-e", snippet], { encoding: "utf8", timeout: 120_000 })
  if (r.status !== 0 || r.error) {
    throw new Error(`subprocess failed: ${r.status ?? r.error} :: ${r.stderr}`)
  }
  // bun colors stdout even when not a TTY; strip ANSI before numeric parse.
  const plain = r.stdout.replace(/\x1b\[[0-9;]*m/g, "")
  const line = plain.trim().split("\n").filter(Boolean).pop() ?? ""
  return Number(line)
}

function stats(values: number[]): { median: number; p95: number; min: number; max: number } {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = (x: number) => sorted[Math.min(sorted.length - 1, Math.floor(x))]!
  return {
    median: mid(sorted.length / 2),
    p95: mid(0.95 * sorted.length),
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
  }
}

function main(): void {
  // Warm-up (separate, not counted).
  for (let i = 0; i < warmup; i++) {
    for (const s of SCENARIOS) {
      try {
        runScenarion(s.snippet)
      } catch {
        /* warm-up noise ignored */
      }
    }
  }

  const raw: Row[] = []
  const buckets: Record<string, number[]> = { "worker-resolve": [], "runtime-assets": [], root: [] }

  for (let i = 0; i < samples; i++) {
    for (const s of SCENARIOS) {
      const ns = runScenarion(s.snippet)
      raw.push({ scenario: s.name, idx: i, ns })
      buckets[s.name]!.push(ns)
    }
  }

  console.log(`samples=${samples} warmup=${warmup}  (cold subprocess, Bun ${BUN})\n`)
  const table: Array<[string, number, number, number, number]> = []
  for (const s of SCENARIOS) {
    const st = stats(buckets[s.name]!)
    table.push([s.name, st.median / 1e6, st.p95 / 1e6, st.min / 1e6, st.max / 1e6])
  }
  console.log("scenario        median(ms)  p95(ms)   min(ms)   max(ms)")
  for (const [name, med, p95, min, max] of table) {
    console.log(`${name.padEnd(14)} ${med.toFixed(3).padStart(9)}  ${p95.toFixed(3).padStart(7)}  ${min.toFixed(3).padStart(7)}  ${max.toFixed(3).padStart(7)}`)
  }

  const workerMed = stats(buckets["worker-resolve"]!).median
  const rootMed = stats(buckets.root).median
  console.log(`\nworker-resolve/root (median) = ${((workerMed / rootMed) * 100).toFixed(3)} %`)

  const outDir = join(process.cwd(), ".yesmem", "tmp", "raw")
  mkdirSync(outDir, { recursive: true })
  const path = join(outDir, `measure-parser-worker-${Date.now()}.json`)
  appendFileSync(
    path,
    JSON.stringify({ ts: Date.now(), samples, warmup, bunVersion: execFileSync(BUN, ["--version"]).toString().trim(), raw }, null, 2),
  )
  console.log(`\nraw: ${path}`)
}

main()
