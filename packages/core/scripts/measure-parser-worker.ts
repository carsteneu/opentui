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
 *   bun scripts/measure-parser-worker.ts --verify-executed
 * Raw samples are appended to .yesmem/tmp/raw/measure-parser-worker-<ts>.json.
 * `--verify-executed` runs a self-contained probe proving that a Bun `type: "file"`
 * import resolves the target to a path string WITHOUT executing its module body
 * (i.e. the eager parser-worker resolution never runs the worker on the main thread).
 */
import { execFileSync, spawnSync } from "node:child_process"
import { appendFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { isAbsolute, join } from "node:path"

const args = process.argv.slice(2)
const samples = Number(args[0] ?? 30)
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

function runScenario(snippet: string): number {
  const r = spawnSync(BUN, ["-e", snippet], { encoding: "utf8", timeout: 120_000 })
  if (r.status !== 0 || r.error) {
    throw new Error(`subprocess failed: ${r.status ?? r.error} :: ${r.stderr}`)
  }
  // bun colors stdout even when not a TTY; strip ANSI before numeric parse.
  const plain = r.stdout.replace(/\x1b\[[0-9;]*m/g, "")
  const line = plain.trim().split("\n").filter(Boolean).pop() ?? ""
  const parsed = Number(line)
  if (!Number.isFinite(parsed)) {
    throw new Error(`non-numeric output from snippet: ${JSON.stringify(line)}`)
  }
  return parsed
}

export function calculateStats(values: number[]): { median: number; p95: number; min: number; max: number } {
  const sorted = [...values].sort((a, b) => a - b)
  if (sorted.length === 0) {
    throw new Error("cannot calculate statistics for an empty sample")
  }

  const middle = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!
  const p95Index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)

  return {
    median,
    p95: sorted[p95Index]!,
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
  }
}

/**
 * Proves a Bun `import(mod, { with: { type: "file" } })` resolves the target to a
 * path string WITHOUT executing its module body. The marker module, if executed,
 * would write `sentinel`; the probe asserts the sentinel was NOT created and the
 * resolved `default` is a string path. Exit 0 = PASS, 1 = FAIL.
 */
function verifyExecutedProbe(): void {
  const tmp = join(process.cwd(), ".yesmem", "tmp")
  const sentinel = join(tmp, `probe-executed-${process.pid}.tmp`)
  const marker = join(tmp, `probe-marker-${process.pid}.ts`)
  mkdirSync(tmp, { recursive: true })
  rmSync(sentinel, { force: true })

  try {
    const markerBody = `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(sentinel)}, "executed"); export default "/resolved/asset/path"`
    writeFileSync(marker, markerBody)

    const snippet = `const r = await import(${JSON.stringify(marker)}, { with: { type: "file" } }); console.log(JSON.stringify({ default: r.default }))`
    const result = spawnSync(BUN, ["-e", snippet], { encoding: "utf8", timeout: 30_000 })
    const executed = existsSync(sentinel)
    const plain = (result.stdout ?? "").replace(/\x1b\[[0-9;]*m/g, "").trim()

    console.log(`type:"file" child output: ${JSON.stringify(plain)}`)
    console.log(`module body executed during resolution: ${executed}`)

    if (result.error || result.status !== 0) {
      throw new Error(
        `probe child failed: status=${result.status ?? "none"} signal=${result.signal ?? "none"} error=${result.error?.message ?? "none"} stderr=${JSON.stringify(result.stderr ?? "")}`,
      )
    }
    if (executed) {
      throw new Error("marker module body ran — the eager resolve WOULD execute the worker on the main thread")
    }

    let loaded: unknown
    try {
      loaded = JSON.parse(plain)
    } catch (error) {
      throw new Error(`probe child returned invalid JSON: ${JSON.stringify(plain)}`, { cause: error })
    }

    const loadedPath = (loaded as { default?: unknown }).default
    if (typeof loadedPath !== "string" || loadedPath.length === 0) {
      throw new Error(`type:"file" default export is not a non-empty string: ${JSON.stringify(loadedPath)}`)
    }
    if (!isAbsolute(loadedPath) && !loadedPath.startsWith("file:")) {
      throw new Error(`type:"file" default export is not an absolute file path: ${JSON.stringify(loadedPath)}`)
    }

    console.log('PASS: `type:"file"` resolves a path string WITHOUT executing the module body.')
  } finally {
    rmSync(marker, { force: true })
    rmSync(sentinel, { force: true })
  }
}

function main(): void {
  if (args.includes("--verify-executed")) {
    verifyExecutedProbe()
    return
  }

  if (!Number.isSafeInteger(samples) || samples <= 0) {
    throw new Error(`samples must be a positive integer, received ${JSON.stringify(args[0])}`)
  }

  for (let i = 0; i < warmup; i++) {
    for (const s of SCENARIOS) {
      try {
        runScenario(s.snippet)
      } catch {
        /* warm-up noise ignored */
      }
    }
  }

  const raw: Row[] = []
  const buckets: Record<string, number[]> = { "worker-resolve": [], "runtime-assets": [], root: [] }

  for (let i = 0; i < samples; i++) {
    for (const s of SCENARIOS) {
      const ns = runScenario(s.snippet)
      raw.push({ scenario: s.name, idx: i, ns })
      buckets[s.name]!.push(ns)
    }
  }

  console.log(`samples=${samples} warmup=${warmup}  (cold subprocess, Bun ${BUN})\n`)
  const table: Array<[string, number, number, number, number]> = []
  for (const s of SCENARIOS) {
    const st = calculateStats(buckets[s.name]!)
    table.push([s.name, st.median / 1e6, st.p95 / 1e6, st.min / 1e6, st.max / 1e6])
  }
  console.log("scenario        median(ms)  p95(ms)   min(ms)   max(ms)")
  for (const [name, med, p95, min, max] of table) {
    console.log(
      `${name.padEnd(14)} ${med.toFixed(3).padStart(9)}  ${p95.toFixed(3).padStart(7)}  ${min.toFixed(3).padStart(7)}  ${max.toFixed(3).padStart(7)}`,
    )
  }

  const workerMed = calculateStats(buckets["worker-resolve"]!).median
  const rootMed = calculateStats(buckets.root).median
  console.log(`\nworker-resolve/root (median) = ${((workerMed / rootMed) * 100).toFixed(3)} %`)

  const outDir = join(process.cwd(), ".yesmem", "tmp", "raw")
  mkdirSync(outDir, { recursive: true })
  const path = join(outDir, `measure-parser-worker-${Date.now()}.json`)
  appendFileSync(
    path,
    JSON.stringify(
      { ts: Date.now(), samples, warmup, bunVersion: execFileSync(BUN, ["--version"]).toString().trim(), raw },
      null,
      2,
    ),
  )
  console.log(`\nraw: ${path}`)
}

if (import.meta.main) {
  main()
}
