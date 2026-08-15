// A1/A4 harness: cold-import + time-to-first-frame measurement.
//
// Spawns a fresh cold-import-probe child process per sample (real cold import),
// aggregates median/p95/p99/RME, appends a provenance row to
// <worktree>/.yesmem/bench/<artifact>/raw.ndjson (append-only), then
// regenerates <artifact>/report.md from that raw file (never hand-edited).
//
// --gate: additionally runs the same measurement with telemetry enabled and
// asserts the enabled path is <= 3% slower than disabled (Go-Gate Serie A).
//
// Options:
//   --scenario=root|minimal|zig   (default root)
//   --samples=N  (default 9)   --warmup=N (default 2)
//   --artifact=<name> (default "cold-import-<commit>")
//   --gate       enable zero-cost gate comparison (alternating A/B order)
//   --outdir=<repo>/<path> where the artifact lives (default fallback)
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { cpus, platform, arch } from "node:os"
import { join, dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, "..", "..", "..")
const entryByScenario: Record<string, string> = {
  root: resolve(scriptDir, "..", "src", "index.ts"),
  minimal: resolve(scriptDir, "..", "src", "renderer.ts"),
  zig: resolve(scriptDir, "..", "src", "zig.ts"),
}

interface GateStats {
  median: number
  p95: number
  p99: number
  rmePct: number
  n: number
}
interface GateRow {
  kind: string
  disabled: GateStats
  enabled: GateStats
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

function runProbe(opts: { scenario: string; telemetry: boolean }): Record<string, unknown> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    OPENTUI_BENCH_ENTRY: entryByScenario[opts.scenario]!,
    OPENTUI_BENCH_SCENARIO: opts.scenario,
    OPENTUI_BENCH_RENDER: opts.scenario === "zig" ? "0" : "1",
    OPENTUI_BENCH_TELEMETRY: opts.telemetry ? "1" : "0",
  }
  const r = spawnSync("bun", ["run", join(scriptDir, "cold-import-probe.ts")], {
    cwd: scriptDir,
    env,
    encoding: "utf8",
    timeout: 60_000,
  })
  if (r.status !== 0) {
    throw new Error(`probe failed (${opts.scenario} telemetry=${opts.telemetry}): ${r.stderr || r.stdout}`)
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
  const median = quantile(sorted, 0.5)
  const rme = Math.abs((1.96 * (std / Math.sqrt(values.length))) / mean) * 100
  return {
    median: Math.round(median * 1000) / 1000,
    p95: Math.round(quantile(sorted, 0.95) * 1000) / 1000,
    p99: Math.round(quantile(sorted, 0.99) * 1000) / 1000,
    rmePct: Math.round(rme * 100) / 100,
    n: values.length,
  }
}

function measure(opts: { scenario: string; telemetry: boolean; samples: number; warmup: number }): {
  overall: ReturnType<typeof stats>
  importMs: ReturnType<typeof stats>
} {
  for (let i = 0; i < opts.warmup; i++) runProbe({ scenario: opts.scenario, telemetry: opts.telemetry })
  const overall: number[] = []
  const importMs: number[] = []
  for (let i = 0; i < opts.samples; i++) {
    const row = runProbe({ scenario: opts.scenario, telemetry: opts.telemetry }) as {
      overallMs: number
      importMs: number
    }
    overall.push(row.overallMs)
    importMs.push(row.importMs)
  }
  return { overall: stats(overall), importMs: stats(importMs) }
}

async function main(): Promise<void> {
  const args = parseArgs()
  const scenario = args["scenario"] ?? "root"
  if (!entryByScenario[scenario]) throw new Error(`unknown scenario: ${scenario}`)
  const samples = Number(args["samples"] ?? 9)
  const warmup = Number(args["warmup"] ?? 2)
  const doGate = args["gate"] !== undefined
  const commit = gitRevparse("HEAD")
  const restartBase = gitRevparse("ORIG_HEAD") === "unknown" ? commit : commit
  const artifact = args["artifact"] ?? `cold-import-${commit.slice(0, 7)}`
  const benchDir = process.env.OPENTUI_BENCH_DIR ?? join(repoRoot, ".yesmem", "bench")
  const artifactDir = join(benchDir, artifact)
  const rawFile = join(artifactDir, "raw.ndjson")
  mkdirSync(artifactDir, { recursive: true })

  const cpu = cpus()[0]?.model ?? "unknown"
  const provenance = {
    commit,
    "commit.base": restartBase,
    runtime: { engine: "bun", version: process.versions.bun },
    cpu,
    platform,
    arch,
    geometry: scenario === "zig" ? null : "80x24",
    warmup,
    samples,
    harness_version: 1,
    protocol: "cold-import-probe-v1",
    generated: new Date().toISOString(),
  }

  const baseline = measure({ scenario, telemetry: false, samples, warmup })

  let gateRow: GateRow | null = null
  let gatePassed: boolean | null = null
  if (doGate) {
    // Alternating A/B order: interleave enabled/disabled runs to spread drift.
    const enabledValues: number[] = []
    const disabledValues: number[] = []
    for (let i = 0; i < samples; i++) {
      disabledValues.push((runProbe({ scenario, telemetry: false }) as { overallMs: number }).overallMs)
      enabledValues.push((runProbe({ scenario, telemetry: true }) as { overallMs: number }).overallMs)
    }
    const disabled = stats(disabledValues)
    const enabled = stats(enabledValues)
    const overheadPct = (enabled.median / disabled.median - 1) * 100
    gatePassed = overheadPct <= 3
    gateRow = {
      kind: "gate.zero-cost",
      disabled,
      enabled,
      overheadMedianPct: Math.round(overheadPct * 100) / 100,
      gate: { thresholdPct: 3, passed: gatePassed, rule: "enabled median <= disabled median * 1.03" },
    }
  }

  const row = {
    kind: "baseline.cold-import",
    scenario,
    ...provenance,
    importMs: baseline.importMs,
    overallMs: baseline.overall,
  }

  appendFileSync(rawFile, JSON.stringify({ ...row, ...(gateRow ? { gate: gateRow } : {}) }) + "\n")

  // Regenerate report from the raw file (single source of truth).
  const rawLines = readFileSync(rawFile, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
  let md = `# Cold-import / TTFMF report — artifact \`${artifact}\`\n\n`
  md += `Generiert am ${provenance.generated} · Commit \`${commit}\` · Bun ${provenance.runtime.version} · CPU \`${cpu}\`\n\n`
  md += "\n## Rohdaten\n\n`raw.ndjson` (append-only) — `" + rawLines.length + "` rows.\n\n"
  md += "## Baselines (Median / p95 / p99 / RME %)\n\n"
  md += "| Row | Scenario | importMs.med | importMs.p95 | overallMs.med | overallMs.p95 | overallMs.p99 | RME% |\n"
  md += "| --- | --- | --- | --- | --- | --- | --- | --- |\n"
  for (const line of rawLines) {
    if (line.kind !== "baseline.cold-import") continue
    md += `| ${line.commit.slice(0, 7)} | ${line.scenario} | ${line.importMs.median} | ${line.importMs.p95} | ${line.overallMs.median} | ${line.overallMs.p95} | ${line.overallMs.p99} | ${line.overallMs.rmePct} |\n`
  }
  if (gateRow) {
    const g = gateRow
    md += `\n## Go-Gate (disablierte Telemetrie <= ${g.gate.thresholdPct}%)\n\n`
    md += `- disabled median: ${g.disabled.median} ms; enabled median: ${g.enabled.median} ms\n`
    md += `- overhead median: ${g.overheadMedianPct}% — **${g.gate.passed ? "PASS" : "FAIL"}**\n`
  }
  writeFileSync(join(artifactDir, "report.md"), md)

  console.log(
    JSON.stringify({
      artifact,
      commit: commit.slice(0, 7),
      scenario,
      importMs: baseline.importMs,
      overallMs: baseline.overall,
      gate: gateRow ? { overheadMedianPct: gateRow.overheadMedianPct, passed: gatePassed } : null,
      raw: rawFile,
      report: join(artifactDir, "report.md"),
    }),
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
