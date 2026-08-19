// Wave-3 memory gate (Loop C) — A/B coordinator (eventloop-p99 vs baseline).
//
// Runs the portable steady probe on the candidate and baseline arms with
// IDENTICAL parameters (incl. forced-GC regime), then evaluates the §9.5 gate
// "GC-/Eventloop-p99 höchstens +5% gegen fccae215".
//
// The baseline worktree must already contain the two probe files
// (src/benchmark/wave3-memory-portable.ts + wave3-memory-ab-probe.ts); the
// coordinator copies them over if absent, so the arms share a byte-identical
// measurement source.
//
// Usage: bun scripts/wave3-memory-ab.ts
//        BUN_PATH=/path/to/bun
//        [--baseline-root=<path>] [--mutations=2000] [--window-lines=1000]
//        [--settle-every=64] [--gc=1] [--out=<dir>] [--runs=1]

import { spawnSync } from "node:child_process"
import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync } from "node:fs"
import { resolve, join, dirname } from "node:path"

const bun = process.env.BUN_PATH || "bun"

function argString(name: string): string | undefined {
  const prefix = `--${name}=`
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length)
}
function argNumber(name: string, fallback: number): number {
  const raw = argString(name)
  if (raw === undefined) return fallback
  const v = Number(raw)
  return Number.isFinite(v) ? v : fallback
}

const CANDIDATE_ROOT = resolve(import.meta.dir, "..", "..", "..")
const DEFAULT_BASELINE_ROOT = join(dirname(CANDIDATE_ROOT), "wave3-baseline")

interface ProbeOutcome {
  role: string
  revision: string
  eventLoop: { p50: number; p95: number; p99: number; max: number; samples: number }
  heapWindows: number[][]
}

function runProbe(root: string, role: string, out: string): ProbeOutcome {
  if (!existsSync(out)) throw new Error(`probe did not write ${out}`)
  const raw = readFileSync(out, "utf8")
  const data = JSON.parse(raw) as ProbeOutcome & { revision: string; eventLoop: ProbeOutcome["eventLoop"] }
  return { role, revision: data.revision, eventLoop: data.eventLoop, heapWindows: data.heapWindows ?? [] }
}

function main(): void {
  const baselineRootOpt = argString("baseline-root")
  const baselineRoot = baselineRootOpt ? resolve(baselineRootOpt) : DEFAULT_BASELINE_ROOT
  const mutations = argNumber("mutations", 2000)
  const windowLines = argNumber("window-lines", 1000)
  const settleEvery = argNumber("settle-every", 64)
  const gc = argNumber("gc", 1)
  const runs = argNumber("runs", 1)
  const outDir = resolve(argString("out") ?? join(CANDIDATE_ROOT, ".yesmem", "bench", "wave3-memory", "ab"))

  const candidateProbe = join(CANDIDATE_ROOT, "packages/core/src/benchmark/wave3-memory-ab-probe.ts")
  const baselineProbe = join(baselineRoot, "packages/core/src/benchmark/wave3-memory-ab-probe.ts")
  const baselinePortable = join(baselineRoot, "packages/core/src/benchmark/wave3-memory-portable.ts")

  // Ensure the baseline arm carries the byte-identical measurement source.
  if (!existsSync(baselineProbe)) {
    copyFileSync(candidateProbe, baselineProbe)
    copyFileSync(
      join(CANDIDATE_ROOT, "packages/core/src/benchmark/wave3-memory-portable.ts"),
      baselinePortable,
    )
  }

  mkdirSync(outDir, { recursive: true })
  const candidateResults: ProbeOutcome[] = []
  const baselineResults: ProbeOutcome[] = []

  for (let run = 0; run < runs; run++) {
    for (const [root, role, results] of [
      [CANDIDATE_ROOT, "candidate", candidateResults],
      [baselineRoot, "baseline", baselineResults],
    ] as const) {
      const out = join(outDir, `${role}-${run}.json`)
      const result = spawnSync(
        bun,
        [
          join(root, "packages/core/src/benchmark/wave3-memory-ab-probe.ts"),
          `--role=${role}`,
          `--out=${out}`,
          `--mutations=${mutations}`,
          `--window-lines=${windowLines}`,
          `--settle-every=${settleEvery}`,
          `--gc=${gc}`,
        ],
        { cwd: root, encoding: "utf8", env: { ...process.env, BUN_PATH: bun } },
      )
      if (result.status !== 0) {
        throw new Error(`${role} probe failed (status=${result.status}): ${result.stderr}`)
      }
      results.push(runProbe(root, role, out))
    }
  }

  const p99Candidates = candidateResults.map((r) => r.eventLoop.p99)
  const p99Baselines = baselineResults.map((r) => r.eventLoop.p99)
  const med = (a: number[]): number => {
    const s = [...a].sort((x, y) => x - y)
    return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2
  }
  const medCandidateP99 = med(p99Candidates)
  const medBaselineP99 = med(p99Baselines)
  const deltaPct = (medCandidateP99 / Math.max(0.0001, medBaselineP99) - 1) * 100
  const pass = medCandidateP99 <= medBaselineP99 * 1.05

  const summary = {
    schemaVersion: 1,
    candidateRoot: CANDIDATE_ROOT,
    baselineRoot,
    params: { mutations, windowLines, settleEvery, gc, runs },
    candidate: { revisions: candidateResults.map((r) => r.revision), eventLoopP99: p99Candidates, medP99: medCandidateP99 },
    baseline: { revisions: baselineResults.map((r) => r.revision), eventLoopP99: p99Baselines, medP99: medBaselineP99 },
    deltaPct: Number(deltaPct.toFixed(2)),
    gate: "GC-/Eventloop-p99 <= baseline * 1.05",
    pass,
  }
  writeFileSync(join(outDir, "compare.json"), JSON.stringify(summary, null, 2))

  console.log(`Wave-3 Memory A/B (eventloop p99)`)
  console.log(`  candidate (${p99Candidates.join(", ")}ms) med=${medCandidateP99.toFixed(2)}ms`)
  console.log(`  baseline  (${p99Baselines.join(", ")}ms) med=${medBaselineP99.toFixed(2)}ms`)
  console.log(`  delta=${deltaPct.toFixed(2)}%  gate(+5%) => ${pass ? "PASS" : "FAIL"}`)
  console.log(`  compare: ${join(outDir, "compare.json")}`)
  if (!pass) process.exitCode = 1
}

main()
