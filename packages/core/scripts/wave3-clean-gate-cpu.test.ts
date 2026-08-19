import { describe, test, expect } from "bun:test"
import {
  parseCpuProbeOutput,
  assertCpuProbeValid,
  buildCpuRows,
  computeCpuAnalyses,
  classifyCpuGate,
  type CpuProbeResult,
} from "./wave3-clean-gate-cpu.js"

function probe(
  overrides: Partial<CpuProbeResult> & { role: CpuProbeResult["role"] } = { role: "candidate" },
): CpuProbeResult {
  return {
    schemaVersion: 1,
    role: "candidate",
    root: "/tmp/root",
    revision: "cand123",
    scenario: "cold-1000",
    runtime: { bun: "1.3.14", node: "v24.3.0" },
    nativeSha256: "deadbeef",
    stages: [
      { stage: "contentUpdate", startMs: 0, endMs: 1 },
      { stage: "workerPost", startMs: 1, endMs: 2 },
      { stage: "converter", startMs: 2, endMs: 3 },
      { stage: "safeAppend", startMs: 3, endMs: 4 },
      { stage: "textbuffer", startMs: 4, endMs: 6 },
    ],
    mainThreadSumMs: 6,
    workerWaitMs: 50,
    workerCpuMs: 0,
    updateToStyledCommitMs: 70,
    styledVerified: true,
    nativeFrameDelta: 1,
    counts: { cellsUpdated: 100, highlightCount: 10, chunkCount: 11, setStyledCalls: 0, appendStyledCalls: 1 },
    correctness: { frameSha256: "f", spansSha256: "s", chunksSha256: "c", finalMarkerVisible: true },
    verdict: "PASS",
    ...overrides,
  }
}

function slowProbe(role: CpuProbeResult["role"]): CpuProbeResult {
  // Slower arm: textbuffer window wider so the disjoint stage sum is larger.
  return probe({
    role,
    revision: role === "baseline" ? "base123" : "cand123",
    mainThreadSumMs: 9,
    updateToStyledCommitMs: 100,
    stages: [
      { stage: "contentUpdate", startMs: 0, endMs: 1 },
      { stage: "workerPost", startMs: 1, endMs: 2 },
      { stage: "converter", startMs: 2, endMs: 3 },
      { stage: "safeAppend", startMs: 3, endMs: 4 },
      { stage: "textbuffer", startMs: 4, endMs: 9 },
    ],
  })
}

describe("parseCpuProbeOutput", () => {
  test("parses a valid WAVE3_CPU_RESULT line and validates provenance", () => {
    const output = `WAVE3_WORKER_PERFORMANCE {"averageParseTime":0}\nWAVE3_CPU_RESULT ${JSON.stringify(probe())}\n`
    const parsed = parseCpuProbeOutput(output, {
      role: "candidate",
      root: "/tmp/root",
      revision: "cand123",
      scenario: "cold-1000",
      nativeSha256: "deadbeef",
    })
    expect(parsed.mainThreadSumMs).toBe(6)
    expect(parsed.workerWaitMs).toBe(50)
    expect(parsed.styledVerified).toBe(true)
  })

  test("throws when role/revision/scenario/native do not match the expected arm", () => {
    const output = `WAVE3_CPU_RESULT ${JSON.stringify(probe())}\n`
    expect(() =>
      parseCpuProbeOutput(output, {
        role: "baseline",
        root: "/tmp/root",
        revision: "cand123",
        scenario: "cold-1000",
        nativeSha256: "deadbeef",
      }),
    ).toThrow(/role mismatch/)
  })

  test("throws on a non-PASS verdict from the probe", () => {
    const output = `WAVE3_CPU_RESULT ${JSON.stringify(probe({ verdict: "FAIL" }))}\n`
    expect(() =>
      parseCpuProbeOutput(output, {
        role: "candidate",
        root: "/tmp/root",
        revision: "cand123",
        scenario: "cold-1000",
        nativeSha256: "deadbeef",
      }),
    ).toThrow(/verdict/)
  })

  test("throws when disjoint stage validation fails (probe raced)", () => {
    const staged = probe({
      stages: [
        { stage: "contentUpdate", startMs: 0, endMs: 5 },
        { stage: "workerPost", startMs: 3, endMs: 6 },
        { stage: "converter", startMs: 6, endMs: 8 },
        { stage: "safeAppend", startMs: 8, endMs: 9 },
        { stage: "textbuffer", startMs: 9, endMs: 10 },
      ],
      mainThreadSumMs: 9,
    })
    const output = `WAVE3_CPU_RESULT ${JSON.stringify(staged)}\n`
    expect(() =>
      parseCpuProbeOutput(output, {
        role: "candidate",
        root: "/tmp/root",
        revision: "cand123",
        scenario: "cold-1000",
        nativeSha256: "deadbeef",
      }),
    ).toThrow(/disjoint/)
  })
})

describe("assertCpuProbeValid", () => {
  test("accepts a fully valid green probe", () => {
    expect(() => assertCpuProbeValid(probe())).not.toThrow()
  })
  test("rejects work where mainThreadSumMs exceeds its own disjoint stage sum (worker leak)", () => {
    const bad = probe()
    bad.mainThreadSumMs = 99 // far exceeds the sum of its own disjoint stages (6)
    expect(() => assertCpuProbeValid(bad)).toThrow(/mainThreadSumMs/)
  })
})

describe("buildCpuRows / computeCpuAnalyses", () => {
  test("computes paired per-scenario analyses and rejects digest divergence", () => {
    const baseline = slowProbe("baseline")
    const candidate = probe({
      role: "candidate",
      correctness: {
        frameSha256: "f",
        spansSha256: "s",
        chunksSha256: "c",
        finalMarkerVisible: true,
      },
    })
    const rows = buildCpuRows([
      { pair: 0, order: "baseline-first", scenario: "cold-1000", gapMs: 1, baseline, candidate },
      {
        pair: 1,
        order: "candidate-first",
        scenario: "cold-1000",
        gapMs: 1,
        baseline: slowProbe("baseline"),
        candidate: probe({ role: "candidate" }),
      },
    ])
    expect(rows.length).toBe(2)
    const analysis = computeCpuAnalyses(rows, "cold-1000", "mainThreadSumMs")
    expect(analysis.baseline.p50).toBeCloseTo(9, 0)
    expect(analysis.candidate.p50).toBeCloseTo(6, 0)
    expect(analysis.nominal.pairedChange).toBeLessThan(0) // candidate faster
    expect(analysis.nominal.p99Change ?? analysis.p99Change).toBeLessThan(0)
  })

  test("throws when baseline and candidate output digests diverge", () => {
    const baseline = slowProbe("baseline")
    const candidate = probe({
      role: "candidate",
      correctness: {
        frameSha256: "DIFFERENT",
        spansSha256: "s",
        chunksSha256: "c",
        finalMarkerVisible: true,
      },
    })
    expect(() =>
      buildCpuRows([{ pair: 0, order: "baseline-first", scenario: "cold-1000", gapMs: 1, baseline, candidate }]),
    ).toThrow(/parity failed/)
  })
})

describe("classifyCpuGate", () => {
  test("PASS when all scenarios are measurement-valid and regression-safe", () => {
    const verdict = classifyCpuGate({
      hostLoadExceeded: false,
      allSamplesValid: true,
      digestParity: true,
      scenarios: ["cold-1000"],
      regressionSafe: () => true,
    })
    expect(verdict).toBe("PASS")
  })
  test("FAIL when samples are invalid, digests differ, or regression is detected", () => {
    expect(
      classifyCpuGate({
        hostLoadExceeded: false,
        allSamplesValid: false,
        digestParity: true,
        scenarios: ["cold-1000"],
        regressionSafe: () => true,
      }),
    ).toBe("FAIL")
    expect(
      classifyCpuGate({
        hostLoadExceeded: false,
        allSamplesValid: true,
        digestParity: false,
        scenarios: ["cold-1000"],
        regressionSafe: () => true,
      }),
    ).toBe("FAIL")
    expect(
      classifyCpuGate({
        hostLoadExceeded: false,
        allSamplesValid: true,
        digestParity: true,
        scenarios: ["cold-1000"],
        regressionSafe: () => false,
      }),
    ).toBe("FAIL")
  })
  test("UNCLEAR when host load budget was exceeded", () => {
    expect(
      classifyCpuGate({
        hostLoadExceeded: true,
        allSamplesValid: true,
        digestParity: true,
        scenarios: ["cold-1000"],
        regressionSafe: () => true,
      }),
    ).toBe("UNCLEAR")
  })
})
