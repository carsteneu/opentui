import { createHash } from "node:crypto"
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { isAbsolute, join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { pathToFileURL } from "node:url"
import { createPairedSchedule, type PairedOrder } from "../src/benchmark/ffi-fast-path-paired-analysis.js"

export const WAVE3_STARTUP_GATE_SCHEMA_VERSION = 1
const RESULT_PREFIX = "WAVE3_STARTUP_RESULT "

export interface StartupProbeResult {
  schemaVersion: number
  role: "baseline" | "candidate"
  root: string
  revision: string
  scenario: string
  runtime: { bun: string; node: string }
  nativeSha256: string
  importMs: number
  ttfmMs: number | null
  nativeLoadedMs: number | null
  correct: boolean
}

export interface StartupPair {
  pair: number
  order: PairedOrder
  gapMs: number
  baseline: StartupProbeResult
  candidate: StartupProbeResult
}

function mulberry32(initialSeed: number): () => number {
  let seed = initialSeed >>> 0
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function percentile(sortedValues: readonly number[], probability: number): number {
  const index = (sortedValues.length - 1) * probability
  const lower = Math.floor(index)
  const fraction = index - lower
  return (
    sortedValues[lower]! +
    (sortedValues[Math.min(lower + 1, sortedValues.length - 1)]! - sortedValues[lower]!) * fraction
  )
}

export function summarize(values: readonly number[]) {
  if (values.length === 0) throw new Error("cannot summarize an empty sample")
  const sorted = [...values].sort((left, right) => left - right)
  return { n: sorted.length, p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95), p99: percentile(sorted, 0.99) }
}

export function parseStartupProbeOutput(output: string, expected: {
  role: StartupProbeResult["role"]
  root: string
  revision: string
  scenario: string
  nativeSha256: string
}): StartupProbeResult {
  const line = output.split(/\r?\n/).findLast((l) => l.startsWith(RESULT_PREFIX))
  if (!line) throw new Error("startup probe output is missing WAVE3_STARTUP_RESULT")
  const result = JSON.parse(line.slice(RESULT_PREFIX.length)) as StartupProbeResult
  if (result.schemaVersion !== WAVE3_STARTUP_GATE_SCHEMA_VERSION) throw new Error("startup probe schema mismatch")
  for (const key of ["role", "root", "revision", "scenario", "nativeSha256"] as const) {
    if (result[key] !== expected[key]) throw new Error(`startup probe ${key} mismatch: ${result[key]} != ${expected[key]}`)
  }
  if (!result.correct) throw new Error("startup probe did not produce a valid TTFMF")
  if (!Number.isFinite(result.importMs) || result.importMs < 0) throw new Error("invalid importMs")
  if (!Number.isFinite(result.ttfmMs!) || result.ttfmMs! < 0) throw new Error("invalid ttfmMs")
  return result
}

export function buildStartupPairs(rows: readonly StartupPair[]): StartupPair[] {
  for (const row of rows) {
    for (const [name, sample] of [["baseline", row.baseline], ["candidate", row.candidate]] as const) {
      if (!sample.correct) throw new Error(`${row.pair} ${name} startup probe not correct`)
    }
  }
  return rows.map((row) => ({ ...row }))
}

/**
 * Paired bootstrap of the candidate/baseline ratio at a given quantile q,
 * stratified by execution order to cancel the second-position effect. Returns
 * the point estimate and CI of the relative change (candidate - baseline).
 */
export function quantileChangeBootstrap(
  pairs: readonly { order: PairedOrder; baseline: number; candidate: number }[],
  q: number,
  bootstrapSamples: number,
  confidence: number,
  seed: number,
): { change: number; ci: { lower: number; upper: number } } {
  const orderValues = (order: PairedOrder) => pairs.filter((p) => p.order === order)
  const baselineFirst = orderValues("baseline-first")
  const candidateFirst = orderValues("candidate-first")
  if (baselineFirst.length === 0 || candidateFirst.length === 0) {
    throw new Error("startup quantile bootstrap requires both execution orders")
  }
  const all = pairs
  const point = ratioAtQuantile(all, q)

  const random = mulberry32(seed)
  const samples = new Array<number>(bootstrapSamples)
  for (let b = 0; b < bootstrapSamples; b++) {
    const resampled = [
      ...resample(baselineFirst, random),
      ...resample(candidateFirst, random),
    ]
    samples[b] = ratioAtQuantile(resampled, q)
  }
  samples.sort((a, b) => a - b)
  const tail = (1 - confidence) / 2
  const familywiseTail = (1 - (1 - confidence) / 2)
  return {
    change: point,
    ci: { lower: percentile(samples, tail), upper: percentile(samples, familywiseTail) },
  }
}

function ratioAtQuantile(pairs: readonly { baseline: number; candidate: number }[], q: number): number {
  const baseline = pairs.map((p) => p.baseline)
  const candidate = pairs.map((p) => p.candidate)
  baseline.sort((a, b) => a - b)
  candidate.sort((a, b) => a - b)
  return percentile(candidate, q) / percentile(baseline, q) - 1
}

function resample<T>(source: readonly T[], random: () => number): T[] {
  const out = new Array<T>(source.length)
  for (let i = 0; i < source.length; i++) out[i] = source[Math.floor(random() * source.length)]!
  return out
}

export interface MetricBudgetResult {
  p50: number
  p95: number
  p99: number
}

export interface StartupGateInput {
  hostLoadExceeded: boolean
  enoughPairs: boolean
  importMs: MetricBudgetResult
  ttfmMs: MetricBudgetResult
  familywiseMaxRegression: number
  familywiseMaxRegressionP99: number
}

export type StartupGateVerdict = "PASS" | "FAIL" | "UNCLEAR"

export function classifyStartupGate(input: StartupGateInput): StartupGateVerdict {
  if (input.hostLoadExceeded) return "UNCLEAR"
  if (!input.enoughPairs) return "FAIL"
  const metrics = [input.importMs, input.ttfmMs]
  for (const m of metrics) {
    if (m.p50 > input.familywiseMaxRegression || m.p95 > input.familywiseMaxRegression) return "FAIL"
    if (m.p99 > input.familywiseMaxRegressionP99) return "FAIL"
  }
  return "PASS"
}

// ---- runner ----

function optionalArg(name: string): string | undefined {
  const prefix = `--${name}=`
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length)
}

function requiredRoot(name: string): string {
  const value = optionalArg(name)
  if (!value) throw new Error(`--${name} is required`)
  if (!isAbsolute(value)) throw new Error(`--${name} must be absolute`)
  return resolve(value)
}

function intArg(name: string, fallback: number, minimum: number): number {
  const parsed = Number(optionalArg(name) ?? fallback)
  if (!Number.isInteger(parsed) || parsed < minimum) throw new Error(`--${name} must be an integer >= ${minimum}`)
  return parsed
}

function numberArg(name: string, fallback: number, minimum: number): number {
  const parsed = Number(optionalArg(name) ?? fallback)
  if (!Number.isFinite(parsed) || parsed < minimum) throw new Error(`--${name} must be a number >= ${minimum}`)
  return parsed
}

function run(root: string, command: string, args: string[]): string {
  const child = spawnSync(command, args, { cwd: root, encoding: "utf8", env: { ...process.env, OTUI_ASSET_ROOT: "" } })
  if (child.error) throw child.error
  if (child.status !== 0) throw new Error(`${command} ${args.join(" ")} failed in ${root}:\n${child.stderr}\n${child.stdout}`)
  return child.stdout.trim()
}

function git(root: string, args: string[]): string {
  return run(root, "git", args)
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

function nativeArtifact(root: string): string {
  const target = `${process.platform}-${process.arch}`
  const libc = process.env.OPENTUI_LIBC === "musl" ? "-musl" : ""
  const filename = process.platform === "win32" ? "libopentui.dll" : process.platform === "darwin" ? "libopentui.dylib" : "libopentui.so"
  const path = join(root, "packages/core/node_modules", `@opentui/core-${target}${libc}`, filename)
  if (!existsSyncSafe(path)) throw new Error(`missing native artifact: ${path}`)
  return path
}

function existsSyncSafe(path: string): boolean {
  try {
    readFileSync(path)
    return true
  } catch {
    return false
  }
}

function hostLoad(): { one: number; five: number; fifteen: number } {
  const [one, five, fifteen] = readFileSync("/proc/loadavg", "utf8").trim().split(/\s+/).map(Number)
  return { one: one!, five: five!, fifteen: fifteen! }
}

function otherBunProcesses(): string[] {
  const child = spawnSync("ps", ["-C", "bun", "-o", "pid=,args="], { encoding: "utf8" })
  if (child.error) throw child.error
  if (child.status !== 0 && child.status !== 1) throw new Error(`ps -C bun failed: ${child.stderr}`)
  return child.stdout.trim().split(/\r?\n/).filter(Boolean).filter((l) => Number(l.trim().split(/\s+/, 1)[0]) !== process.pid)
}

function formatMs(value: number): string {
  return `${value.toFixed(3)} ms`
}

function formatPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`
}

async function main(): Promise<void> {
  const baselineRoot = requiredRoot("baseline-root")
  const candidateRoot = requiredRoot("candidate-root")
  if (baselineRoot === candidateRoot) throw new Error("baseline and candidate roots must differ")
  const baselineRevision = optionalArg("baseline-revision") ?? "fccae2158d5c98949fc050913b918621af918111"
  const candidateRevision = optionalArg("candidate-revision")
  if (!candidateRevision) throw new Error("--candidate-revision is required")
  const pairs = intArg("pairs", 30, 2)
  if (pairs % 2 !== 0) throw new Error("--pairs must be even")
  const warmups = intArg("warmups", 3, 0)
  const maximumLoad = numberArg("max-load", 4, 0)
  const bootstrap = intArg("bootstrap", 20000, 1000)
  const maxRegression = numberArg("threshold", 0.03, 0)
  const maxRegressionP99 = numberArg("threshold-p99", 0.05, 0)
  const outputDir = resolve(optionalArg("output-dir") ?? join(process.cwd(), ".yesmem/bench/wave3-final-cpu"))
  const probePath = join(import.meta.dir, "wave3-startup-probe.ts")

  const baselineHead = git(baselineRoot, ["rev-parse", "HEAD"])
  const candidateHead = git(candidateRoot, ["rev-parse", "HEAD"])
  if (!baselineHead.startsWith(baselineRevision)) throw new Error(`baseline revision mismatch: ${baselineHead}`)
  if (!candidateHead.startsWith(candidateRevision)) throw new Error(`candidate revision mismatch: ${candidateHead}`)

  const baselineNative = nativeArtifact(baselineRoot)
  const candidateNative = nativeArtifact(candidateRoot)
  const baselineSha = sha256File(baselineNative)
  const candidateSha = sha256File(candidateNative)
  if (baselineSha === candidateSha) throw new Error(`per-arm native policy violated: same SHA ${baselineSha}`)

  const baselineSrc = join(baselineRoot, "packages/core/src")
  const candidateSrc = join(candidateRoot, "packages/core/src")
  const baselineEntry = pathToFileURL(join(baselineSrc, "renderer-entry.ts")).href
  const candidateEntry = pathToFileURL(join(candidateSrc, "renderer-entry.ts")).href

  const startLoad = hostLoad()
  const hostLoadExceeded = startLoad.one > maximumLoad

  mkdirSync(outputDir, { recursive: true })
  const rawPath = join(outputDir, "startup-raw.ndjson")
  const reportPath = join(outputDir, "startup-report.md")
  const appendRaw = (v: unknown) => appendFileSync(rawPath, `${JSON.stringify(v)}\n`)
  appendRaw({ kind: "header", schemaVersion: WAVE3_STARTUP_GATE_SCHEMA_VERSION, date: new Date().toISOString(), baseline: { root: baselineRoot, revision: baselineHead, nativeSha256: baselineSha }, candidate: { root: candidateRoot, revision: candidateHead, nativeSha256: candidateSha }, bun: Bun.version, pairs, warmups, bootstrap, startLoad, hostLoadExceeded })

  const runProbe = (role: "baseline" | "candidate", root: string, revision: string, entry: string, src: string, nativePath: string, nativeSha: string): StartupProbeResult => {
    const child = spawnSync(
      process.execPath,
      [
        probePath,
        `--root=${root}`,
        `--role=${role}`,
        `--revision=${revision}`,
        `--scenario=renderer-entry`,
        `--native-path=${nativePath}`,
        `--native-sha=${nativeSha}`,
        `--entry=${entry}`,
        `--src=${src}`,
      ],
      { cwd: root, encoding: "utf8", timeout: 120_000, env: { ...process.env, OTUI_ASSET_ROOT: "" } },
    )
    if (child.error) throw child.error
    if (child.status !== 0) throw new Error(`startup probe failed (${role}):\n${child.stderr}\n${child.stdout}`)
    return parseStartupProbeOutput(child.stdout, { role, root, revision, scenario: "renderer-entry", nativeSha256: nativeSha })
  }

  for (let warmup = 0; warmup < warmups; warmup++) {
    const order: ("baseline" | "candidate")[] = warmup % 2 === 0 ? ["baseline", "candidate"] : ["candidate", "baseline"]
    for (const role of order) {
      runProbe(role, role === "baseline" ? baselineRoot : candidateRoot, role === "baseline" ? baselineHead : candidateHead, role === "baseline" ? baselineEntry : candidateEntry, role === "baseline" ? baselineSrc : candidateSrc, role === "baseline" ? baselineNative : candidateNative, role === "baseline" ? baselineSha : candidateSha)
    }
  }

  const schedule = createPairedSchedule(["cold-import"], ["bun"], pairs, 0x517a17)
  const rows: StartupPair[] = []
  for (const entry of schedule) {
    const order: ("baseline" | "candidate")[] = entry.order === "baseline-first" ? ["baseline", "candidate"] : ["candidate", "baseline"]
    const samples = {} as Record<"baseline" | "candidate", StartupProbeResult>
    let firstEnd = 0
    let secondStart = 0
    for (let i = 0; i < order.length; i++) {
      const role = order[i]!
      if (i === 1) secondStart = performance.now()
      samples[role] = runProbe(role, role === "baseline" ? baselineRoot : candidateRoot, role === "baseline" ? baselineHead : candidateHead, role === "baseline" ? baselineEntry : candidateEntry, role === "baseline" ? baselineSrc : candidateSrc, role === "baseline" ? baselineNative : candidateNative, role === "baseline" ? baselineSha : candidateSha)
      if (i === 0) firstEnd = performance.now()
    }
    const row: StartupPair = { pair: entry.pair, order: entry.order, gapMs: Math.max(0, secondStart - firstEnd), baseline: samples.baseline, candidate: samples.candidate }
    rows.push(row)
    appendRaw({ kind: "pair", ...row })
  }
  const validated = buildStartupPairs(rows)
  const endLoad = hostLoad()
  const enoughPairs = validated.length >= 10

  const metricBudget = (pairsList: readonly StartupPair[], metric: "importMs" | "ttfmMs") => {
    const obs = pairsList.map((p) => ({ order: p.order, baseline: p.baseline[metric]!, candidate: p.candidate[metric]! }))
    const p50 = quantileChangeBootstrap(obs, 0.5, bootstrap, 0.95, 0xa1 + metric.length)
    const p95 = quantileChangeBootstrap(obs, 0.95, bootstrap, 0.95, 0xb2 + metric.length)
    const p99 = quantileChangeBootstrap(obs, 0.99, bootstrap, 0.95, 0xc3 + metric.length)
    return {
      p50: { change: p50.change, ci: p50.ci },
      p95: { change: p95.change, ci: p95.ci },
      p99: { change: p99.change, ci: p99.ci },
      budget: { p50: p50.ci.upper, p95: p95.ci.upper, p99: p99.ci.upper },
    }
  }

  const importMs = metricBudget(validated, "importMs")
  const ttfmMs = metricBudget(validated, "ttfmMs")
  const baselineImport = summarize(validated.map((p) => p.baseline.importMs))
  const candidateImport = summarize(validated.map((p) => p.candidate.importMs))
  const baselineTtfm = summarize(validated.map((p) => p.baseline.ttfmMs!))
  const candidateTtfm = summarize(validated.map((p) => p.candidate.ttfmMs!))

  const verdict = classifyStartupGate({
    hostLoadExceeded,
    enoughPairs,
    importMs: { p50: importMs.p50.ci.upper, p95: importMs.p95.ci.upper, p99: importMs.p99.ci.upper },
    ttfmMs: { p50: ttfmMs.p50.ci.upper, p95: ttfmMs.p95.ci.upper, p99: ttfmMs.p99.ci.upper },
    familywiseMaxRegression: maxRegression,
    familywiseMaxRegressionP99: maxRegressionP99,
  })

  const report: string[] = []
  report.push("# Wave 3 Startup-Safety Gate (Loop B, per-arm native)")
  report.push("")
  report.push(`- generated: ${new Date().toISOString()}`)
  report.push(`- baseline: \`${baselineHead}\` (${baselineRoot}), native \`${baselineSha}\``)
  report.push(`- candidate: \`${candidateHead}\` (${candidateRoot}), native \`${candidateSha}\``)
  report.push(`- scenario: renderer-entry → renderer-entry; import + TTFMF (first native commit)`)
  report.push(`- Bun: ${Bun.version}; protocol: ${validated.length} balanced pairs, ${warmups} warmups, ${bootstrap} bootstrap samples`)
  report.push(`- load: start ${startLoad.one}/${startLoad.five}/${startLoad.fifteen}; end ${endLoad.one}/${endLoad.five}/${endLoad.fifteen}; hostLoadExceeded=${hostLoadExceeded}`)
  report.push("")
  report.push("| Metric | Baseline p50/p95/p99 | Candidate p50/p95/p99 | Paired p50 (CI) | p95 (CI) | p99 (CI) | p50/p95 budget (≤+3%) | p99 budget (≤+5%) |")
  report.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |")
  report.push(`| Import | ${formatMs(baselineImport.p50)} / ${formatMs(baselineImport.p95)} / ${formatMs(baselineImport.p99)} | ${formatMs(candidateImport.p50)} / ${formatMs(candidateImport.p95)} / ${formatMs(candidateImport.p99)} | ${formatPercent(importMs.p50.change)} [${formatPercent(importMs.p50.ci.lower)}, ${formatPercent(importMs.p50.ci.upper)}] | ${formatPercent(importMs.p95.change)} [${formatPercent(importMs.p95.ci.lower)}, ${formatPercent(importMs.p95.ci.upper)}] | ${formatPercent(importMs.p99.change)} [${formatPercent(importMs.p99.ci.lower)}, ${formatPercent(importMs.p99.ci.upper)}] | ${formatPercent(importMs.p50.ci.upper)} / ${formatPercent(importMs.p95.ci.upper)} | ${formatPercent(importMs.p99.ci.upper)} |`)
  report.push(`| TTFMF | ${formatMs(baselineTtfm.p50)} / ${formatMs(baselineTtfm.p95)} / ${formatMs(baselineTtfm.p99)} | ${formatMs(candidateTtfm.p50)} / ${formatMs(candidateTtfm.p95)} / ${formatMs(candidateTtfm.p99)} | ${formatPercent(ttfmMs.p50.change)} [${formatPercent(ttfmMs.p50.ci.lower)}, ${formatPercent(ttfmMs.p50.ci.upper)}] | ${formatPercent(ttfmMs.p95.change)} [${formatPercent(ttfmMs.p95.ci.lower)}, ${formatPercent(ttfmMs.p95.ci.upper)}] | ${formatPercent(ttfmMs.p99.change)} [${formatPercent(ttfmMs.p99.ci.lower)}, ${formatPercent(ttfmMs.p99.ci.upper)}] | ${formatPercent(ttfmMs.p50.ci.upper)} / ${formatPercent(ttfmMs.p95.ci.upper)} | ${formatPercent(ttfmMs.p99.ci.upper)} |`)
  report.push("")
  report.push(`- Wave-3 Startup gate (p50/p95 familywise upper ≤ +3%, p99 ≤ +5%): **${verdict}**`)
  writeFileSync(reportPath, report.join("\n") + "\n")
  appendRaw({ kind: "verdict", verdict, importMs: importMs.budget, ttfmMs: ttfmMs.budget })

  console.log(`\nStartup-safety gate result: ${verdict}`)
  console.log(`report: ${reportPath}`)
  console.log(`raw: ${rawPath}`)
  if (verdict === "FAIL") process.exitCode = 1
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("wave3 startup gate failed:", error)
    process.exitCode = 1
  })
}
