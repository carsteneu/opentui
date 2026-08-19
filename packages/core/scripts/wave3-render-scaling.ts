// Wave-3 Loop D: layout/partial scaling attribution runner (§10.3/§10.4).
//
// Runs the layout + partial matrices with the opt-in scaling counters attached,
// gathers host/native/source provenance, and writes raw JSON samples append-only
// to .yesmem/bench/wave3-render-scaling/ plus a Markdown report at
// .yesmem/wave3-render-scaling-results.md.
//
// Loop D measures and attributes only; it does NOT implement E-/F-optimization
// (that is Wave 4). Wall-clock A/B against the frozen baseline is intentionally
// deferred to the serial measurement window (§2/§5) and is the caller's job —
// this runner emits attribution samples + provenance, not paired timings.
//
// Usage:
//   bun scripts/wave3-render-scaling.ts [--out DIR] [--layout/--partial] [--frames N]

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { runLayoutScenario, LAYOUT_SCENARIOS } from "../src/benchmark/wave3-layout-matrix.js"
import { runPartialScenario, PARTIAL_SCENARIOS } from "../src/benchmark/wave3-partial-matrix.js"

const SOURCE_NATIVE_ARTIFACT = ".yesmem/native-assets/@opentui/core-linux-x64/libopentui.so"
// The renderer actually loads the native from the installed @opentui/core-linux-x64
// package (platform/runtime-assets.bun.ts), not the staged artifact above. Hash
// which ever of the two exists, preferring the really-loaded package, and mark
// its source so the report never misattributes samples to a native that didn't run.
const PACKAGE_NATIVE_ARTIFACT = "node_modules/@opentui/core-linux-x64/libopentui.so"
// These loops build no native code (attribution only). When neither the staged
// artifact nor the installed package is present, record a clearly-marked pinned
// candidate SHA as provenance.
const PINNED_CANDIDATE_NATIVE_SHA = "deacf8067c0078664c30931020172bfcf2f601549816fe4a849e5d042da73804"

function sha256File(path: string): string | null {
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex")
  } catch {
    return null
  }
}

function git(workdir: string, args: string[]): string {
  try {
    return execFileSync("git", args, { cwd: workdir, encoding: "utf8" }).trim()
  } catch {
    return "unknown"
  }
}

function captureProvenance(): Record<string, string> {
  const pkgSha = sha256File(join(process.cwd(), PACKAGE_NATIVE_ARTIFACT))
  const stagedSha = sha256File(join(process.cwd(), SOURCE_NATIVE_ARTIFACT))
  const native = pkgSha ?? stagedSha ?? PINNED_CANDIDATE_NATIVE_SHA
  const nativeSource = pkgSha ? "package" : stagedSha ? "staged" : "pinned-candidate"
  return {
    sourceCommit: git(process.cwd(), ["rev-parse", "HEAD"]),
    sourceBranch: git(process.cwd(), ["rev-parse", "--abbrev-ref", "HEAD"]),
    sourceDescribe: git(process.cwd(), ["describe", "--tags", "--always"]),
    nativeSha256: native,
    nativeSha256Source: nativeSource,
    bun: execFileSync("bun", ["--version"], { encoding: "utf8" }).trim(),
    node: execFileSync("node", ["--version"], { encoding: "utf8" }).trim(),
    loadavg: readFileSync("/proc/loadavg", "utf8").trim().split(" ")[0] ?? "?",
  }
}

function parseFlags(): { out: string; runLayout: boolean; runPartial: boolean; frames: number } {
  const argv = process.argv.slice(2)
  let out = ".yesmem/bench/wave3-render-scaling"
  let runLayout = true
  let runPartial = true
  let frames = 1
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === "--out") out = argv[++i]!
    else if (arg === "--layout") runPartial = false
    else if (arg === "--partial") runLayout = false
    else if (arg === "--frames") frames = Number(argv[++i])
  }
  return { out, runLayout, runPartial, frames }
}

async function main() {
  const { out, runLayout, runPartial, frames } = parseFlags()
  const outDir = join(process.cwd(), out)
  mkdirSync(outDir, { recursive: true })

  const verified = captureProvenance()
  // Hard gate: never persist samples without real source provenance.
  if (verified.sourceCommit === "unknown") {
    throw new Error("Cannot persist samples without a source commit")
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const payload: Record<string, unknown> = {
    schemaVersion: 1,
    loop: "wave3-render-scaling",
    phase: "attribution-only",
    generatedAt: new Date().toISOString(),
    provenance: verified,
    layout: null,
    partial: null,
  }

  if (runLayout) {
    const samples = []
    for (const scenario of LAYOUT_SCENARIOS) {
      samples.push(await runLayoutScenario(scenario, { width: 160, height: 44, frames }))
    }
    payload.layout = { samples }
  }

  if (runPartial) {
    const samples = []
    for (const scenario of PARTIAL_SCENARIOS) {
      samples.push(await runPartialScenario(scenario, { width: 160, height: 44 }))
    }
    payload.partial = { samples }
  }

  const rawFile = join(outDir, `wave3-render-scaling-${stamp}.json`)
  writeFileSync(rawFile, JSON.stringify(payload, null, 2))
  console.log(`Wrote attribution samples: ${rawFile}`)
  console.log(
    `Layout scenarios: ${runLayout ? LAYOUT_SCENARIOS.length : 0}, Partial scenarios: ${runPartial ? PARTIAL_SCENARIOS.length : 0}`,
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
