import { describe, test, expect } from "bun:test"
import {
  buildDisjointStages,
  computeMainThreadSum,
  validateDisjointStages,
  classifyWave3CpuResult,
  WAVE3_CPU_STAGE_ORDER,
  type Wave3CpuStageSpan,
} from "./wave3-cpu-harness.js"

function span(stage: Wave3CpuStageSpan["stage"], startMs: number, endMs: number): Wave3CpuStageSpan {
  return { stage, startMs, endMs }
}

describe("wave3 cpu harness: disjoint main-thread stage validation", () => {
  test("valid disjoint stages in canonical order pass", () => {
    const stages = [
      span("contentUpdate", 0, 2),
      span("workerPost", 2, 3),
      span("converter", 3, 6),
      span("safeAppend", 6, 7),
      span("textbuffer", 7, 9),
    ]
    expect(validateDisjointStages(stages)).toBe(true)
    expect(computeMainThreadSum(stages)).toBe(2 + 1 + 3 + 1 + 2)
  })

  test("rejects inverted stage (end < start)", () => {
    const stages = [
      span("contentUpdate", 0, 2),
      span("workerPost", 3, 2),
      span("converter", 2, 6),
      span("safeAppend", 6, 7),
      span("textbuffer", 7, 9),
    ]
    expect(validateDisjointStages(stages)).toBe(false)
    expect(() => buildDisjointStages(stages)).toThrow(/inverted/)
  })

  test("rejects overlapping adjacent stages (next.start < prev.end)", () => {
    const stages = [
      span("contentUpdate", 0, 5),
      span("workerPost", 3, 6),
      span("converter", 6, 8),
      span("safeAppend", 8, 9),
      span("textbuffer", 9, 10),
    ]
    expect(validateDisjointStages(stages)).toBe(false)
    expect(() => buildDisjointStages(stages)).toThrow(/overlap/)
  })

  test("rejects out-of-canonical-order stages", () => {
    const stages = [
      span("converter", 0, 2),
      span("contentUpdate", 2, 3),
      span("workerPost", 3, 4),
      span("safeAppend", 4, 5),
      span("textbuffer", 5, 6),
    ]
    expect(validateDisjointStages(stages)).toBe(false)
    expect(() => buildDisjointStages(stages)).toThrow(/order/)
  })

  test("rejects a missing required stage (union incomplete)", () => {
    const stages = [
      span("contentUpdate", 0, 1),
      span("workerPost", 1, 2),
      span("converter", 2, 3),
      span("safeAppend", 3, 4),
    ]
    expect(validateDisjointStages(stages)).toBe(false)
    expect(() => buildDisjointStages(stages)).toThrow(/required/)
  })

  test("empty/identity span for a stage is allowed (zero measurable time)", () => {
    const stages = [
      span("contentUpdate", 0, 2),
      span("workerPost", 2, 2),
      span("converter", 2, 4),
      span("safeAppend", 4, 5),
      span("textbuffer", 5, 6),
    ]
    expect(validateDisjointStages(stages)).toBe(true)
  })
})

describe("wave3 cpu harness: main-thread sum excludes worker wait", () => {
  test("worker wait / worker cpu are not part of the main-thread stage sum", () => {
    const stages = [
      span("contentUpdate", 0, 1),
      span("workerPost", 1, 2),
      span("converter", 20, 23), // window gap 2..20 is worker wait
      span("safeAppend", 23, 24),
      span("textbuffer", 24, 25),
    ]
    const sum = computeMainThreadSum(stages)
    // Gap between workerPost.end (2) and converter.start (20) must NOT be summed.
    expect(sum).toBe(1 + 1 + 3 + 1 + 1)
  })
})

describe("wave3 cpu harness: classification", () => {
  test("PASS when styled verified and a native frame was committed", () => {
    const result = classifyWave3CpuResult({
      styledVerified: true,
      nativeFrameDelta: 1,
      stages: [
        span("contentUpdate", 0, 1),
        span("workerPost", 1, 2),
        span("converter", 2, 3),
        span("safeAppend", 3, 4),
        span("textbuffer", 4, 5),
      ],
      workerWaitMs: 10,
      workerCpuMs: 8,
      updateToStyledCommitMs: 30,
    })
    expect(result.verdict).toBe("PASS")
  })

  test("FAIL when styled output was never verified (plain-text intermediate)", () => {
    const result = classifyWave3CpuResult({
      styledVerified: false,
      nativeFrameDelta: 1,
      stages: [
        span("contentUpdate", 0, 1),
        span("workerPost", 1, 2),
        span("converter", 2, 3),
        span("safeAppend", 3, 4),
        span("textbuffer", 4, 5),
      ],
      workerWaitMs: 10,
      workerCpuMs: 8,
      updateToStyledCommitMs: 30,
    })
    expect(result.verdict).toBe("FAIL")
  })

  test("FAIL when no native frame was committed", () => {
    const result = classifyWave3CpuResult({
      styledVerified: true,
      nativeFrameDelta: 0,
      stages: [
        span("contentUpdate", 0, 1),
        span("workerPost", 1, 2),
        span("converter", 2, 3),
        span("safeAppend", 3, 4),
        span("textbuffer", 4, 5),
      ],
      workerWaitMs: 10,
      workerCpuMs: 8,
      updateToStyledCommitMs: 30,
    })
    expect(result.verdict).toBe("FAIL")
  })

  test("UNCLEAR when stages are not disjoint-valid or worker attribution is missing", () => {
    const result = classifyWave3CpuResult({
      styledVerified: true,
      nativeFrameDelta: 1,
      stages: [
        span("contentUpdate", 0, 5),
        span("workerPost", 3, 6), // overlap
        span("converter", 6, 8),
        span("safeAppend", 8, 9),
        span("textbuffer", 9, 10),
      ],
      workerWaitMs: NaN, // worker wait not measured
      workerCpuMs: NaN,
      updateToStyledCommitMs: 40,
    })
    expect(result.verdict).toBe("UNCLEAR")
  })
})

describe("wave3 cpu harness: stage order contract", () => {
  test("canonical order covers the five main-thread stages exactly once", () => {
    expect(WAVE3_CPU_STAGE_ORDER).toEqual(["contentUpdate", "workerPost", "converter", "safeAppend", "textbuffer"])
  })
})
