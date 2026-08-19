import { describe, test, expect } from "bun:test"
import {
  parseStartupProbeOutput,
  buildStartupPairs,
  summarize,
  quantileChangeBootstrap,
  classifyStartupGate,
  type StartupProbeResult,
  type StartupPair,
} from "./wave3-startup-gate.js"

function probe(role: StartupProbeResult["role"], importMs: number, ttfmMs: number): StartupProbeResult {
  return {
    schemaVersion: 1,
    role,
    root: "/tmp/root",
    revision: role === "baseline" ? "base123" : "cand123",
    scenario: "renderer-entry",
    runtime: { bun: "1.3.14", node: "v24.3.0" },
    nativeSha256: role === "baseline" ? "bb" : "cc",
    importMs,
    ttfmMs,
    nativeLoadedMs: 0,
    correct: true,
  }
}

describe("parseStartupProbeOutput", () => {
  test("parses valid result and validates provenance", () => {
    const out = `WAVE3_STARTUP_RESULT ${JSON.stringify(probe("candidate", 30, 148))}\n`
    const parsed = parseStartupProbeOutput(out, {
      role: "candidate",
      root: "/tmp/root",
      revision: "cand123",
      scenario: "renderer-entry",
      nativeSha256: "cc",
    })
    expect(parsed.importMs).toBe(30)
    expect(parsed.ttfmMs).toBe(148)
  })
  test("throws on role mismatch or incorrect render", () => {
    const out = `WAVE3_STARTUP_RESULT ${JSON.stringify(probe("candidate", 30, 148))}\n`
    expect(() =>
      parseStartupProbeOutput(out, {
        role: "baseline",
        root: "/tmp/root",
        revision: "cand123",
        scenario: "renderer-entry",
        nativeSha256: "cc",
      }),
    ).toThrow(/role mismatch/)
  })
})

describe("summarize", () => {
  test("computes p50/p95/p99", () => {
    const s = summarize([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(s.n).toBe(10)
    expect(s.p50).toBeCloseTo(5.5)
    expect(s.p95).toBeTruthy()
  })
})

describe("buildStartupPairs / quantileChangeBootstrap", () => {
  test("builds pairs and yields a negative (faster) p95 change", () => {
    const pairs = buildStartupPairs([
      {
        pair: 0,
        order: "baseline-first",
        gapMs: 1,
        baseline: probe("baseline", 30, 150),
        candidate: probe("candidate", 30, 120),
      },
      {
        pair: 1,
        order: "candidate-first",
        gapMs: 1,
        baseline: probe("baseline", 32, 155),
        candidate: probe("candidate", 31, 118),
      },
      {
        pair: 2,
        order: "baseline-first",
        gapMs: 1,
        baseline: probe("baseline", 33, 160),
        candidate: probe("candidate", 29, 122),
      },
      {
        pair: 3,
        order: "candidate-first",
        gapMs: 1,
        baseline: probe("baseline", 34, 158),
        candidate: probe("candidate", 30, 119),
      },
    ])
    const obs = pairs.map((p) => ({ order: p.order, baseline: p.baseline.ttfmMs!, candidate: p.candidate.ttfmMs! }))
    const q = quantileChangeBootstrap(obs, 0.5, 2000, 0.95, 42)
    expect(q.change).toBeLessThan(0)
    expect(q.ci.lower).toBeLessThan(0)
    expect(q.ci.upper).toBeLessThan(0)
  })
})

describe("classifyStartupGate", () => {
  test("PASS when every metric is within the p50/p95 +3% and p99 +5% budget", () => {
    const verdict = classifyStartupGate({
      hostLoadExceeded: false,
      enoughPairs: true,
      importMs: { p50: -0.05, p95: -0.04, p99: -0.02 },
      ttfmMs: { p50: -0.16, p95: -0.12, p99: -0.05 },
      familywiseMaxRegression: 0.03,
      familywiseMaxRegressionP99: 0.05,
    })
    expect(verdict).toBe("PASS")
  })
  test("FAIL when p50/p95 familywise upper exceeds +3%", () => {
    expect(
      classifyStartupGate({
        hostLoadExceeded: false,
        enoughPairs: true,
        importMs: { p50: 0.04, p95: 0.03, p99: 0.0 },
        ttfmMs: { p50: 0.0, p95: 0.0, p99: 0.0 },
        familywiseMaxRegression: 0.03,
        familywiseMaxRegressionP99: 0.05,
      }),
    ).toBe("FAIL")
  })
  test("FAIL when p99 exceeds +5%", () => {
    expect(
      classifyStartupGate({
        hostLoadExceeded: false,
        enoughPairs: true,
        importMs: { p50: 0.0, p95: 0.0, p99: 0.06 },
        ttfmMs: { p50: 0.0, p95: 0.0, p99: 0.0 },
        familywiseMaxRegression: 0.03,
        familywiseMaxRegressionP99: 0.05,
      }),
    ).toBe("FAIL")
  })
  test("UNCLEAR when host load budget was exceeded", () => {
    expect(
      classifyStartupGate({
        hostLoadExceeded: true,
        enoughPairs: true,
        importMs: { p50: 0, p95: 0, p99: 0 },
        ttfmMs: { p50: 0, p95: 0, p99: 0 },
        familywiseMaxRegression: 0.03,
        familywiseMaxRegressionP99: 0.05,
      }),
    ).toBe("UNCLEAR")
  })
  test("FAIL when pair count is below the minimum", () => {
    expect(
      classifyStartupGate({
        hostLoadExceeded: false,
        enoughPairs: false,
        importMs: { p50: 0, p95: 0, p99: 0 },
        ttfmMs: { p50: 0, p95: 0, p99: 0 },
        familywiseMaxRegression: 0.03,
        familywiseMaxRegressionP99: 0.05,
      }),
    ).toBe("FAIL")
  })
})

export type { StartupProbeResult, StartupPair }
