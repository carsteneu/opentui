import { createHash } from "node:crypto"
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { isAbsolute, join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import {
  analyzePairedObservations,
  createPairedSchedule,
  type PairedObservation,
  type PairedOrder,
} from "../src/benchmark/ffi-fast-path-paired-analysis.js"
import {
  buildDisjointStages,
  computeMainThreadSum,
  type Wave3CpuStageSpan,
} from "../src/benchmark/wave3-cpu-harness.js"

export const WAVE3_CLEAN_GATE_CPU_SCHEMA_VERSION = 1
const PROBE_RESULT_PREFIX = "WAVE3_CPU_RESULT "
export const CPU_SCENARIOS = ["cold-1000", "warm-1000-append100"] as const
export type CpuScenario = (typeof CPU_SCENARIOS)[number]
export type Role = "baseline" | "candidate"
export type CpuMetric = "mainThreadSumMs" | "updateToStyledCommitMs"
export const CPU_METRICS: readonly CpuMetric[] = ["mainThreadSumMs", "updateToStyledCommitMs"]

export interface CpuProbeResult {
  schemaVersion: number
  role: Role
  root: string
  revision: string
  scenario: CpuScenario
  runtime: { bun: string; node: string }
  nativeSha256: string
  stages: readonly Wave3CpuStageSpan[]
  mainThreadSumMs: number
  workerWaitMs: number
  workerCpuMs: number
  updateToStyledCommitMs: number
  styledVerified: boolean
  nativeFrameDelta: number
  counts: {
    cellsUpdated: number
    highlightCount: number
    chunkCount: number
    setStyledCalls: number
    appendStyledCalls: number
  }
  correctness: { frameSha256: string; spansSha256: string; chunksSha256: string; finalMarkerVisible: boolean }
  verdict: "PASS" | "FAIL" | "UNCLEAR"
}

export interface ExpectedCpuProbe {
  role: Role
  root: string
  revision: string
  scenario: CpuScenario
  nativeSha256: string
}

interface CpuPairRow {
  pair: number
  order: PairedOrder
  scenario: CpuScenario
  gapMs: number
  baseline: CpuProbeResult
  candidate: CpuProbeResult
}

export type CpuPairRowInput = Omit<CpuPairRow, never>

export function parseCpuProbeOutput(output: string, expected: ExpectedCpuProbe): CpuProbeResult {
  const resultLine = output.split(/\r?\n/).findLast((line) => line.startsWith(PROBE_RESULT_PREFIX))
  if (!resultLine) throw new Error("cpu probe output is missing WAVE3_CPU_RESULT")
  const result = JSON.parse(resultLine.slice(PROBE_RESULT_PREFIX.length)) as CpuProbeResult
  if (result.schemaVersion !== WAVE3_CLEAN_GATE_CPU_SCHEMA_VERSION) {
    throw new Error(`cpu probe schema mismatch: ${result.schemaVersion}`)
  }
  for (const key of ["role", "root", "revision", "scenario", "nativeSha256"] as const) {
    if (result[key] !== expected[key]) {
      throw new Error(`cpu probe ${key} mismatch: ${result[key]} != ${expected[key]}`)
    }
  }
  // A measured arm is only acceptable if the probe classified it PASS (styled
  // native commit verified and disjoint stages valid).
  if (result.verdict !== "PASS") throw new Error(`cpu probe verdict != PASS (${result.verdict})`)
  for (const [name, value] of [
    ["mainThreadSumMs", result.mainThreadSumMs],
    ["workerWaitMs", result.workerWaitMs],
    ["updateToStyledCommitMs", result.updateToStyledCommitMs],
  ] as const) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`invalid cpu metric ${name}: ${value}`)
  }
  // Prove disjoint stage validity from the probe's own spans so a raced or
  // overlapping measurement is never accepted.
  buildDisjointStages(result.stages)
  if (computeMainThreadSum(result.stages) !== result.mainThreadSumMs) {
    throw new Error(`cpu probe mainThreadSumMs ${result.mainThreadSumMs} != disjoint stage sum`)
  }
  if (!result.styledVerified || result.nativeFrameDelta < 1 || !result.correctness.finalMarkerVisible) {
    throw new Error("cpu probe did not verify the final styled native commit")
  }
  return result
}

export function assertCpuProbeValid(result: CpuProbeResult): void {
  buildDisjointStages(result.stages)
  if (computeMainThreadSum(result.stages) !== result.mainThreadSumMs) {
    throw new Error(`cpu probe mainThreadSumMs ${result.mainThreadSumMs} != disjoint stage sum`)
  }
  if (!result.styledVerified || result.nativeFrameDelta < 1) {
    throw new Error("cpu probe styled verification failed")
  }
  if (result.verdict !== "PASS") throw new Error(`cpu probe verdict != PASS (${result.verdict})`)
}

export function summarize(values: readonly number[]) {
  if (values.length === 0) throw new Error("cannot summarize an empty sample")
  const sorted = [...values].sort((left, right) => left - right)
  const percentile = (probability: number) => {
    const index = (sorted.length - 1) * probability
    const lower = Math.floor(index)
    const fraction = index - lower
    return sorted[lower]! + (sorted[Math.min(lower + 1, sorted.length - 1)]! - sorted[lower]!) * fraction
  }
  return { n: sorted.length, p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99) }
}

function analysisFor(rows: CpuPairRow[], scenario: CpuScenario, metric: CpuMetric, confidence: number) {
  const matching = rows.filter((row) => row.scenario === scenario)
  if (matching.length === 0) throw new Error(`no rows for scenario ${scenario}`)
  const observations: PairedObservation[] = matching.map((row) => ({
    pair: row.pair,
    order: row.order,
    gapMs: row.gapMs,
    baselineNsPerOp: row.baseline[metric] * 1e6,
    candidateNsPerOp: row.candidate[metric] * 1e6,
  }))
  return analyzePairedObservations(observations, 20_000, confidence, 0xc0ffee + scenario.length + metric.length)
}

export function buildCpuRows(rows: CpuPairRowInput[]): CpuPairRow[] {
  for (const row of rows) {
    assertCpuProbeValid(row.baseline)
    assertCpuProbeValid(row.candidate)
    for (const digest of ["frameSha256", "spansSha256", "chunksSha256"] as const) {
      if (row.baseline.correctness[digest] !== row.candidate.correctness[digest]) {
        throw new Error(`${row.scenario} output parity failed for ${digest}`)
      }
    }
  }
  return rows.map((row) => ({ ...row }))
}

export interface CpuScenarioMetricAnalysis {
  scenario: CpuScenario
  metric: CpuMetric
  baseline: { p50: number; p95: number; p99: number }
  candidate: { p50: number; p95: number; p99: number }
  nominal: ReturnType<typeof analyzePairedObservations>
  familywise: ReturnType<typeof analyzePairedObservations>
  p95Change: number
  p99Change: number
}

export function computeCpuAnalyses(
  rows: CpuPairRow[],
  scenario: CpuScenario,
  metric: CpuMetric,
): CpuScenarioMetricAnalysis {
  const baseline = summarize(rows.filter((row) => row.scenario === scenario).map((row) => row.baseline[metric]))
  const candidate = summarize(rows.filter((row) => row.scenario === scenario).map((row) => row.candidate[metric]))
  const nominal = analysisFor(rows, scenario, metric, 0.95)
  const familywise = analysisFor(rows, scenario, metric, 1 - 0.05 / 2)
  return {
    scenario,
    metric,
    baseline,
    candidate,
    nominal,
    familywise,
    p95Change: candidate.p95 / baseline.p95 - 1,
    p99Change: candidate.p99 / baseline.p99 - 1,
  }
}

export interface CpuGateInput {
  hostLoadExceeded: boolean
  allSamplesValid: boolean
  digestParity: boolean
  scenarios: readonly CpuScenario[]
  regressionSafe: (scenario: CpuScenario, metric: CpuMetric) => boolean
}

export type CpuGateVerdict = "PASS" | "FAIL" | "UNCLEAR"

/**
 * Hard-fail on any invalid sample or digest divergence; PASS only when every
 * (scenario, metric) is regression-safe (familywise upper <= +3% and p99 <= +5%);
 * UNCLEAR when the host was too loaded to trust the numbers.
 */
export function classifyCpuGate(input: CpuGateInput): CpuGateVerdict {
  if (input.hostLoadExceeded) return "UNCLEAR"
  if (!input.allSamplesValid || !input.digestParity) return "FAIL"
  for (const scenario of input.scenarios) {
    for (const metric of CPU_METRICS) {
      if (!input.regressionSafe(scenario, metric)) return "FAIL"
    }
  }
  return "PASS"
}

// ---- runner (invoked directly: bun scripts/wave3-clean-gate-cpu.ts) ----

function optionalArg(name: string): string | undefined {
  const prefix = `--${name}=`
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length)
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
  if (child.status !== 0)
    throw new Error(`${command} ${args.join(" ")} failed in ${root}:\n${child.stderr}\n${child.stdout}`)
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
  const filename =
    process.platform === "win32"
      ? "libopentui.dll"
      : process.platform === "darwin"
        ? "libopentui.dylib"
        : "libopentui.so"
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
  return child.stdout
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((line) => Number(line.trim().split(/\s+/, 1)[0]) !== process.pid)
}

function runProbe(
  probePath: string,
  role: Role,
  root: string,
  revision: string,
  scenario: CpuScenario,
  nativePath: string,
  nativeSha256: string,
): CpuProbeResult {
  const child = spawnSync(
    process.execPath,
    [
      probePath,
      `--role=${role}`,
      `--root=${root}`,
      `--revision=${revision}`,
      `--scenario=${scenario}`,
      `--native-path=${nativePath}`,
      `--native-sha=${nativeSha256}`,
    ],
    { cwd: root, encoding: "utf8", timeout: 120_000, env: { ...process.env, OTUI_ASSET_ROOT: "" } },
  )
  if (child.error) throw child.error
  if (child.status !== 0) throw new Error(`cpu probe failed (${role}/${scenario}):\n${child.stderr}\n${child.stdout}`)
  return parseCpuProbeOutput(child.stdout, { role, root, revision, scenario, nativeSha256 })
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
  const outputDir = resolve(optionalArg("output-dir") ?? join(process.cwd(), ".yesmem/bench/wave3-final-cpu"))
  const probePath = join(import.meta.dir, "wave3-cpu-probe.ts")

  const baselineHead = git(baselineRoot, ["rev-parse", "HEAD"])
  const candidateHead = git(candidateRoot, ["rev-parse", "HEAD"])
  if (!baselineHead.startsWith(baselineRevision)) throw new Error(`baseline revision mismatch: ${baselineHead}`)
  if (!candidateHead.startsWith(candidateRevision)) throw new Error(`candidate revision mismatch: ${candidateHead}`)

  const baselineNative = nativeArtifact(baselineRoot)
  const candidateNative = nativeArtifact(candidateRoot)
  const baselineSha = sha256File(baselineNative)
  const candidateSha = sha256File(candidateNative)
  if (baselineSha === candidateSha) {
    throw new Error(`per-arm native policy violated: both arms carry the same SHA ${baselineSha}`)
  }

  const startLoad = hostLoad()
  const hostLoadExceeded = startLoad.one > maximumLoad
  const otherBuns = otherBunProcesses()

  mkdirSync(outputDir, { recursive: true })
  const rawPath = join(outputDir, "cpu-raw.ndjson")
  const reportPath = join(outputDir, "cpu-report.md")
  const appendRaw = (value: unknown) => appendFileSync(rawPath, `${JSON.stringify(value)}\n`)
  appendRaw({
    kind: "header",
    schemaVersion: WAVE3_CLEAN_GATE_CPU_SCHEMA_VERSION,
    date: new Date().toISOString(),
    baseline: { root: baselineRoot, revision: baselineHead, nativeSha256: baselineSha },
    candidate: { root: candidateRoot, revision: candidateHead, nativeSha256: candidateSha },
    bun: Bun.version,
    node: process.version,
    pairs,
    warmups,
    startLoad,
    hostLoadExceeded,
    otherBunProcesses: otherBuns,
  })

  const SCENARIOS: readonly CpuScenario[] = CPU_SCENARIOS
  for (const scenario of SCENARIOS) {
    for (let warmup = 0; warmup < warmups; warmup++) {
      const order: Role[] = warmup % 2 === 0 ? ["baseline", "candidate"] : ["candidate", "baseline"]
      for (const role of order) {
        runProbe(
          probePath,
          role,
          role === "baseline" ? baselineRoot : candidateRoot,
          role === "baseline" ? baselineHead : candidateHead,
          scenario,
          role === "baseline" ? baselineNative : candidateNative,
          role === "baseline" ? baselineSha : candidateSha,
        )
      }
    }
  }

  const rows: CpuPairRow[] = []
  const schedule = createPairedSchedule(SCENARIOS, ["bun"], pairs, 0x57b3)
  for (const entry of schedule) {
    const order: Role[] = entry.order === "baseline-first" ? ["baseline", "candidate"] : ["candidate", "baseline"]
    const samples = {} as Record<Role, CpuProbeResult>
    let firstEnd = 0
    let secondStart = 0
    for (let index = 0; index < order.length; index++) {
      const role = order[index]!
      if (index === 1) secondStart = performance.now()
      samples[role] = runProbe(
        probePath,
        role,
        role === "baseline" ? baselineRoot : candidateRoot,
        role === "baseline" ? baselineHead : candidateHead,
        entry.scenario as CpuScenario,
        role === "baseline" ? baselineNative : candidateNative,
        role === "baseline" ? baselineSha : candidateSha,
      )
      if (index === 0) firstEnd = performance.now()
    }
    const row: CpuPairRow = {
      pair: entry.pair,
      order: entry.order,
      scenario: entry.scenario as CpuScenario,
      gapMs: Math.max(0, secondStart - firstEnd),
      baseline: samples.baseline,
      candidate: samples.candidate,
    }
    rows.push(row)
    appendRaw({ kind: "pair", ...row })
  }

  const validated = buildCpuRows(rows)
  const endLoad = hostLoad()

  const allAnalyses: CpuScenarioMetricAnalysis[] = []
  for (const scenario of SCENARIOS) {
    for (const metric of CPU_METRICS) {
      allAnalyses.push(computeCpuAnalyses(validated, scenario, metric))
    }
  }
  const workerWaitBaseline = summarize(validated.map((row) => row.baseline.workerWaitMs))
  const workerWaitCandidate = summarize(validated.map((row) => row.candidate.workerWaitMs))
  const workerCpuBaseline = summarize(validated.map((row) => row.baseline.workerCpuMs))
  const workerCpuCandidate = summarize(validated.map((row) => row.candidate.workerCpuMs))

  const regressionSafe = (scenario: CpuScenario, metric: CpuMetric): boolean => {
    const analysis = allAnalyses.find((a) => a.scenario === scenario && a.metric === metric)!
    return analysis.familywise.ci.upper <= 0.03 && analysis.p99Change <= 0.05
  }
  const verdict = classifyCpuGate({
    hostLoadExceeded,
    allSamplesValid: true,
    digestParity: true,
    scenarios: SCENARIOS,
    regressionSafe,
  })

  const primaryCandidates = allAnalyses
    .filter((a) => a.metric === "mainThreadSumMs" || a.metric === "updateToStyledCommitMs")
    .map((a) => a.familywise.ci.upper)

  const report: string[] = []
  report.push("# Wave 3 CPU/E2E Real-Worker Gate (Loop B, disjoint main-thread)")
  report.push("")
  report.push(`- generated: ${new Date().toISOString()}`)
  report.push(`- baseline: \`${baselineHead}\` (${baselineRoot})`)
  report.push(`- candidate: \`${candidateHead}\` (${candidateRoot})`)
  report.push(`- native policy: per-arm (baseline \`${baselineSha}\`, candidate \`${candidateSha}\`)`)
  report.push(`- Bun: ${Bun.version}; probe node: ${process.version}`)
  report.push(
    `- protocol: ${pairs} balanced pairs, ${warmups} fresh-process warmups/arm/scenario, 20000 bootstrap samples`,
  )
  report.push(
    `- load: start ${startLoad.one}/${startLoad.five}/${startLoad.fifteen}; end ${endLoad.one}/${endLoad.five}/${endLoad.fifteen}; hostLoadExceeded=${hostLoadExceeded}`,
  )
  report.push("")
  report.push(
    "Measurement: disjoint main-thread stages (contentUpdate, workerPost, converter, safeAppend, textbuffer) via external seams; workerWait and workerCpu reported separately and excluded; updateToStyledCommitMs is the full wall time to the styled native commit.",
  )
  report.push("")
  report.push("## Results (paired, familywise across 2 primary metrics)")
  report.push("")
  report.push(
    "| Scenario | Metric | Baseline p50/p95/p99 | Candidate p50/p95/p99 | Paired (95% CI) | Familywise upper | p99 change |",
  )
  report.push("| --- | --- | ---: | ---: | ---: | ---: | ---: |")
  for (const a of allAnalyses) {
    report.push(
      `| ${a.scenario} | ${a.metric} | ${formatMs(a.baseline.p50)} / ${formatMs(a.baseline.p95)} / ${formatMs(a.baseline.p99)} | ${formatMs(a.candidate.p50)} / ${formatMs(a.candidate.p95)} / ${formatMs(a.candidate.p99)} | ${formatPercent(a.nominal.pairedChange)} [${formatPercent(a.nominal.ci.lower)}, ${formatPercent(a.nominal.ci.upper)}] | ${formatPercent(a.familywise.ci.upper)} | ${formatPercent(a.p99Change)} |`,
    )
  }
  report.push("")
  report.push("## Worker (separate, not in main-thread sum)")
  report.push("")
  report.push(
    `- workerWait baseline p50/p95/p99: ${formatMs(workerWaitBaseline.p50)} / ${formatMs(workerWaitBaseline.p95)} / ${formatMs(workerWaitBaseline.p99)}`,
  )
  report.push(
    `- workerWait candidate p50/p95/p99: ${formatMs(workerWaitCandidate.p50)} / ${formatMs(workerWaitCandidate.p95)} / ${formatMs(workerWaitCandidate.p99)}`,
  )
  report.push(`- workerCpu baseline median ~ ${formatMs(workerCpuBaseline.p50)} (streaming path diagnostic)`)
  report.push(`- workerCpu candidate median ~ ${formatMs(workerCpuCandidate.p50)} (streaming path diagnostic)`)
  report.push("")
  report.push("## Verdict")
  report.push("")
  report.push(
    `- measurement validity (disjoint, worker-excluded, styled native commit): **PASS** (every sample PASS, digests identical)`,
  )
  report.push(
    `- regression safety (familywise upper <= +3% and p99 <= +5%): **${verdict === "PASS" ? "PASS" : verdict}**`,
  )
  const bestImprovement = primaryCandidates.length ? Math.min(...primaryCandidates) : 0
  report.push(
    `- Wave-3 -30% primary target (familywise upper <= -30%): **${bestImprovement <= -0.3 ? "PASS" : "NOT MET in isolated Loop B"}** (partial main-thread sum; full claim requires B+D integration: layout.render/native.commit spans live in Loop D)`,
  )
  report.push(`- gate result: **${verdict}**`)
  writeFileSync(reportPath, report.join("\n") + "\n")
  appendRaw({ kind: "verdict", verdict, bestImprovement, regressionSafeOverall: verdict === "PASS" })

  console.log(`\nCPU gate result: ${verdict}`)
  console.log(`report: ${reportPath}`)
  console.log(`raw: ${rawPath}`)

  if (verdict === "FAIL") process.exitCode = 1
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("wave3 clean-gate-cpu failed:", error)
    process.exitCode = 1
  })
}
