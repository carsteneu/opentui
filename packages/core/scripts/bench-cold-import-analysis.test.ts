import { describe, expect, test } from "bun:test"
import { analyzeColdImportPairs, createColdImportSchedule, type ColdImportPair } from "./bench-cold-import-analysis.js"

function pairs(importRatio: number, ttfmRatio: number, count = 20): ColdImportPair[] {
  return createColdImportSchedule(count, 42).map(({ pair, order }) => ({
    pair,
    order,
    gapMs: 0.1,
    baseline: { importMs: 100 + pair, ttfmMs: 120 + pair },
    candidate: { importMs: (100 + pair) * importRatio, ttfmMs: (120 + pair) * ttfmRatio },
  }))
}

describe("cold-import paired analysis", () => {
  test("creates a deterministic schedule with balanced execution order", () => {
    const first = createColdImportSchedule(10, 7)
    const second = createColdImportSchedule(10, 7)

    expect(first).toEqual(second)
    expect(first.filter((entry) => entry.order === "baseline-first")).toHaveLength(5)
    expect(first.filter((entry) => entry.order === "candidate-first")).toHaveLength(5)
    expect(() => createColdImportSchedule(9, 7)).toThrow("even pair count")
  })

  test("passes only when both confidence bounds fit the regression budget", () => {
    const result = analyzeColdImportPairs(pairs(1.02, 1.01), {
      bootstrapSamples: 1_000,
      seed: 7,
    })

    expect(result.safety.metricPasses).toEqual({ importMs: true, ttfmMs: true })
    expect(result.safety.perMetricConfidence).toBe(0.975)
    expect(result.safety.passed).toBe(true)
  })

  test("fails the complete gate when either metric exceeds the budget", () => {
    const result = analyzeColdImportPairs(pairs(1.04, 1.01), {
      bootstrapSamples: 1_000,
      seed: 7,
    })

    expect(result.safety.metricPasses).toEqual({ importMs: false, ttfmMs: true })
    expect(result.safety.passed).toBe(false)
  })

  test("requires enough balanced pairs before declaring a pass", () => {
    const result = analyzeColdImportPairs(pairs(1, 1, 8), {
      bootstrapSamples: 100,
      seed: 7,
    })

    expect(result.safety.enoughPairs).toBe(false)
    expect(result.safety.passed).toBe(false)
  })
})
