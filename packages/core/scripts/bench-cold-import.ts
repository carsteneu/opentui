// Reproducible cold-import / time-to-first-meaningful-frame benchmark.
//
// The acceptance gate compares the current worktree with a baseline worktree
// (fastpatch by default). Every pair executes both complete trees in a fresh process. The
// execution order is deterministic, seeded, and exactly balanced. PASS needs
// the familywise bootstrap upper bound for BOTH importMs and ttfmMs to remain
// within the configured regression budget.
//
// Options:
//   --scenario=minimal|root|zig|dist|renderer-entry|renderable-entry (default root)
//   --runtime=bun|node               (default bun; node is exactly v26.4.0)
//   --samples=N --warmup=N           (defaults 30 / 3; gates need even N >= 10)
//   --threshold=<percent>            (default 3)
//   --confidence=<fraction>          (default 0.95, familywise across 2 metrics)
//   --bootstrap=N                    (default 20000)
//   --seed=N                         (default: current commit prefix)
//   --gate                            baseline vs current, drives exit status
//   --baseline-root=<absolute path>   paired-gate baseline (default ../fastpatch)
//   --baseline-label=<name>           report label (default worktree basename)
//   --baseline-scenario=<scenario>     paired baseline workload (default root)
//   --native-asset-root=<absolute>     pin both gate arms (default baseline node_modules)
//   --gate-record                     telemetry disabled vs enabled, informational
//   --allow-dirty                     allow, but fully record, dirty worktrees
//   --force-fail                      prove the acceptance exit path
//   --artifact=<name>
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { arch, cpus, loadavg, platform, tmpdir, uptime } from "node:os"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import {
  analyzeColdImportPairs,
  createColdImportSchedule,
  type ColdImportPair,
  type ColdImportMeasurement,
} from "./bench-cold-import-analysis.js"
import {
  resolveBaselineSelection,
  resolveGateScenarios,
  scenarioTarget,
  scenarios,
  type Runtime,
  type Scenario,
} from "./bench-cold-import-config.js"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, "..", "..", "..")
const coreDir = resolve(repoRoot, "packages", "core")
const branchSrcRoot = resolve(coreDir, "src")
const NODE26_REQUIRED = "v26.4.0"
let probeSerial = 0

interface ProbeBody {
  importMs: number
  ttfmMs: number | null
  scenario: string
  runtime: Runtime
  telemetry: boolean
  firstCommitAt: number | null
  destroyMs: number | null
  marks: Array<{ name: string; atMs: number }>
  spans: Array<{ name: string; startMs: number; endMs: number }>
}

interface SummaryStats {
  median: number
  p95: number
  p99: number
  rmePct: number
  n: number
}

interface RawPair extends ColdImportPair {
  baselineProbe: ProbeBody
  candidateProbe: ProbeBody
}

type PairedAnalysis = ReturnType<typeof analyzeColdImportPairs>

interface GateRecord {
  kind: "gate.paired-familywise"
  name: string
  baselineLabel: string
  candidateLabel: string
  baselineScenario: Scenario
  candidateScenario: Scenario
  pairs: RawPair[]
  analysis: PairedAnalysis
  nativeAssetRoot: string | null
  forcedFailure: boolean
  passed: boolean
}

function parseArgs(): Record<string, string> {
  const values: Record<string, string> = {}
  for (const arg of process.argv.slice(2)) {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(arg)
    if (match) values[match[1]!] = match[2] ?? ""
  }
  return values
}

function run(command: string, args: string[], cwd = repoRoot): string {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" })
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`)
  return result.stdout.trim()
}

function gitRev(tree: string, ref = "HEAD"): string {
  return run("git", ["rev-parse", ref], tree)
}

function gitStatus(tree: string): string[] {
  return run("git", ["status", "--porcelain=v1", "--untracked-files=all"], tree)
    .split("\n")
    .filter(Boolean)
    .filter((line) => !line.includes(".yesmem/"))
}

function worktreeState(tree: string) {
  const status = gitStatus(tree)
  const diff = spawnSync("git", ["diff", "--binary", "HEAD"], { cwd: tree, encoding: "utf8" }).stdout
  const contentHash = createHash("sha256").update(diff)
  for (const row of status) {
    const relative = row.slice(3).replace(/^"|"$/g, "").split(" -> ").at(-1)!
    const path = resolve(tree, relative)
    try {
      if (statSync(path).isFile()) contentHash.update(relative).update(readFileSync(path))
    } catch {}
  }
  return {
    clean: status.length === 0,
    status,
    contentSha256: contentHash.digest("hex"),
  }
}

function readOptional(path: string): string | null {
  try {
    return readFileSync(path, "utf8").trim() || null
  } catch {
    return null
  }
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

let nativeImportSerial = 0

async function nativeProvenance(srcRoot: string, runtime: Runtime, assetRoot?: string) {
  const modulePath = resolve(
    srcRoot,
    "platform",
    runtime === "node" ? "runtime-assets.node.ts" : "runtime-assets.bun.ts",
  )
  const originalAssetRoot = process.env.OTUI_ASSET_ROOT
  if (assetRoot) process.env.OTUI_ASSET_ROOT = assetRoot
  else delete process.env.OTUI_ASSET_ROOT
  let path: string
  try {
    const assets = (await import(`${pathToFileURL(modulePath).href}?bench=${nativeImportSerial++}`)) as {
      resolveNativeLibraryPath: () => Promise<string>
    }
    path = resolve(await assets.resolveNativeLibraryPath())
  } finally {
    if (originalAssetRoot === undefined) delete process.env.OTUI_ASSET_ROOT
    else process.env.OTUI_ASSET_ROOT = originalAssetRoot
  }
  const symbols = spawnSync("nm", ["-D", "--defined-only", path], { encoding: "utf8" })
  const symbolNames =
    symbols.status === 0
      ? symbols.stdout
          .split("\n")
          .map((line) => line.trim().split(/\s+/).at(-1) ?? "")
          .filter(Boolean)
          .sort()
      : []
  return {
    path,
    bytes: statSync(path).size,
    sha256: sha256File(path),
    symbolCount: symbolNames.length,
    symbolSetSha256: symbolNames.length ? createHash("sha256").update(symbolNames.join("\n")).digest("hex") : null,
    symbolInspectionError: symbols.status === 0 ? null : symbols.stderr.trim() || "nm unavailable",
  }
}

let nodeCache: { bin: string; version: string } | null = null

function resolveNode26(): { bin: string; version: string } {
  if (nodeCache) return nodeCache
  const exact = (bin: string): string | null => {
    const result = spawnSync(bin, ["--version"], { encoding: "utf8" })
    return result.status === 0 && result.stdout.trim() === NODE26_REQUIRED ? bin : null
  }
  let bin = process.env.OPENTUI_BENCH_NODE ? exact(process.env.OPENTUI_BENCH_NODE) : null
  if (!bin) {
    const nvmRoot = join(process.env.HOME ?? "/root", ".nvm", "versions", "node")
    try {
      for (const version of readdirSync(nvmRoot)) {
        const candidate = join(nvmRoot, version, "bin", "node")
        if (exact(candidate)) {
          bin = candidate
          break
        }
      }
    } catch {}
  }
  if (!bin) {
    throw new Error(`Node.js ${NODE26_REQUIRED} is required; install it or set OPENTUI_BENCH_NODE to its binary`)
  }
  nodeCache = { bin, version: NODE26_REQUIRED }
  return nodeCache
}

function runProbe(options: {
  scenario: Scenario
  runtime: Runtime
  telemetry: boolean
  lifecycle?: boolean
  assetRoot?: string
  src: string
  entry: string
  render: boolean
}): ProbeBody {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    OPENTUI_BENCH_ENTRY: options.entry,
    OPENTUI_BENCH_SRC: options.src,
    OPENTUI_BENCH_SCENARIO: options.scenario,
    OPENTUI_BENCH_RENDER: options.render ? "1" : "0",
    OPENTUI_BENCH_TELEMETRY: options.telemetry ? "1" : "0",
    OPENTUI_BENCH_LIFECYCLE: options.lifecycle ? "1" : "0",
    ...(options.assetRoot ? { OTUI_ASSET_ROOT: options.assetRoot } : {}),
  }
  if (!options.assetRoot) delete environment.OTUI_ASSET_ROOT
  const probe = join(scriptDir, "cold-import-probe.ts")
  const command = options.runtime === "bun" ? "bun" : resolveNode26().bin
  const childArgs = options.runtime === "bun" ? ["run", probe] : [probe]
  // Bun 1.3.x can lose stdout from a synchronously spawned Node process.
  // Node probes therefore return through an exact, controller-owned temp file.
  const outputFile =
    options.runtime === "node" ? join(tmpdir(), `opentui-cold-import-${process.pid}-${probeSerial++}.json`) : null
  if (outputFile) environment.OPENTUI_BENCH_OUTPUT = outputFile
  let output = ""
  try {
    const result = spawnSync(command, childArgs, {
      cwd: scriptDir,
      env: environment,
      encoding: "utf8",
      timeout: 60_000,
    })
    if (result.status !== 0) {
      throw new Error(
        `probe failed (${options.scenario} ${options.runtime} telemetry=${options.telemetry}): ${result.stderr || result.stdout}`,
      )
    }
    output = outputFile ? readFileSync(outputFile, "utf8") : result.stdout
  } finally {
    if (outputFile && existsSync(outputFile)) unlinkSync(outputFile)
  }
  const json = output
    .split("\n")
    .filter((line) => line.trim().startsWith("{"))
    .at(-1)
  if (!json) throw new Error(`probe returned no JSON: ${output}`)
  const body = JSON.parse(json) as ProbeBody
  if (!Number.isFinite(body.importMs)) throw new Error(`invalid probe result: ${json}`)
  if (options.render && !Number.isFinite(body.ttfmMs)) {
    throw new Error(`render probe returned no committed-frame TTFMF: ${json}`)
  }
  if (!options.render && body.ttfmMs !== null) {
    throw new Error(`import-only probe reported a TTFMF without a committed frame: ${json}`)
  }
  return body
}

function quantile(sorted: number[], percentile: number): number {
  const position = (sorted.length - 1) * percentile
  const low = Math.floor(position)
  const high = Math.ceil(position)
  if (low === high) return sorted[low]!
  return sorted[low]! + (sorted[high]! - sorted[low]!) * (position - low)
}

function stats(values: number[]): SummaryStats {
  const sorted = [...values].sort((left, right) => left - right)
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, values.length - 1)
  const rmePct = Math.abs((1.96 * Math.sqrt(variance / values.length)) / mean) * 100
  return {
    median: quantile(sorted, 0.5),
    p95: quantile(sorted, 0.95),
    p99: quantile(sorted, 0.99),
    rmePct,
    n: values.length,
  }
}

function summarize(samples: ProbeBody[]) {
  const ttfmValues = samples.map((sample) => sample.ttfmMs).filter((value): value is number => value !== null)
  const destroyValues = samples.map((sample) => sample.destroyMs).filter((value): value is number => value !== null)
  return {
    importMs: stats(samples.map((sample) => sample.importMs)),
    ttfmMs: ttfmValues.length > 0 ? stats(ttfmValues) : null,
    destroyMs: destroyValues.length > 0 ? stats(destroyValues) : null,
  }
}

function measure(options: Parameters<typeof runProbe>[0], samples: number, warmup: number): ProbeBody[] {
  for (let index = 0; index < warmup; index++) runProbe(options)
  return Array.from({ length: samples }, () => runProbe(options))
}

function pairedGate(options: {
  name: string
  baselineLabel: string
  candidateLabel: string
  baselineScenario: Scenario
  candidateScenario: Scenario
  baseline: Parameters<typeof runProbe>[0]
  candidate: Parameters<typeof runProbe>[0]
  pairs: number
  warmup: number
  threshold: number
  confidence: number
  bootstrapSamples: number
  seed: number
  nativeAssetRoot?: string
  forceFailure?: boolean
}): GateRecord {
  if (!options.baseline.render || !options.candidate.render) {
    throw new Error("paired TTFMF gates require committed-frame workloads in both arms")
  }
  for (let index = 0; index < options.warmup; index++) {
    const baselineFirst = index % 2 === 0
    runProbe(baselineFirst ? options.baseline : options.candidate)
    runProbe(baselineFirst ? options.candidate : options.baseline)
  }

  const pairs: RawPair[] = []
  for (const scheduled of createColdImportSchedule(options.pairs, options.seed)) {
    let baselineProbe: ProbeBody
    let candidateProbe: ProbeBody
    let firstFinished: number
    let secondStarted: number
    if (scheduled.order === "baseline-first") {
      baselineProbe = runProbe(options.baseline)
      firstFinished = performance.now()
      secondStarted = performance.now()
      candidateProbe = runProbe(options.candidate)
    } else {
      candidateProbe = runProbe(options.candidate)
      firstFinished = performance.now()
      secondStarted = performance.now()
      baselineProbe = runProbe(options.baseline)
    }
    pairs.push({
      pair: scheduled.pair,
      order: scheduled.order,
      gapMs: secondStarted - firstFinished,
      baseline: committedMeasurement(baselineProbe),
      candidate: committedMeasurement(candidateProbe),
      baselineProbe,
      candidateProbe,
    })
  }

  const analysis = analyzeColdImportPairs(pairs, {
    bootstrapSamples: options.bootstrapSamples,
    confidence: options.confidence,
    maximumRegression: options.threshold / 100,
    minimumPairs: 10,
    seed: options.seed,
  })
  return {
    kind: "gate.paired-familywise",
    name: options.name,
    baselineLabel: options.baselineLabel,
    candidateLabel: options.candidateLabel,
    baselineScenario: options.baselineScenario,
    candidateScenario: options.candidateScenario,
    pairs,
    analysis,
    nativeAssetRoot: options.nativeAssetRoot ?? null,
    forcedFailure: options.forceFailure === true,
    passed: analysis.safety.passed && options.forceFailure !== true,
  }
}

function committedMeasurement(probe: ProbeBody): ColdImportMeasurement {
  if (probe.ttfmMs === null) throw new Error("committed-frame probe returned no TTFMF")
  return { importMs: probe.importMs, ttfmMs: probe.ttfmMs }
}

function percent(value: number): string {
  return `${(value * 100).toFixed(2)}%`
}

function milliseconds(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value) ? "—" : value.toFixed(3)
}

const LIMITATIONS = `## Grenzen

- \`minimal\` ist ein interner, reiner Import-Messpunkt für \`Renderable.ts\`, kein
  zugesagter Package-Subpath. Der unterstützte Minimal-Entrypoint bleibt B1.
- \`renderer-entry\` misst den öffentlichen granularen Renderer-Subpath bis zu
  einem tatsächlich nativ committed Textframe. \`renderable-entry\` bleibt ein
  reiner Import-Messpunkt und meldet deshalb keine TTFMF.
- \`dist\` und Node messen in Welle 0 nur den Paketimport und melden deshalb
  keine TTFMF. Source- und Dist-Module werden in keinem Arm vermischt.
- \`firstOutputWrite\` wird an einem tatsächlich aufgerufenen TypeScript-/Feed-
  Sink beobachtet. Ein vollständig nativer direkter Prozess-stdout-Write ist aus
  JavaScript heraus weiterhin nicht einzeln beobachtbar.
- Eine Framequelle wird am ersten Request-Ursprung gespeichert. Bei mehreren
  koaleszierten Ursachen beschreibt sie absichtlich den ersten Auslöser.
- \`frame.promote.partialToFull\` zählt den kanonischen Partial-zu-Full-Pfad;
  Full-Render-Nachläufe sind keine zusätzlichen Promotions.
`

function buildReport(rows: Array<Record<string, unknown>>, artifact: string): string {
  const last = rows.at(-1) ?? {}
  let report = `# Cold-import / TTFMF — \`${artifact}\`\n\n`
  report += `Generiert ${new Date().toISOString()} · Commit \`${String(last.commit ?? "unknown")}\`\n\n`
  report += `Rohdaten: \`raw.ndjson\` (${rows.length} append-only row(s)).\n\n`
  report += "## Messungen\n\n"
  report += "| Commit | Runtime | Szenario | import p50/p95/p99 ms | TTFMF p50/p95/p99 ms |\n"
  report += "| --- | --- | --- | --- | --- |\n"
  for (const row of rows) {
    if (row.kind !== "baseline.cold-import") continue
    const summary = row.summary as ReturnType<typeof summarize>
    const runtime = (row.runtime as { engine?: string } | undefined)?.engine ?? "?"
    report += `| ${String(row.commit).slice(0, 7)} | ${runtime} | ${row.scenario} | ${milliseconds(summary.importMs.median)} / ${milliseconds(summary.importMs.p95)} / ${milliseconds(summary.importMs.p99)} | ${milliseconds(summary.ttfmMs?.median)} / ${milliseconds(summary.ttfmMs?.p95)} / ${milliseconds(summary.ttfmMs?.p99)} |\n`
  }
  for (const row of rows) {
    for (const gate of (row.gates as GateRecord[] | undefined) ?? []) {
      report += `\n## Gate: ${gate.name}\n\n`
      report += `${gate.baselineLabel} → ${gate.candidateLabel}; ${gate.analysis.safety.criterion}.\n\n`
      report += `Szenarien: Baseline \`${gate.baselineScenario ?? "root"}\` → Candidate \`${gate.candidateScenario ?? "root"}\`.\n\n`
      report += "| Metrik | gepaarte Änderung | nominales CI | familienweises CI | Gate |\n"
      report += "| --- | ---: | ---: | ---: | --- |\n"
      for (const metric of ["importMs", "ttfmMs"] as const) {
        const result = gate.analysis.metrics[metric]
        const pass = gate.analysis.safety.metricPasses[metric]
        report += `| ${metric} | ${percent(result.familywise.pairedChange)} | ${percent(result.nominal.ci.lower)} … ${percent(result.nominal.ci.upper)} | ${percent(result.familywise.ci.lower)} … ${percent(result.familywise.ci.upper)} | ${pass ? "PASS" : "FAIL"} |\n`
      }
      report += `\nGesamt: **${gate.passed ? "PASS" : "FAIL"}**${gate.forcedFailure ? " (erzwungener Testfehler)" : ""}. Reihenfolge: ${gate.analysis.metrics.importMs.familywise.orderCounts.baselineFirst}/${gate.analysis.metrics.importMs.familywise.orderCounts.candidateFirst}.\n`
    }
  }
  const gateRow = rows.find((row) => ((row.gates as GateRecord[] | undefined) ?? []).length > 0)
  if (gateRow) {
    const source = gateRow.source as {
      candidate?: { clean: boolean; contentSha256: string }
      baseline?: { clean: boolean; contentSha256: string }
      branch?: { clean: boolean; contentSha256: string }
      fastpatch?: { clean: boolean; contentSha256: string }
    }
    const native = gateRow.native as {
      discovered: {
        candidate?: { sha256: string }
        baseline?: { sha256: string }
        branch?: { sha256: string }
        fastpatch?: { sha256: string }
      }
      gatePinned: {
        assetRoot: string
        candidate?: { sha256: string; symbolCount: number }
        branch?: { sha256: string; symbolCount: number }
      }
    }
    const baseline = gateRow.baseline as { label?: string; root?: string } | undefined
    const host = gateRow.host as {
      cpu: string
      loadAverage: number[]
      scalingGovernor: string | null
      intelPstate: string | null
    }
    const protocol = gateRow.protocol as {
      seed: number
      warmup: number
      samples: number
      bootstrapSamples: number
    }
    const lifecycle = gateRow.lifecycle as ProbeBody | null
    const candidateSource = source.candidate ?? source.branch
    const baselineSource = source.baseline ?? source.fastpatch
    const candidateNative = native.discovered.candidate ?? native.discovered.branch
    const baselineNative = native.discovered.baseline ?? native.discovered.fastpatch
    const pinnedCandidate = native.gatePinned.candidate ?? native.gatePinned.branch
    if (!candidateSource || !baselineSource || !candidateNative || !baselineNative || !pinnedCandidate) {
      throw new Error("incomplete gate provenance")
    }
    report += "\n## Gate-Provenienz\n\n"
    report += `- Baseline: ${baseline?.label ?? "fastpatch"}${baseline?.root ? ` (${baseline.root})` : ""}.\n`
    report += `- Source: candidate ${candidateSource.clean ? "clean" : "dirty, explizit erlaubt"} (${candidateSource.contentSha256}); baseline ${baselineSource.clean ? "clean" : "dirty"} (${baselineSource.contentSha256}).\n`
    report += `- Entdeckte Native-SHAs: candidate ${candidateNative.sha256}; baseline ${baselineNative.sha256}.\n`
    report += `- Gate-Pinning: ${native.gatePinned.assetRoot}; SHA ${pinnedCandidate.sha256}; ${pinnedCandidate.symbolCount} exportierte Symbole.\n`
    report += `- Host: ${host.cpu}; Load ${host.loadAverage.join("/")}; Governor ${host.scalingGovernor ?? "unbekannt"}; Intel-Pstate ${host.intelPstate ?? "unbekannt"}.\n`
    report += `- Protokoll: Seed ${protocol.seed}; Warmup ${protocol.warmup}; ${protocol.samples} Paare; ${protocol.bootstrapSamples} Bootstrap-Samples.\n`
    if (lifecycle) {
      report += `- Lifecycle-Probe: ${lifecycle.marks.map((entry) => entry.name).join(" → ")}; Destroy ${lifecycle.destroyMs ?? "—"} ms.\n`
    }
  }
  report += `\n${LIMITATIONS}`
  return report
}

async function main(): Promise<void> {
  const args = parseArgs()
  const scenario = (args.scenario ?? "root") as Scenario
  const runtime: Runtime = args.runtime === "node" ? "node" : "bun"
  const samples = Number(args.samples ?? 30)
  const warmup = Number(args.warmup ?? 3)
  const threshold = Number(args.threshold ?? 3)
  const confidence = Number(args.confidence ?? 0.95)
  const bootstrapSamples = Number(args.bootstrap ?? 20_000)
  const doGate = args.gate !== undefined
  const doGateRecord = args["gate-record"] !== undefined
  const allowDirty = args["allow-dirty"] !== undefined
  const forceFailure = args["force-fail"] !== undefined
  const baselineSelection = resolveBaselineSelection(args, repoRoot)
  const baselineRoot = baselineSelection.root
  const baselineCore = resolve(baselineRoot, "packages", "core")
  const baselineSrcRoot = resolve(baselineCore, "src")

  if (!scenarios.includes(scenario)) {
    throw new Error(`unknown scenario: ${scenario}`)
  }
  if (doGate && runtime !== "bun") throw new Error("--gate is a Bun-only source-root baseline comparison")
  const gateScenarios = doGate ? resolveGateScenarios(args, scenario, runtime) : null
  if (!Number.isInteger(samples) || samples < 1) throw new Error("--samples must be a positive integer")
  if (!Number.isInteger(warmup) || warmup < 0) throw new Error("--warmup must be a non-negative integer")
  if (!Number.isFinite(threshold) || threshold < 0) throw new Error("--threshold must be non-negative")
  if (!(confidence > 0 && confidence < 1)) throw new Error("--confidence must be between 0 and 1")
  if (!Number.isInteger(bootstrapSamples) || bootstrapSamples < 1) throw new Error("--bootstrap must be positive")
  if ((doGate || doGateRecord) && (samples < 10 || samples % 2 !== 0)) {
    throw new Error("gates require an even --samples count >= 10")
  }
  if (doGateRecord && runtime !== "bun") throw new Error("--gate-record is Bun-only")
  if (forceFailure && !doGate) throw new Error("--force-fail requires --gate")
  if (runtime === "node" && scenario !== "dist") throw new Error("Node Welle-0 measurement requires --scenario=dist")

  const commit = gitRev(repoRoot)
  const baselineCommit = doGate ? gitRev(baselineRoot) : null
  const mergeBase = baselineCommit ? run("git", ["merge-base", commit, baselineCommit], repoRoot) : null
  const artifact = args.artifact ?? `cold-import-${commit.slice(0, 7)}`
  const benchRoot = process.env.OPENTUI_BENCH_DIR ?? join(repoRoot, ".yesmem", "bench")
  const artifactDir = join(benchRoot, artifact)
  const rawFile = join(artifactDir, "raw.ndjson")
  if (args["regen-report"] !== undefined) {
    if (!existsSync(rawFile)) throw new Error(`no raw data at ${rawFile}`)
    const rows = readFileSync(rawFile, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    writeFileSync(join(artifactDir, "report.md"), buildReport(rows, artifact))
    return
  }
  const seed = Number(args.seed ?? Number.parseInt(commit.slice(0, 8), 16)) >>> 0
  const candidateState = worktreeState(repoRoot)
  const baselineState = doGate ? worktreeState(baselineRoot) : null
  if (!allowDirty && (!candidateState.clean || (baselineState !== null && !baselineState.clean))) {
    throw new Error(
      `benchmark worktrees must be clean (candidate=${candidateState.status.join(", ") || "clean"}; baseline=${baselineState?.status.join(", ") || "clean"}); commit/stash changes or pass --allow-dirty`,
    )
  }

  const candidateNative = await nativeProvenance(branchSrcRoot, runtime)
  const baselineNative = doGate ? await nativeProvenance(baselineSrcRoot, runtime) : null
  // A local build may leave different native packages in the two worktrees.
  // Pin both source arms to one asset root so the gate isolates the TypeScript
  // change, then verify both resolvers observe the identical file/symbol set.
  // The independently discovered binaries are still recorded below.
  const configuredNativeAssetRoot = args["native-asset-root"]
  if (configuredNativeAssetRoot !== undefined && !isAbsolute(configuredNativeAssetRoot)) {
    throw new Error("--native-asset-root must be absolute")
  }
  const gateNativeAssetRoot = doGate
    ? configuredNativeAssetRoot === undefined
      ? resolve(baselineCore, "node_modules")
      : resolve(configuredNativeAssetRoot)
    : null
  const pinnedCandidateNative = gateNativeAssetRoot
    ? await nativeProvenance(branchSrcRoot, runtime, gateNativeAssetRoot)
    : null
  const pinnedBaselineNative = gateNativeAssetRoot
    ? await nativeProvenance(baselineSrcRoot, runtime, gateNativeAssetRoot)
    : null
  if (
    pinnedCandidateNative &&
    pinnedBaselineNative &&
    (pinnedCandidateNative.sha256 !== pinnedBaselineNative.sha256 ||
      pinnedCandidateNative.symbolSetSha256 !== pinnedBaselineNative.symbolSetSha256)
  ) {
    throw new Error("pinned native artifact drift between baseline and candidate; refusing paired source gate")
  }

  const node = runtime === "node" ? resolveNode26() : null
  const target = scenarioTarget(repoRoot, scenario, runtime)
  const probeOptions = { scenario, runtime, telemetry: false, ...target }
  const baselineSamples = measure(probeOptions, samples, warmup)

  let lifecycle: ProbeBody | null = null
  if (runtime === "bun" && target.render) {
    lifecycle = runProbe({ ...probeOptions, telemetry: true, lifecycle: true })
  }

  const gates: GateRecord[] = []
  if (doGate && gateScenarios) {
    const base = scenarioTarget(baselineRoot, gateScenarios.baseline, "bun")
    const pinnedCandidate = { ...probeOptions, assetRoot: gateNativeAssetRoot! }
    gates.push(
      pairedGate({
        name: `${baselineSelection.label} vs candidate (acceptance)`,
        baselineLabel: baselineSelection.label,
        candidateLabel: "candidate",
        baselineScenario: gateScenarios.baseline,
        candidateScenario: gateScenarios.candidate,
        baseline: {
          scenario: gateScenarios.baseline,
          runtime: "bun",
          telemetry: false,
          ...base,
          assetRoot: gateNativeAssetRoot!,
        },
        candidate: pinnedCandidate,
        pairs: samples,
        warmup,
        threshold,
        confidence,
        bootstrapSamples,
        seed,
        nativeAssetRoot: gateNativeAssetRoot!,
        forceFailure,
      }),
    )
  }
  if (doGateRecord) {
    gates.push(
      pairedGate({
        name: "telemetry disabled vs enabled (informational)",
        baselineLabel: "disabled",
        candidateLabel: "enabled",
        baselineScenario: scenario,
        candidateScenario: scenario,
        baseline: probeOptions,
        candidate: { ...probeOptions, telemetry: true },
        pairs: samples,
        warmup,
        threshold,
        confidence,
        bootstrapSamples,
        seed: seed ^ 0xa5a5a5a5,
      }),
    )
  }

  mkdirSync(artifactDir, { recursive: true })

  const row = {
    kind: "baseline.cold-import",
    generated: new Date().toISOString(),
    commit,
    mergeBase,
    baseline: doGate
      ? {
          label: baselineSelection.label,
          root: baselineRoot,
          commit: baselineCommit,
          mergeBase,
          scenario: gateScenarios?.baseline,
        }
      : null,
    scenario,
    runtime: {
      engine: runtime,
      version: runtime === "bun" ? process.versions.bun : node!.version,
      executable: runtime === "bun" ? process.execPath : node!.bin,
    },
    source: { candidate: candidateState, baseline: baselineState },
    native: {
      discovered: { candidate: candidateNative, baseline: baselineNative },
      gatePinned: {
        assetRoot: gateNativeAssetRoot,
        candidate: pinnedCandidateNative,
        baseline: pinnedBaselineNative,
      },
    },
    host: {
      platform,
      arch,
      cpu: cpus()[0]?.model ?? "unknown",
      logicalCpus: cpus().length,
      loadAverage: loadavg(),
      uptimeSeconds: uptime(),
      scalingGovernor: readOptional("/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor"),
      intelPstate: readOptional("/sys/devices/system/cpu/intel_pstate/status"),
    },
    workload: {
      geometry: target.render ? "80x24" : null,
      content: target.render ? "TextRenderable('cold-start', 10x1)" : "import-only",
      render: target.render,
      lifecycleProbe: lifecycle !== null,
    },
    protocol: {
      harnessVersion: 6,
      probeVersion: 5,
      warmup,
      samples,
      seed,
      confidence,
      perMetricConfidence: 1 - (1 - confidence) / 2,
      bootstrapSamples,
      thresholdPct: threshold,
      order: "deterministic balanced paired schedule, stratified analysis",
    },
    samples: baselineSamples,
    summary: summarize(baselineSamples),
    lifecycle,
    gates,
  }
  appendFileSync(rawFile, `${JSON.stringify(row)}\n`)
  const rows = readFileSync(rawFile, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
  const reportFile = join(artifactDir, "report.md")
  writeFileSync(reportFile, buildReport(rows, artifact))

  const acceptance = gates.find((gate) => gate.name.includes("acceptance"))
  const failed = acceptance ? !acceptance.passed : false
  console.log(
    JSON.stringify({
      artifact,
      commit: commit.slice(0, 7),
      scenario,
      runtime,
      summary: row.summary,
      gates: gates.map((gate) => ({
        name: gate.name,
        baselineScenario: gate.baselineScenario,
        candidateScenario: gate.candidateScenario,
        passed: gate.passed,
        safety: gate.analysis.safety,
      })),
      failed,
      raw: rawFile,
      report: reportFile,
    }),
  )
  if (failed) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
