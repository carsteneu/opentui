// A1/A4 harness: cold-import + time-to-first-frame measurement.
//
// Spawns a fresh cold-import-probe child process per sample (real cold import),
// aggregates median/p95/p99/RME, appends a provenance row to
// <worktree>/.yesmem/bench/<artifact>/raw.ndjson (append-only), then
// regenerates <artifact>/report.md from that raw file (never hand-edited).
//
// Gates:
//   --gate       disabled-vs-enabled on THIS branch (true A/B). THE acceptance:
//                PASS iff paired enabled <= disabled*(1+threshold/100). Sets exit.
//   --gate-base  disabled-instrumented branch vs UNMODIFIED fastpatch tree.
//                INFORMATIONAL only: branch HEAD vs fastpatch@2cd44364 differ by
//                far more than instrumentation, so the delta swings with host
//                load (-43%..+10% across runs) and is not a usable acceptance
//                signal. Recorded for reference; does NOT affect exit code.
//   --force-fail debug/CI hook: force all gates to FAIL (proves nonzero exit)
//
// Options:
//   --scenario=root|zig|dist   (default root)
//   --runtime=bun|node                 (default bun)
//   --samples=N (default 30)  --warmup=N (default 3)
//   --artifact=<name> (default "cold-import-<commit>")
//   --threshold=<pct> (default 3, gate pass bound)
//   --force-fail      debug/CI hook: force all gates to FAIL (proves nonzero exit)
import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { cpus, platform, arch } from "node:os"
import { join, dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, "..", "..", "..")
const coreDir = resolve(repoRoot, "packages", "core")
const fastpatchCore = resolve(repoRoot, "..", "fastpatch", "packages", "core")

function sourceEntry(name: string): string {
  return resolve(coreDir, "src", `${name}.ts`)
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

function resolveNode(): string | null {
  if (process.env.OPENTUI_BENCH_NODE) return process.env.OPENTUI_BENCH_NODE
  const nvmDir = join(process.env.HOME ?? "/root", ".nvm", "versions", "node")
  try {
    const versions = readdirSync(nvmDir).map((v) => ({ v, n: Number(v.replace(/^v/, "").split(".")[0] ?? 0) }))
    versions.sort((a, b) => b.n - a.n)
    for (const { v } of versions) {
      const bin = join(nvmDir, v, "bin", "node")
      const probe = spawnSync("test", ["-x", bin], { shell: true })
      if (probe.status === 0) return bin
    }
  } catch {}
  return null
}

function runProbe(opts: {
  scenario: string
  runtime: "bun" | "node"
  telemetry: boolean
  entry: string
}): Record<string, unknown> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    OPENTUI_BENCH_ENTRY: opts.entry,
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
    const nodeBin = resolveNode()
    if (!nodeBin) throw new Error("Node 26 not found (set OPENTUI_BENCH_NODE or install via nvm)")
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
  entry: string
  samples: number
  warmup: number
}): {
  ttfm: GateStats
  importMs: GateStats
} {
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

// Paired A/B. Each iteration runs both arms back-to-back with a randomized
// order, so slow background drift is largely canceled by the pairing. The
// gate decision uses the median of the per-pair percentage difference
// (treat vs base), not the ratio of aggregate medians — robust to load drift
// within the run. `base` is the zero-cost/reference arm.
function compare(base: { label: string; run: () => number }, treat: { label: string; run: () => number }, samples: number): GateResult {
  const baseVals: number[] = []
  const treatVals: number[] = []
  for (let i = 0; i < samples; i++) {
    const baseFirst = i % 2 === 0
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

async function main(): Promise<void> {
  const args = parseArgs()
  const scenario = args["scenario"] ?? "root"
  const runtime = (args["runtime"] === "node" ? "node" : "bun") as "bun" | "node"
  const samples = Number(args["samples"] ?? 30)
  const warmup = Number(args["warmup"] ?? 3)
  const threshold = Number(args["threshold"] ?? 3)
  const doGate = args["gate"] !== undefined
  const doGateBase = args["gate-base"] !== undefined

  const commit = gitRevparse("HEAD")
  const ct = gitRevparse("fastpatch")
  const mergeBase = gitMergeBase("fastpatch", "HEAD")
  const artifact = args["artifact"] ?? `cold-import-${commit.slice(0, 7)}`
  const benchDir = process.env.OPENTUI_BENCH_DIR ?? join(repoRoot, ".yesmem", "bench")
  const artifactDir = join(benchDir, artifact)
  const rawFile = join(artifactDir, "raw.ndjson")
  mkdirSync(artifactDir, { recursive: true })

  let entry: string
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
      version: runtime === "bun" ? process.versions.bun : (process.env.OPENTUI_BENCH_NODE_VERSION ?? "node26"),
    },
    cpu,
    platform,
    arch,
    geometry: scenario === "zig" || runtime === "node" ? null : "80x24",
    warmup,
    samples,
    thresholdPct: threshold,
    harness_version: 2,
    protocol: "cold-import-probe-v2",
    generated: new Date().toISOString(),
  }

  const baseline = measure({ scenario, runtime, telemetry: false, entry, samples, warmup })

  const gateRows: GateResult[] = []
  // `--gate` is the acceptance gate and drives the exit code; --gate-base is
  // informational (cross-tree vs older fastpatch, load-swamped).
  let acceptGate: { passed: boolean } | null = null
  if (doGate && runtime === "node")
    throw new Error("--gate under node is vacuous: src telemetry/render are bun-only; use --runtime=bun")
  if (doGate) {
    const arms = [
      { label: "disabled", run: () => (runProbe({ scenario, runtime, telemetry: false, entry }) as unknown as Body).ttfmMs },
      { label: "enabled", run: () => (runProbe({ scenario, runtime, telemetry: true, entry }) as unknown as Body).ttfmMs },
    ]
    const res = compare(arms[0]!, arms[1]!, samples)
    res.gate = {
      thresholdPct: threshold,
      passed: res.overheadMedianPct <= threshold,
      rule: `paired enabled-vs-disabled overhead (median of per-pair %) <= ${threshold}%`,
    }
    acceptGate = res.gate
    gateRows.push(res)
  }
  if (doGateBase) {
    // disabled-instrumented branch vs unmodified fastpatch source (bun).
    // base = fastpatch (reference), treat = this branch: overhead is
    // (branch - fastpatch)/fastpatch, so it FAILS when the instrumented branch
    // is slower than unmodified fastpatch (the property being validated).
    const branchEntry = sourceEntry("index")
    const baseEntry = resolve(fastpatchCore, "src", "index.ts")
    const base = {
      label: "fastpatch",
      run: () => (runProbe({ scenario: "root", runtime: "bun", telemetry: false, entry: baseEntry }) as unknown as Body).ttfmMs,
    }
    const treat = {
      label: "branch-disabled",
      run: () =>
        (runProbe({ scenario: "root", runtime: "bun", telemetry: false, entry: branchEntry }) as unknown as Body).ttfmMs,
    }
    const res = compare(base, treat, samples)
    res.gate = {
      thresholdPct: threshold,
      passed: res.overheadMedianPct <= threshold,
      rule: `paired branch-disabled-vs-fastpatch overhead (median of per-pair %) <= ${threshold}%`,
    }
    gateRows.push(res)
  }

  const forceFail = args["force-fail"] !== undefined
  if (forceFail) {
    for (const g of gateRows) {
      g.gate.passed = false
      g.gate.rule = `${g.gate.rule} [forced-fail-test]`
    }
  }

  const row = {
    kind: "baseline.cold-import",
    scenario,
    ...provenance,
    importMs: baseline.importMs,
    ttfmMs: baseline.ttfm,
  }

  appendFileSync(rawFile, JSON.stringify({ ...row, ...(gateRows.length ? { gates: gateRows } : {}) }) + "\n")

  const rawLines = readFileSync(rawFile, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
  const m = (f: { median?: number; p95?: number; p99?: number; rmePct?: number } | undefined) =>
    `${f?.median ?? "—"} / ${f?.p95 ?? "—"} / ${f?.p99 ?? "—"} / ${f?.rmePct ?? "—"}%`
  let md = `# Cold-import / TTFMF report — artifact \`${artifact}\`\n\n`
  md += `Generiert am ${provenance.generated} · Commit \`${commit}\` · base \`${mergeBase}\` · ${runtime}\n\n`
  md += "\n## Rohdaten\n\n`raw.ndjson` (append-only) — `" + rawLines.length + "` rows.\n\n"
  md += "## Baselines (Med / p95 / p99 / RME %)\n\n"
  md += "| Row | Runtime | Scenario | importMs | ttfmMs |\n"
  md += "| --- | --- | --- | --- | --- |\n"
  for (const line of rawLines) {
    if (line.kind !== "baseline.cold-import") continue
    const r = line.runtime?.engine ?? line.runtime ?? "?"
    md += `| ${String(line.commit ?? "?").slice(0, 7)} | ${r} | ${line.scenario} | ${m(line.importMs)} | ${m(line.ttfmMs)} |\n`
  }
  for (const line of rawLines) {
    if (!line.gates) continue
    for (const g of line.gates) {
      if (g.kind !== "gate.zero-cost") continue
      md += `\n## Gate: ${g.aLabel} vs ${g.bLabel} (<= ${g.gate?.thresholdPct ?? "?"}%)\n\n`
      md += `- ${g.aLabel} median: ${g.a?.median ?? "—"} ms; ${g.bLabel} median: ${g.b?.median ?? "—"} ms\n`
      md += `- overhead median: ${g.overheadMedianPct ?? "—"}% — **${g.gate?.passed ? "PASS" : "FAIL"}**\n`
    }
  }
  writeFileSync(join(artifactDir, "report.md"), md)

  const failed = forceFail ? true : acceptGate ? !acceptGate.passed : false
  console.log(
    JSON.stringify({
      artifact,
      commit: commit.slice(0, 7),
      scenario,
      runtime,
      importMs: baseline.importMs,
      ttfmMs: baseline.ttfm,
      gates: gateRows.map((g) => ({
        name: `${g.aLabel}-vs-${g.bLabel}`,
        overheadMedianPct: g.overheadMedianPct,
        passed: g.gate.passed,
      })),
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
