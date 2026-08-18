import { createHash } from "node:crypto"
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { isAbsolute, join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import {
  analyzePairedObservations,
  createPairedSchedule,
  type PairedObservation,
  type PairedOrder,
} from "../src/benchmark/ffi-fast-path-paired-analysis.js"

export const WAVE3_CLEAN_GATE_SCHEMA_VERSION = 1
const PROBE_RESULT_PREFIX = "WAVE3_RESULT "
const SCENARIOS = ["cold-1000", "warm-1000-append100"] as const
const PRIMARY_METRIC = "updateToStyledCommitMs" as const

type Role = "baseline" | "candidate"
type Scenario = (typeof SCENARIOS)[number]
export type NativeArtifactPolicy = "identical" | "per-arm"

export function validateNativeArtifacts(policy: NativeArtifactPolicy, baselineSha256: string, candidateSha256: string) {
  if (policy === "identical" && baselineSha256 !== candidateSha256) {
    throw new Error("native artifact SHA differs between arms")
  }
  return { policy, baselineSha256, candidateSha256 }
}

interface ProbeResult {
  schemaVersion: 1
  role: Role
  root: string
  revision: string
  scenario: Scenario
  runtime: { bun: string; node: string }
  nativeSha256: string
  timings: Record<
    | "setterMs"
    | "renderKickWallMs"
    | "workerAndPipelineWallMs"
    | "commitRenderWallMs"
    | "updateToStyledCommitMs"
    | "converterMs"
    | "processCpuUserMicros"
    | "processCpuSystemMicros",
    number
  >
  counts: { nativeFrameDelta: number; cellsUpdated: number; highlightCount: number; chunkCount: number }
  correctness: {
    styledVerified: boolean
    finalMarkerVisible: boolean
    frameSha256: string
    spansSha256: string
    chunksSha256: string
  }
}

interface PairRow {
  pair: number
  order: PairedOrder
  scenario: Scenario
  gapMs: number
  baseline: ProbeResult
  candidate: ProbeResult
}

interface ExpectedProbe {
  role: Role
  root: string
  revision: string
  scenario: Scenario
  nativeSha256: string
}

export function parseProbeOutput(output: string, expected: ExpectedProbe): ProbeResult {
  const resultLine = output.split(/\r?\n/).findLast((line) => line.startsWith(PROBE_RESULT_PREFIX))
  if (!resultLine) throw new Error("probe output is missing WAVE3_RESULT")
  const result = JSON.parse(resultLine.slice(PROBE_RESULT_PREFIX.length)) as ProbeResult
  if (result.schemaVersion !== WAVE3_CLEAN_GATE_SCHEMA_VERSION) throw new Error("probe schema mismatch")
  for (const key of ["role", "root", "revision", "scenario", "nativeSha256"] as const) {
    if (result[key] !== expected[key]) throw new Error(`probe ${key} mismatch: ${result[key]} != ${expected[key]}`)
  }
  if (!result.correctness.styledVerified || !result.correctness.finalMarkerVisible) {
    throw new Error("probe did not verify the final styled generation")
  }
  if (result.counts.nativeFrameDelta < 1) throw new Error("probe did not commit a native frame")
  for (const [name, value] of Object.entries(result.timings)) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`invalid timing ${name}: ${value}`)
  }
  if (!(result.timings.updateToStyledCommitMs > 0) || !(result.timings.converterMs > 0)) {
    throw new Error("primary probe timings must be positive")
  }
  return result
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

function nativeArtifactPolicyArg(): NativeArtifactPolicy {
  const policy = optionalArg("native-policy") ?? "identical"
  if (policy !== "identical" && policy !== "per-arm") {
    throw new Error("--native-policy must be identical or per-arm")
  }
  return policy
}

function run(root: string, command: string, args: string[]): string {
  const child = spawnSync(command, args, { cwd: root, encoding: "utf8", env: { ...process.env, OTUI_ASSET_ROOT: "" } })
  if (child.error) throw child.error
  if (child.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed in ${root}:\n${child.stderr}\n${child.stdout}`)
  }
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
  if (!existsSync(path)) throw new Error(`missing native artifact: ${path}`)
  return path
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
  scenario: Scenario,
  nativePath: string,
  nativeSha256: string,
): ProbeResult {
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
  if (child.status !== 0) throw new Error(`probe failed (${role}/${scenario}):\n${child.stderr}\n${child.stdout}`)
  return parseProbeOutput(child.stdout, { role, root, revision, scenario, nativeSha256 })
}

function formatMs(value: number): string {
  return `${value.toFixed(3)} ms`
}

function formatPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`
}

function analysisFor(rows: PairRow[], scenario: Scenario, metric: keyof ProbeResult["timings"], confidence: number) {
  const matching = rows.filter((row) => row.scenario === scenario)
  const observations: PairedObservation[] = matching.map((row) => ({
    pair: row.pair,
    order: row.order,
    gapMs: row.gapMs,
    baselineNsPerOp: row.baseline.timings[metric] * 1e6,
    candidateNsPerOp: row.candidate.timings[metric] * 1e6,
  }))
  return analyzePairedObservations(observations, 20_000, confidence, 0x57a3 + scenario.length + metric.length)
}

async function main(): Promise<void> {
  const baselineRoot = requiredRoot("baseline-root")
  const candidateRoot = requiredRoot("candidate-root")
  if (baselineRoot === candidateRoot) throw new Error("baseline and candidate roots must differ")
  const baselineRevision = optionalArg("baseline-revision") ?? "fccae2158d5c98949fc050913b918621af918111"
  const candidateRevision = optionalArg("candidate-revision") ?? "6ec90b97"
  const pairs = intArg("pairs", 30, 2)
  if (pairs % 2 !== 0) throw new Error("--pairs must be even")
  const warmups = intArg("warmups", 3, 0)
  const maximumLoad = numberArg("max-load", 4, 0)
  const nativePolicy = nativeArtifactPolicyArg()
  const outputDir = resolve(optionalArg("output-dir") ?? join(process.cwd(), ".yesmem/bench/wave3-clean-gate"))
  const probePath = join(import.meta.dir, "wave3-real-worker-probe.ts")

  const baselineHead = git(baselineRoot, ["rev-parse", "HEAD"])
  const candidateHead = git(candidateRoot, ["rev-parse", "HEAD"])
  if (!baselineHead.startsWith(baselineRevision)) throw new Error(`baseline revision mismatch: ${baselineHead}`)
  if (!candidateHead.startsWith(candidateRevision)) throw new Error(`candidate revision mismatch: ${candidateHead}`)
  for (const [role, root] of [
    ["baseline", baselineRoot],
    ["candidate", candidateRoot],
  ] as const) {
    const status = git(root, ["status", "--porcelain=v1"])
    if (status !== "") throw new Error(`${role} worktree is not clean:\n${status}`)
  }

  const baselineNative = nativeArtifact(baselineRoot)
  const candidateNative = nativeArtifact(candidateRoot)
  const nativeArtifacts = validateNativeArtifacts(nativePolicy, sha256File(baselineNative), sha256File(candidateNative))

  const startLoad = hostLoad()
  if (startLoad.one > maximumLoad) throw new Error(`host load ${startLoad.one} exceeds --max-load=${maximumLoad}`)
  const otherBuns = otherBunProcesses()
  if (otherBuns.length > 0) throw new Error(`other Bun processes are active:\n${otherBuns.join("\n")}`)

  mkdirSync(outputDir, { recursive: true })
  const rawPath = join(outputDir, "raw.ndjson")
  const reportPath = join(outputDir, "report.md")
  const appendRaw = (value: unknown) => appendFileSync(rawPath, `${JSON.stringify(value)}\n`)
  appendRaw({
    kind: "header",
    schemaVersion: WAVE3_CLEAN_GATE_SCHEMA_VERSION,
    date: new Date().toISOString(),
    baseline: { root: baselineRoot, revision: baselineHead },
    candidate: { root: candidateRoot, revision: candidateHead },
    nativeArtifacts,
    bun: Bun.version,
    node: process.version,
    pairs,
    warmups,
    startLoad,
  })

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
          role === "baseline" ? nativeArtifacts.baselineSha256 : nativeArtifacts.candidateSha256,
        )
      }
    }
  }

  const rows: PairRow[] = []
  const schedule = createPairedSchedule(SCENARIOS, ["bun"], pairs, 0x57a3)
  for (const entry of schedule) {
    const order: Role[] = entry.order === "baseline-first" ? ["baseline", "candidate"] : ["candidate", "baseline"]
    const samples = {} as Record<Role, ProbeResult>
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
        entry.scenario as Scenario,
        role === "baseline" ? baselineNative : candidateNative,
        role === "baseline" ? nativeArtifacts.baselineSha256 : nativeArtifacts.candidateSha256,
      )
      if (index === 0) firstEnd = performance.now()
    }
    const row: PairRow = {
      pair: entry.pair,
      order: entry.order,
      scenario: entry.scenario as Scenario,
      gapMs: Math.max(0, secondStart - firstEnd),
      baseline: samples.baseline,
      candidate: samples.candidate,
    }
    for (const digest of ["frameSha256", "spansSha256", "chunksSha256"] as const) {
      if (row.baseline.correctness[digest] !== row.candidate.correctness[digest]) {
        throw new Error(`${entry.scenario} output parity failed for ${digest}`)
      }
    }
    rows.push(row)
    appendRaw({ kind: "pair", ...row })
  }

  const endLoad = hostLoad()
  const familywiseConfidence = 1 - 0.05 / SCENARIOS.length
  const analyses = SCENARIOS.map((scenario) => {
    const baselineWall = summarize(
      rows.filter((row) => row.scenario === scenario).map((row) => row.baseline.timings[PRIMARY_METRIC]),
    )
    const candidateWall = summarize(
      rows.filter((row) => row.scenario === scenario).map((row) => row.candidate.timings[PRIMARY_METRIC]),
    )
    const baselineConverter = summarize(
      rows.filter((row) => row.scenario === scenario).map((row) => row.baseline.timings.converterMs),
    )
    const candidateConverter = summarize(
      rows.filter((row) => row.scenario === scenario).map((row) => row.candidate.timings.converterMs),
    )
    return {
      scenario,
      wall: {
        baseline: baselineWall,
        candidate: candidateWall,
        nominal: analysisFor(rows, scenario, PRIMARY_METRIC, 0.95),
        familywise: analysisFor(rows, scenario, PRIMARY_METRIC, familywiseConfidence),
        p95Change: candidateWall.p95 / baselineWall.p95 - 1,
      },
      converter: {
        baseline: baselineConverter,
        candidate: candidateConverter,
        nominal: analysisFor(rows, scenario, "converterMs", 0.95),
        p95Change: candidateConverter.p95 / baselineConverter.p95 - 1,
      },
    }
  })

  let report = `# Wave 3 clean-host Real-Worker Gate\n\n`
  report += `- generated: ${new Date().toISOString()}\n`
  report += `- baseline: \`${baselineHead}\` (${baselineRoot})\n`
  report += `- candidate: \`${candidateHead}\` (${candidateRoot})\n`
  report += `- native policy: \`${nativeArtifacts.policy}\`\n`
  report += `- baseline native SHA: \`${nativeArtifacts.baselineSha256}\`\n`
  report += `- candidate native SHA: \`${nativeArtifacts.candidateSha256}\`\n`
  report += `- Bun: ${Bun.version}; Node host: ${process.version}\n`
  report += `- protocol: ${pairs} balanced pairs, ${warmups} fresh-process warmups/arm/scenario, 20000 bootstrap samples\n`
  report += `- load: start ${startLoad.one}/${startLoad.five}/${startLoad.fifteen}; end ${endLoad.one}/${endLoad.five}/${endLoad.fifteen}\n\n`
  report += `## Results\n\n`
  report += `| Scenario | Metric | Baseline p50/p95/p99 | Candidate p50/p95/p99 | Paired change (95% CI) | Familywise upper | p95 change |\n`
  report += `| --- | --- | ---: | ---: | ---: | ---: | ---: |\n`
  for (const result of analyses) {
    report += `| ${result.scenario} | update→styled native commit | ${formatMs(result.wall.baseline.p50)} / ${formatMs(result.wall.baseline.p95)} / ${formatMs(result.wall.baseline.p99)} | ${formatMs(result.wall.candidate.p50)} / ${formatMs(result.wall.candidate.p95)} / ${formatMs(result.wall.candidate.p99)} | ${formatPercent(result.wall.nominal.pairedChange)} [${formatPercent(result.wall.nominal.ci.lower)}, ${formatPercent(result.wall.nominal.ci.upper)}] | ${formatPercent(result.wall.familywise.ci.upper)} | ${formatPercent(result.wall.p95Change)} |\n`
    report += `| ${result.scenario} | converter | ${formatMs(result.converter.baseline.p50)} / ${formatMs(result.converter.baseline.p95)} / ${formatMs(result.converter.baseline.p99)} | ${formatMs(result.converter.candidate.p50)} / ${formatMs(result.converter.candidate.p95)} / ${formatMs(result.converter.candidate.p99)} | ${formatPercent(result.converter.nominal.pairedChange)} [${formatPercent(result.converter.nominal.ci.lower)}, ${formatPercent(result.converter.nominal.ci.upper)}] | n/a | ${formatPercent(result.converter.p95Change)} |\n`
  }

  const wallPrimaryPass = analyses.every(
    (result) => result.wall.familywise.ci.upper <= -0.3 && result.wall.p95Change <= -0.3,
  )
  const wallRegressionSafe = analyses.every((result) => result.wall.familywise.ci.upper <= 0.03)
  report += `\n## Verdict\n\n`
  report += `- styled/output/chunk parity: **PASS** (all paired digests identical)\n`
  report += `- update→styled-commit regression budget (familywise upper <= +3%): **${wallRegressionSafe ? "PASS" : "FAIL"}**\n`
  report += `- update→styled-commit -30% primary wall target: **${wallPrimaryPass ? "PASS" : "FAIL"}**\n`
  report += `- pure main-thread CPU -30%: **UNCLEAR** — the current production path records no stage spans; total process CPU includes worker CPU and is diagnostic only.\n`
  report += `- overall §13.1: **${wallPrimaryPass ? "UNCLEAR" : "FAIL/UNCLEAR"}** until both wall and pure main-thread criteria are measurable.\n\n`
  report += `Raw data: \`raw.ndjson\`.\n`
  writeFileSync(reportPath, report)
  writeFileSync(
    join(outputDir, "summary.json"),
    `${JSON.stringify({ analyses, wallPrimaryPass, wallRegressionSafe, startLoad, endLoad }, null, 2)}\n`,
  )
  process.stdout.write(report)
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("wave3 clean-host gate failed:", error)
    process.exitCode = 1
  })
}
