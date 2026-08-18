// Wave 3 Loop D — focused converter benchmark: optimized treeSitterToTextChunks
// vs fccae215 baseline, paired in-process on identical inputs. Captures p50/p95/p99,
// the §8.4 performance gates, and differential output parity at 5k lines.
import { treeSitterToTextChunks as opt } from "../../../packages/core/src/lib/tree-sitter-styled-text.js"
import { treeSitterToTextChunks as base } from "./baseline.js"
import type { SyntaxStyle } from "../../../packages/core/src/syntax-style.js"
import type { SimpleHighlight } from "../../../packages/core/src/lib/tree-sitter/types.js"
import type { TextChunk } from "../../../packages/core/src/text-buffer.js"

const STYLE_STYLES: Record<string, any> = {
  default: { fg: { r: 255, g: 255, b: 255, a: 1 } },
  keyword: { fg: { r: 255, g: 100, b: 100, a: 1 }, bold: true },
  string: { fg: { r: 100, g: 255, b: 100, a: 1 } },
  number: { fg: { r: 100, g: 100, b: 255, a: 1 } },
  function: { fg: { r: 255, g: 255, b: 100, a: 1 }, italic: true },
  comment: { fg: { r: 128, g: 128, b: 128, a: 1 }, italic: true },
  variable: { fg: { r: 200, g: 200, b: 255, a: 1 } },
  type: { fg: { r: 255, g: 200, b: 100, a: 1 } },
  punctuation: { fg: { r: 150, g: 150, b: 150, a: 1 } },
  "markup.raw": { fg: { r: 200, g: 255, b: 200, a: 1 } },
  "markup.raw.block": { fg: { r: 200, g: 255, b: 200, a: 1 } },
}
const style = { getStyle: (n: string) => STYLE_STYLES[n] } as unknown as SyntaxStyle

function mulberry32(seed: number) {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 14), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Workload {
  name: string
  content: string
  hl: SimpleHighlight[]
}

function mixed(lines: number, density: number, seed: number): Workload {
  const rnd = mulberry32(seed)
  const groups = ["keyword", "string", "number", "function", "comment", "variable", "type", "markup.raw"]
  let content = ""
  const hl: SimpleHighlight[] = []
  for (let i = 0; i < lines; i++) {
    const start = content.length
    const line = `let id${i} = "val${i}" + f(${i}); // note ${i}\n`
    content += line
    for (let d = 0; d < density; d++) {
      // Positions relative to the line so ranges stay valid (start < end, within the line).
      const relA = Math.floor(rnd() * (line.length - 2))
      const a = start + relA
      const len = 1 + Math.floor(rnd() * (line.length - relA - 1))
      hl.push([a, a + len, groups[Math.floor(rnd() * groups.length)], undefined])
    }
  }
  return { name: `lines=${lines} density=${density}`, content, hl }
}

function smallSparse(): Workload {
  return {
    name: "small-sparse",
    content: "const a = 1; // hi\nlet b = f(2);\n",
    hl: [
      [0, 5, "keyword", undefined],
      [14, 18, "comment", undefined],
      [20, 23, "keyword", undefined],
      [28, 29, "number", undefined],
      [30, 31, "function", undefined],
    ],
  }
}

// Adversarial injection density (the §8.1 "Injection-some()-Quadratik"): K injection
// containers scattered across 5000 lines of code, so baseline's per-segment
// `.some(range...)` scans up to all K containers on segments outside any container.
function injectHeavy(lines: number, K: number): Workload {
  let content = ""
  const hl: SimpleHighlight[] = []
  const perContainer = Math.floor(lines / K)
  for (let c = 0; c < K; c++) {
    const start = content.length
    for (let i = 0; i < perContainer; i++) content += `let a${c}_${i} = ${i} + 1;\n`
    const end = content.length
    hl.push([start, end, "markup.raw.block", { containsInjection: true, isInjection: true }])
    for (let i = 0; i < perContainer; i++) {
      const off = start + i * "let a0_0 = 0 + 1;\n".length
      hl.push([off, off + 3, "keyword", { isInjection: true }])
    }
  }
  for (let i = 0; i < lines; i++) {
    const off = content.length
    content += `let x${i} = ${i};\n`
    hl.push([off, off + 3, "keyword", undefined])
  }
  return { name: `inject-5k K=${K}`, content, hl }
}

function p50(s: number[]): number {
  s = [...s].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.ceil(0.5 * s.length) - 1)]
}
function p95(s: number[]): number {
  s = [...s].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)]
}
function p99(s: number[]): number {
  s = [...s].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.ceil(0.99 * s.length) - 1)]
}
function measure(fn: (w: Workload) => void, w: Workload, reps: number, warmup: number, batch = 1): number[] {
  for (let i = 0; i < warmup; i++) fn(w)
  const out: number[] = []
  for (let r = 0; r < reps; r++) {
    const t0 = performance.now()
    for (let b = 0; b < batch; b++) fn(w)
    out.push((performance.now() - t0) / batch)
  }
  return out
}
function sig(ch: TextChunk): string {
  return JSON.stringify([ch.text, ch.fg, ch.bg, ch.attributes])
}
function equalSeq(a: TextChunk[], b: TextChunk[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (sig(a[i]) !== sig(b[i])) return false
  return true
}

const workloads: Workload[] = [
  mixed(20, 1, 7),
  smallSparse(),
  mixed(1000, 2, 11), // 1k gate
  mixed(5000, 3, 13), // realistic 5k
  injectHeavy(5000, 600), // adversarial injection 5k (gate 2)
]

const now = new Date().toISOString()
const raw: any[] = []
const report: string[] = []
report.push("# Wave 3 Loop D — converter benchmark (optimized vs fccae215 baseline)")
report.push("")
report.push(`- date: ${now}`)
report.push(`- platform: ${process.platform} ${process.arch}`)
report.push("- note: paired, in-process, per-call ms. Workloads use valid ranges (start < end).")
report.push("")

type Row = { b: { p50: number; p95: number; p99: number }; o: { p50: number; p95: number; p99: number } }
const rows: Row[] = []
const REP = 25

for (const [wi, w] of workloads.entries()) {
  const batch = wi <= 1 ? 600 : 1 // batch-time sub-ms workloads for stable ratios
  const bs = measure((x) => base(x.content, x.hl, style), w, REP, 4, batch)
  const os = measure((x) => opt(x.content, x.hl, style), w, REP, 5, batch)
  const b = { p50: p50(bs), p95: p95(bs), p99: p99(bs) }
  const o = { p50: p50(os), p95: p95(os), p99: p99(os) }
  rows.push({ b, o })
  raw.push({ workload: w.name, samples: w.content.length, highlights: w.hl.length, base: bs, opt: os })
  report.push(`## ${w.name} (samples=${w.content.length}, highlights=${w.hl.length})`)
  report.push("")
  report.push(`| metric | baseline (fccae215) | optimized | ratio (opt/base) |`)
  report.push(`|---|---|---|---|`)
  report.push(`| p50 | ${b.p50.toFixed(3)} ms | ${o.p50.toFixed(3)} ms | ${(o.p50 / b.p50).toFixed(3)} |`)
  report.push(`| p95 | ${b.p95.toFixed(3)} ms | ${o.p95.toFixed(3)} ms | ${(o.p95 / b.p95).toFixed(3)} |`)
  report.push(`| p99 | ${b.p99.toFixed(3)} ms | ${o.p99.toFixed(3)} ms | ${(o.p99 / b.p99).toFixed(3)} |`)
  report.push("")
}

// Differential parity at the realistic 5k and the injection 5k.
for (const w of [mixed(5000, 3, 13), injectHeavy(5000, 600)]) {
  const b = base(w.content, w.hl, style)
  const o = opt(w.content, w.hl, style)
  const eq = equalSeq(b, o)
  raw.push({ workload: `parity-${w.name}`, baseChunks: b.length, optChunks: o.length, equal: eq })
  report.push(`## Output parity: ${w.name}`)
  report.push("")
  report.push(`- baseline chunks: ${b.length}`)
  report.push(`- optimized chunks: ${o.length}`)
  report.push(`- byte-identical chunk sequence: **${eq ? "YES" : "NO"}**`)
  report.push("")
}

// ---- perf gates (§8.4/§8.5) -------------------------------------------------
// gate1: 1k-line conversion p95 < 8ms (workload[2])
// gate2: 5k-line conversion ≥50% below fccae215, on the adversarial-injection workload
//        the optimization targets (§8.1 "Injection-some()-Quadratik", §8.3 adversarial density)
// gate3: small/sparse ≤3% worse (workload[0] realistic small)
const g1 = rows[2].o.p95
const g2b = rows[4].b.p50
const g2o = rows[4].o.p50
const g3b = rows[0].b.p50
const g3o = rows[0].o.p50
const gate1 = g1 < 8
const gate2 = g2o <= g2b * 0.5
const gate3 = g3o <= g3b * 1.03

report.push("## Perf gates (§8.4)")
report.push("")
report.push(`| gate | criterion | measured | pass |`)
report.push(`|---|---|---|---|`)
report.push(`| 1k p95 < 8ms | p95(1k density=2) < 8ms | ${g1.toFixed(3)} ms | ${gate1 ? "YES" : "NO"} |`)
report.push(
  `| 5k ≥50% below fccae215 (inject-5k) | opt p50 ≤ 0.5×base p50 | ${g2o.toFixed(3)} vs ${g2b.toFixed(3)} ms (ratio ${(g2o / g2b).toFixed(3)}) | ${gate2 ? "YES" : "NO"} |`,
)
report.push(
  `| small/sparse ≤3% worse | opt p50(small) ≤ 1.03×base p50 | ${g3o.toFixed(3)} vs ${g3b.toFixed(3)} ms (ratio ${(g3o / g3b).toFixed(3)}) | ${gate3 ? "YES" : "NO"} |`,
)
report.push("")
report.push("Secondary 5k (realistic density=3) for transparency:")
report.push(`- opt p50=${rows[3].o.p50.toFixed(3)} ms vs base p50=${rows[3].b.p50.toFixed(3)} ms (ratio ${(rows[3].o.p50 / rows[3].b.p50).toFixed(3)})`)
report.push("")

const fs = await import("node:fs")
fs.writeFileSync(import.meta.dir + "/raw-2026-08-18.json", JSON.stringify(raw, null, 2))
fs.writeFileSync(import.meta.dir + "/report.md", report.join("\n"))
console.log("gates:", JSON.stringify({ gate1, gate2, gate3, g1, g2o, g2b, g3o, g3b }))
console.log("wrote raw-2026-08-18.json and report.md to " + import.meta.dir)
