// Wave-3 memory gate (Loop C) — full-n candidate runner.
//
// Runs the three phases at full scale on the candidate, evaluates the §9.5
// single-arm gates, persists raw JSON under .yesmem/bench/wave3-memory/ and
// prints a human-readable summary + verdict. The portability/eventloop A/B
// comparison lives in wave3-memory-portable.ts and is applied to the baseline
// arm separately (see scripts/wave3-memory-ab.ts).
//
// Usage: bun scripts/wave3-memory-gate.ts
//        [--mutations=10000] [--cycles=100] [--burst=200] [--out=<dir>]

import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { execSync } from "node:child_process"
import { TreeSitterClient } from "../src/lib/tree-sitter/index.js"
import {
  evaluateMemoryGates,
  overallVerdict,
  runPhaseASteady,
  runPhaseBLifecycle,
  runPhaseCFaults,
  type MemorySamplesByPhase,
} from "../src/benchmark/wave3-memory-harness.js"

function arg(name: string, fallback: number): number {
  const prefix = `--${name}=`
  const raw = process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length)
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0) throw new Error(`--${name} must be a non-negative number`)
  return value
}

function resultsDir(): string {
  const prefixed = process.argv.find((a) => a.startsWith("--out="))
  if (prefixed) return resolve(prefixed.slice("--out=".length))
  const root = resolve(import.meta.dir, "..", "..", "..", ".yesmem", "bench", "wave3-memory")
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  return join(root, stamp)
}

function readRevision(root: string): string {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: root, encoding: "utf8" }).trim()
  } catch {
    return "unknown"
  }
}

async function run(): Promise<void> {
  const candidateRoot = resolve(import.meta.dir, "..", "..", "..")
  const mutations = arg("mutations", 10_000)
  const cycles = arg("cycles", 100)
  const burst = arg("burst", 200)
  const outDir = resultsDir()

  const dataPath = mkdtempSync(join(tmpdir(), "opentui-wave3-memory-gate-"))
  const makeClient = (): TreeSitterClient => new TreeSitterClient({ dataPath })

  const started = performance.now()

  // Phases are intentionally run sequentially so memory measurements are not
  // contaminated by unrelated concurrent work.
  const steady = await runPhaseASteady(makeClient(), {
    mutations,
    settleEvery: 32,
    fullReplacementEvery: 256,
    windowLines: 1000,
    gcPerWindow: true,
  })
  const lifecycle = await runPhaseBLifecycle(makeClient, { cycles, windowLines: 300 })
  const faults = await runPhaseCFaults(makeClient, { supersedeBurst: burst })

  const samples: MemorySamplesByPhase = { steady, lifecycle, faults }
  const gates = evaluateMemoryGates(samples)
  const verdict = overallVerdict(gates)
  const wallMs = performance.now() - started

  const payload = {
    schemaVersion: 1,
    arm: "candidate",
    revision: readRevision(candidateRoot),
    dataPath,
    startedAt: new Date().toISOString(),
    wallMs,
    samples,
    gates,
    verdict,
  }

  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, "candidate-raw.json"), JSON.stringify(payload, null, 2))
  writeFileSync(join(outDir, "candidate.gates.json"), JSON.stringify({ gates, verdict }, null, 2))

  console.log(`\nWave-3 Memory Gate (Loop C) — candidate`)
  console.log(`revision=${payload.revision} wallMs=${Math.round(wallMs)} windows=${steady.windows.length}`)
  for (const gate of gates) {
    const mark = gate.pass ? "PASS" : "FAIL"
    console.log(`  [${mark}] ${gate.id}`)
    console.log(`        value=${gate.value}`)
    console.log(`        limit=${gate.limit}`)
    console.log(`        ${gate.detail}`)
  }
  console.log(`\nVERDICT: ${verdict}`)
  console.log(`raw: ${join(outDir, "candidate-raw.json")}`)
}

run()
  .catch((error) => {
    console.error("wave3-memory-gate failed:", error)
    process.exitCode = 1
  })
