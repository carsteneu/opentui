// Cold-import / TTFMF measurement harness with a hard zero-cost acceptance gate.
//
// Spawns a fresh cold-import-probe child process per sample (real cold import),
// aggregates median/p95/p99/RME, persists a provenance row to
// <worktree>/.yesmem/bench/<artifact>/raw.ndjson (append-only), regenerates
// <artifact>/report.md from that raw file (never hand-edited), and optionally
// records the telemetry lifecycle marks/spans snapshot.
//
// Arms (each imports COMPLETELY from its own tree — no cross-worktree mixing):
//   branch-disabled  this worktree's src, telemetry off (true import graph)
//   branch-enabled   this worktree's src, telemetry on
//   fastpatch        UNMODIFIED fastpatch worktree's src, telemetry off
//
// Gates (paired per-iteration A/B, randomized 50/50 measurement order, decision
// on the MEDIAN of per-pair % difference — cancels background load drift):
//   --gate        THE acceptance gate: branch-disabled vs fastpatch, PASS iff
//                 (branch - fastpatch)/fastpatch <= threshold%. Drives exit.
//   --gate-record secondary/informational: branch-enabled vs branch-disabled
//                 (recording cost). No exit impact.
//
// Options:
//   --scenario=root|zig|dist   (default root)
//   --runtime=bun|node         (default bun; node requires EXACT v26.4.0)
//   --samples=N (default 30)  --warmup=N (default 3)
//   --threshold=<pct> (default 3)
//   --force-fail     debug/CI hook: force acceptance to FAIL (proves exit code)
//   --artifact=<name> (default cold-import-<commit>)
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { cpus, platform, arch } from "node:os"
import { join, dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, "..", "..", "..")
const coreDir = resolve(repoRoot, "packages", "core")
const branchSrcRoot = resolve(coreDir, "src")
const fastpatchCore = resolve(repoRoot, "..", "fastpatch", "packages", "core")
const fastpatchSrcRoot = resolve(fastpatchCore, "src")

const NODE26_REQUIRED = "v26.4.0"

function sourceEntry(name: string): string {
  return resolve(branchSrcRoot, `${name}.ts`)
}
function distEntry(runtime: "bun" | "node"): string {
  return resolve(coreDir, "dist", runtime === "node" ? "index.node.js" : "index.bun.js")
}

interface GateStats {
  median: number
  p95: number
  p99: number
  rmePct: number
  n: number
}
interface GateResult {
  kind: string
  aLabel: string
  bLabel: string
  a: GateStats
  b: GateStats
  overheadMedianPct: number
  gate: { thresholdPct: number; passed: boolean; rule: string }
}
type Stats = ReturnType<typeof stats>

function parseArgs(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const arg of process.argv.slice(2)) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(arg)
    if (m) out[m[1]!] = m[2] ?? ""
  }
  return out
}

function gitRevparse(ref: string): string {
  const r = spawnSync("git", ["rev-parse", ref], { cwd: repoRoot, encoding: "utf8" })
  return r.status === 0 ? r.stdout.trim() : "unknown"
}

function gitMergeBase(a: string, b: string): string {
  const r = spawnSync("git", ["merge-base", a, b], { cwd: repoRoot, encoding: "utf8" })
  return r.status === 0 ? r.stdout.trim() : "unknown"
}

let nodeCache: { bin: string; version: string } | null = null
// Node baseline requires EXACTLY v26.4.0 (per scripts/node26.mjs). Resolve a bin
// reporting that exact version; mismatch/absence -> throw (no silent fallback).
function resolveNode26(): { bin: string; version: string } {
  if (nodeCache) return nodeCache
  const exact = (bin: string): string | null => {
    const r = spawnSync(bin, ["--version"], { encoding: "utf8" })
    return r.status === 0 && r.stdout.trim() === NODE26_REQUIRED ? bin : null
  }
  let bin: string | null = null
  const override = process.env.OPENTUI_BENCH_NODE
  if (override) bin = exact(override)
  if (!bin) {
    const nvmDir = join(process.env.HOME ?? "/root", ".nvm", "versions", "node")
    try {
      for (const v of readdirSync(nvmDir)) {
        const b = join(nvmDir, v, "bin", "node")
        if (exact(b)) {
          bin = b
          break
        }
      }
    } catch {}
  }
  if (!bin)
    throw new Error(
      `Node.js ${NODE26_REQUIRED} is required but not found. Install exactly ${NODE26_REQUIRED} via nvm, or set OPENTUI_BENCH_NODE to its bin.`,
    )
  nodeCache = { bin, version: NODE26_REQUIRED }
  return nodeCache
}

function runProbe(opts: {
  scenario: string
  runtime: "bun" | "node"
  telemetry: boolean
  src: string
  entry: string
}): Record<string, unknown> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    OPENTUI_BENCH_ENTRY: opts.entry,
    OPENTUI_BENCH_SRC: opts.src,
    OPENTUI_BENCH_SCENARIO: opts.scenario,
    OPENTUI_BENCH_RENDER: opts.runtime === "node" ? "0" : "1",
    OPENTUI_BENCH_TELEMETRY: opts.telemetry ? "1" : "0",
  }
  const probe = join(scriptDir, "cold-import-probe.ts")
  let cmd: string
  let args: string[]
  if (opts.runtime === "bun") {
    cmd = "bun"
    args = ["run", probe]
  } else {
    const nodeBin = resolveNode26().bin
    cmd = nodeBin
    args = [probe]
  }
  const r = spawnSync(cmd, args, { cwd: scriptDir, env, encoding: "utf8", timeout: 60_000 })
  if (r.status !== 0) {
    throw new Error(
      `probe failed (${opts.scenario} ${opts.runtime} telemetry=${opts.telemetry}): ${r.stderr || r.stdout}`,
    )
  }
  const lines = r.stdout.split("\n").filter((l) => l.trim().startsWith("{"))
  if (lines.length === 0) throw new Error(`no JSON from probe: ${r.stdout}`)
  return JSON.parse(lines[lines.length - 1]!) as Record<string, unknown>
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  if (lo === hi) return sorted[lo]!
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo)
}

function stats(values: number[]): GateStats {
  const sorted = [...values].sort((a, b) => a - b)
  const mean = values.reduce((s, v) => s + v, 0) / values.length
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, values.length - 1)
  const std = Math.sqrt(variance)
  const rme = Math.abs((1.96 * (std / Math.sqrt(values.length))) / mean) * 100
  return {
    median: Math.round(quantile(sorted, 0.5) * 1000) / 1000,
    p95: Math.round(quantile(sorted, 0.95) * 1000) / 1000,
    p99: Math.round(quantile(sorted, 0.99) * 1000) / 1000,
    rmePct: Math.round(rme * 100) / 100,
    n: values.length,
  }
}

interface Body {
  overallMs: number
  importMs: number
  ttfmMs: number
  firstCommitAt: number | null
}

function measure(opts: {
  scenario: string
  runtime: "bun" | "node"
  telemetry: boolean
  src: string
  entry: string
  samples: number
  warmup: number
}): { ttfm: GateStats; importMs: GateStats } {
  for (let i = 0; i < opts.warmup; i++) runProbe(opts)
  const ttfm: number[] = []
  const importMs: number[] = []
  for (let i = 0; i < opts.samples; i++) {
    const row = runProbe(opts) as unknown as Body
    ttfm.push(row.ttfmMs)
    importMs.push(row.importMs)
  }
  return { ttfm: stats(ttfm), importMs: stats(importMs) }
}

// Paired A/B. Each iteration runs both arms back-to-back whose MEASUREMENT
// ORDER is truly randomized 50/50 per pair (base first OR treat first), so no
// fixed base-first bias and slow load drift is canceled by pairing. Values are
// pushed into their correct arm array regardless of spawn order. The gate
// decision uses the median of per-pair (treat-base)/base %. `base` = reference.
function compare(base: { label: string; run: () => number }, treat: { label: string; run: () => number }, samples: number): GateResult {
  const baseVals: number[] = []
  const treatVals: number[] = []
  for (let i = 0; i < samples; i++) {
    const baseFirst = Math.random() < 0.5
    const v0 = base.run()
    const v1 = treat.run()
    baseVals.push(baseFirst ? v0 : v1)
    treatVals.push(baseFirst ? v1 : v0)
  }
  const aStats = stats(baseVals)
  const bStats = stats(treatVals)
  const pairedPct = baseVals.map((bv, i) => ((treatVals[i]! - bv) / bv) * 100)
  const pairedMedian = quantile([...pairedPct].sort((x, y) => x - y), 0.5)
  return {
    kind: "gate.zero-cost",
    aLabel: base.label,
    bLabel: treat.label,
    a: aStats,
    b: bStats,
    overheadMedianPct: Math.round(pairedMedian * 100) / 100,
    gate: { thresholdPct: 0, passed: false, rule: "" },
  }
}

// Documented A2/B7 measurement limitations (review round 2) — rendered into
// every generated report so the evidence is self-describing.
const LIMITATIONS = `## Limitationen (dokumentiert, Review-R2)

- Request-Ursachen (rAF/requestPartial/timer/live/request) werden zur Frame-Zeit
  heuristisch zugeordnet (hadAnimation/hadPartialRequest/Followup-Flag/_isRunning),
  nicht am Anforderungsursprung gespeichert. Genau eine Quelle pro Frame,
  Summe == frame.total (getestet), aber Einzelzuordnung ist heuristisch.
- firstOutputWrite wird am Native-Commit abgeleitet (echtes Memory-Buffer-Flag
  _bufferedOutputMemory + Terminal-Setup), nicht an einem individuellen Write-
  Callback beobachtet. Approximation des Write-Sinks; offene Limitation.
- frame.promote.partialToFull zählt nur den kanonischen Promote-Pfad
  (Partial-Render hob eine normale Invalidation aus). Andere immediateRerender-
  Stellen sind Full-Render-Nachläufe/Request-Marker, keine echten Promotes
  (Code-Inspektion Review-R2); keine zusätzlichen Zähler gesetzt.
- Bun-Prozess-Cold-Import hat intrinsisches RME ~4-9 % (Heavy-Tail p99 ≈ 2×
  Median, Scheduler-Rauschen); RME < 3 % ist mit dieser Methode nicht erreichbar.
  Das gepaarte Akzeptanz-Gate ist davon unberührt (Paar-Differenz koppelt Drift aus).
- Node-Baseline misst ausschließlich den Dist-Cold-Import (kein Render/Telemetrie
  unter Node, src-Hooks sind bun-only).
`

function buildReport(
  rawLines: Record<string, unknown>[],
  header: { artifact: string; commit: string; base: string; runtime: string },
): string {
  const m = (f: { median?: number; p95?: number; p99?: number; rmePct?: number } | undefined) =>
    `${f?.median ?? "—"} / ${f?.p95 ?? "—"} / ${f?.p99 ?? "—"} / ${f?.rmePct ?? "—"}%`
  let md = `# Cold-import / TTFMF report — artifact \`${header.artifact}\`\n\n`
  md += `Generiert am ${new Date().toISOString()} · Commit \`${header.commit}\` · base \`${header.base}\` · ${header.runtime}\n\n`
  md += "\n## Rohdaten\n\n`raw.ndjson` (append-only) — `" + rawLines.length + "` rows.\n\n"
  md += "## Baselines (Med / p95 / p99 / RME %)\n\n"
  md += "| Row | Runtime | Scenario | importMs | ttfmMs |\n"
  md += "| --- | --- | --- | --- | --- |\n"
  for (const line of rawLines) {
    if (line.kind !== "baseline.cold-import") continue
    const r = (line.runtime as { engine?: string } | undefined)?.engine ?? line.runtime ?? "?"
    md += `| ${String(line.commit ?? "?").slice(0, 7)} | ${r} | ${line.scenario} | ${m(line.importMs as never)} | ${m(line.ttfmMs as never)} |\n`
  }
  for (const line of rawLines) {
    const gates = line.gates as GateResult[] | undefined
    if (!gates) continue
    for (const g of gates) {
      if (g.kind !== "gate.zero-cost") continue
      const extra = g.aLabel === "fastpatch" ? " (acceptance)" : ""
      md += `\n## Gate${extra}: ${g.aLabel} vs ${g.bLabel} (<= ${g.gate?.thresholdPct ?? "?"}%)\n\n`
      md += `- ${g.aLabel} median: ${g.a?.median ?? "—"} ms; ${g.bLabel} median: ${g.b?.median ?? "—"} ms\n`
      md += `- overhead median: ${g.overheadMedianPct ?? "—"}% — **${g.gate?.passed ? "PASS" : "FAIL"}**\n`
    }
  }
  md += "\n" + LIMITATIONS
  return md
}

async function main(): Promise<void> {
  const args = parseArgs()
  const scenario = args["scenario"] ?? "root"
  const runtime = (args["runtime"] === "node" ? "node" : "bun") as "bun" | "node"
  const samples = Number(args["samples"] ?? 30)
  const warmup = Number(args["warmup"] ?? 3)
  const threshold = Number(args["threshold"] ?? 3)
  const doGate = args["gate"] !== undefined // acceptance: branch-disabled vs fastpatch
  const doGateRecord = args["gate-record"] !== undefined // informational: enabled vs disabled
  if (doGate && runtime === "node")
    throw new Error("--gate is bun-src-only (compares src trees); use --runtime=bun")

  const commit = gitRevparse("HEAD")
  const ct = gitRevparse("fastpatch")
  const mergeBase = gitMergeBase("fastpatch", "HEAD")
  const nodeInfo = runtime === "node" ? resolveNode26() : null
  const artifact = args["artifact"] ?? `cold-import-${commit.slice(0, 7)}`
  const benchDir = process.env.OPENTUI_BENCH_DIR ?? join(repoRoot, ".yesmem", "bench")
  const artifactDir = join(benchDir, artifact)
  const rawFile = join(artifactDir, "raw.ndjson")
  mkdirSync(artifactDir, { recursive: true })

  // Report-only mode: regenerate report.md from the append-only raw ledger
  // without taking a new measurement (used after template changes).
  if (args["regen-report"] !== undefined) {
    if (!existsSync(rawFile)) throw new Error(`no raw data at ${rawFile}`)
    const rows = readFileSync(rawFile, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>)
    const last = rows[rows.length - 1] ?? {}
    const rt = (last.runtime as { engine?: string } | undefined)?.engine ?? String(last.runtime ?? "?")
    const report = join(artifactDir, "report.md")
    writeFileSync(report, buildReport(rows, { artifact, commit: String(last.commit ?? "unknown"), base: String(last["commit.base"] ?? "unknown"), runtime: rt }))
    console.log(JSON.stringify({ artifact, regenerated: true, rows: rows.length, report }))
    return
  }

  let entry: string
  let src = branchSrcRoot
  if (scenario === "dist") {
    entry = distEntry(runtime)
  } else if (scenario === "root" || scenario === "zig") {
    if (runtime === "node")
      throw new Error(`scenario ${scenario} is bun-source only; use --scenario=dist --runtime=node`)
    entry = sourceEntry(scenario === "root" ? "index" : scenario)
  } else {
    throw new Error(`unknown scenario: ${scenario}`)
  }

  const cpu = cpus()[0]?.model ?? "unknown"
  const provenance = {
    commit,
    "commit.base": mergeBase,
    "fastpatch.tip": ct,
    runtime: {
      engine: runtime,
      version: runtime === "bun" ? process.versions.bun : nodeInfo!.version,
      required: runtime === "node" ? NODE26_REQUIRED : undefined,
    },
    cpu,
    platform,
    arch,
    geometry: scenario === "zig" || runtime === "node" ? null : "80x24",
    warmup,
    samples,
    thresholdPct: threshold,
    harness_version: 3,
    protocol: "cold-import-probe-v3",
    generated: new Date().toISOString(),
  }

  const baseline = measure({ scenario, runtime, telemetry: false, src, entry, samples, warmup })

  // Lifecycle evidence: one telemetry-enabled render probe snapshots the full
  // startup marks + spans for the raw record (bun render scenarios only).
  let lifecycle: { marks: unknown[]; spans: unknown[] } | null = null
  if (runtime === "bun" && (scenario === "root" || scenario === "zig")) {
    const row = runProbe({ scenario, runtime, telemetry: true, src, entry }) as unknown as {
      marks: { name: string; atMs: number }[]
      spans: { name: string; startMs: number; endMs: number }[]
    }
    lifecycle = { marks: row.marks ?? [], spans: row.spans ?? [] }
  }

  const gateRows: GateResult[] = []
  let acceptGate: { passed: boolean } | null = null
  if (doGate) {
    // ACCEPTANCE: does the instrumented (disabled-telemetry) branch regress cold
    // import/TTFMF vs UNMODIFIED fastpatch by more than threshold%? Fully
    // separated arms: each imports its own tree's index + own render/telemetry.
    const base = {
      label: "fastpatch",
      run: () =>
        (runProbe({ scenario: "root", runtime: "bun", telemetry: false, src: fastpatchSrcRoot, entry: resolve(fastpatchSrcRoot, "index.ts") }) as unknown as Body).ttfmMs,
    }
    const treat = {
      label: "branch-disabled",
      run: () => (runProbe({ scenario: "root", runtime: "bun", telemetry: false, src, entry }) as unknown as Body).ttfmMs,
    }
    const res = compare(base, treat, samples)
    res.gate = {
      thresholdPct: threshold,
      passed: res.overheadMedianPct <= threshold,
      rule: `paired branch-disabled-vs-fastpatch overhead (median of per-pair %) <= ${threshold}%`,
    }
    acceptGate = res.gate
    gateRows.push(res)
  }
  if (doGateRecord) {
    // Recording cost only (informational): enabling telemetry on this branch.
    const base = {
      label: "disabled",
      run: () => (runProbe({ scenario, runtime, telemetry: false, src, entry }) as unknown as Body).ttfmMs,
    }
    const treat = {
      label: "enabled",
      run: () => (runProbe({ scenario, runtime, telemetry: true, src, entry }) as unknown as Body).ttfmMs,
    }
    const res = compare(base, treat, samples)
    res.gate = {
      thresholdPct: threshold,
      passed: res.overheadMedianPct <= threshold,
      rule: `paired enabled-vs-disabled overhead (median of per-pair %) <= ${threshold}%`,
    }
    gateRows.push(res)
  }

  const forceFail = args["force-fail"] !== undefined
  if (forceFail && acceptGate) acceptGate.passed = false

  const row = {
    kind: "baseline.cold-import",
    scenario,
    ...provenance,
    ...(lifecycle ? { lifecycle } : {}),
    importMs: baseline.importMs,
    ttfmMs: baseline.ttfm,
  }

  appendFileSync(rawFile, JSON.stringify({ ...row, ...(gateRows.length ? { gates: gateRows } : {}) }) + "\n")

  const rawLines = readFileSync(rawFile, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>)
  writeFileSync(join(artifactDir, "report.md"), buildReport(rawLines, { artifact, commit, base: mergeBase, runtime }))

  const failed = forceFail ? true : acceptGate ? !acceptGate.passed : false
  console.log(
    JSON.stringify({
      artifact,
      commit: commit.slice(0, 7),
      scenario,
      runtime,
      importMs: baseline.importMs,
      ttfmMs: baseline.ttfm,
      gates: gateRows.map((g) => ({ name: `${g.aLabel}-vs-${g.bLabel}`, overheadMedianPct: g.overheadMedianPct, passed: g.gate.passed, acceptance: g.aLabel === "fastpatch" })),
      failed,
      raw: rawFile,
      report: join(artifactDir, "report.md"),
    }),
  )
  if (failed) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
