import { describe, expect, test } from "bun:test"
import {
  parseProbeOutput,
  summarize,
  validateNativeArtifacts,
  WAVE3_CLEAN_GATE_SCHEMA_VERSION,
} from "./wave3-clean-gate.js"
import { makeWarmAppendWorkload } from "./wave3-real-worker-workload.js"

const expected = {
  role: "baseline" as const,
  root: "/tmp/base",
  revision: "abc",
  scenario: "cold-1000" as const,
  nativeSha256: "native",
}

function validResult() {
  return {
    schemaVersion: WAVE3_CLEAN_GATE_SCHEMA_VERSION,
    ...expected,
    runtime: { bun: "1.3.14", node: "v24" },
    timings: {
      setterMs: 1,
      renderKickWallMs: 2,
      workerAndPipelineWallMs: 3,
      commitRenderWallMs: 4,
      updateToStyledCommitMs: 10,
      converterMs: 2,
      processCpuUserMicros: 100,
      processCpuSystemMicros: 20,
    },
    counts: { nativeFrameDelta: 1, cellsUpdated: 10, highlightCount: 2, chunkCount: 3 },
    correctness: {
      styledVerified: true,
      finalMarkerVisible: true,
      frameSha256: "frame",
      spansSha256: "spans",
      chunksSha256: "chunks",
    },
  }
}

describe("wave3 clean gate evidence parser", () => {
  test("warm streaming workload consists exclusively of monotonic appends", () => {
    const workload = makeWarmAppendWorkload(1000, 100)
    let previous = workload.initial
    for (const update of workload.updates) {
      expect(update.startsWith(previous)).toBe(true)
      expect(update.length).toBeGreaterThan(previous.length)
      previous = update
    }
    expect(workload.updates).toHaveLength(100)
    expect(workload.updates.at(-1)).toContain(workload.finalMarker)
  })

  test("accepts exactly matching, styled, native-committed evidence", () => {
    const output = `diagnostic\nWAVE3_RESULT ${JSON.stringify(validResult())}\n`
    expect(parseProbeOutput(output, expected).timings.updateToStyledCommitMs).toBe(10)
  })

  test("rejects wrong provenance and false-positive completion", () => {
    const wrongRevision = { ...validResult(), revision: "wrong" }
    expect(() => parseProbeOutput(`WAVE3_RESULT ${JSON.stringify(wrongRevision)}`, expected)).toThrow(
      /revision mismatch/,
    )

    const plainOnly = { ...validResult(), correctness: { ...validResult().correctness, styledVerified: false } }
    expect(() => parseProbeOutput(`WAVE3_RESULT ${JSON.stringify(plainOnly)}`, expected)).toThrow(/final styled/)
  })

  test("uses interpolated even-sample percentiles", () => {
    expect(summarize([1, 2, 3, 4])).toEqual({ n: 4, p50: 2.5, p95: 3.8499999999999996, p99: 3.9699999999999998 })
  })

  test("requires identical native artifacts by default and pins both arms for native comparisons", () => {
    expect(() => validateNativeArtifacts("identical", "base", "candidate")).toThrow(/SHA differs/)
    expect(validateNativeArtifacts("per-arm", "base", "candidate")).toEqual({
      policy: "per-arm",
      baselineSha256: "base",
      candidateSha256: "candidate",
    })
  })
})
