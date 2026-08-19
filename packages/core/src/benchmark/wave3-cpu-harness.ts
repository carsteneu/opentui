// Loop B: disjoint main-thread CPU stage measurement for the real worker chain.
//
// A valid main-thread CPU claim must NOT use whole-process process.cpuUsage()
// (it includes the tree-sitter worker) and must NOT include worker wait time in
// the main-thread sum. The stages here are the synchronous main-thread segments
// of one update→styled-commit generation, measured at external public seams
// (identical on both A/B arms). Worker wait and worker CPU are tracked
// separately and explicitly excluded from the sum.

export const WAVE3_CPU_HARNESS_SCHEMA_VERSION = 1

export type Wave3CpuStageName = "contentUpdate" | "workerPost" | "converter" | "safeAppend" | "textbuffer"

export const WAVE3_CPU_STAGE_ORDER: readonly Wave3CpuStageName[] = [
  "contentUpdate",
  "workerPost",
  "converter",
  "safeAppend",
  "textbuffer",
]

export interface Wave3CpuStageSpan {
  stage: Wave3CpuStageName
  startMs: number
  endMs: number
}

export interface Wave3CpuSampleInput {
  stages: readonly Wave3CpuStageSpan[]
  /** Worker wait window between workerPost and converter, never part of the sum. */
  workerWaitMs: number
  /** Worker-internal parse/query CPU reported by the worker, never part of the sum. */
  workerCpuMs: number
  /** Full wall time from content update to the styled native commit. */
  updateToStyledCommitMs: number
  styledVerified: boolean
  nativeFrameDelta: number
}

export type Wave3CpuVerdict = "PASS" | "FAIL" | "UNCLEAR"

/**
 * Validate that the supplied stages are (a) exactly the canonical five in order,
 * (b) each end >= start, and (c) pairwise non-overlapping and non-reversed in
 * time. Returns true when the stages form a valid disjoint main-thread sequence.
 */
export function validateDisjointStages(stages: readonly Wave3CpuStageSpan[]): boolean {
  if (stages.length !== WAVE3_CPU_STAGE_ORDER.length) return false
  for (let index = 0; index < stages.length; index++) {
    const stage = stages[index]!
    if (stage.stage !== WAVE3_CPU_STAGE_ORDER[index]!) return false
    if (!Number.isFinite(stage.startMs) || !Number.isFinite(stage.endMs)) return false
    if (stage.endMs < stage.startMs) return false
    if (index > 0 && stage.startMs < stages[index - 1]!.endMs) return false
  }
  return true
}

/**
 * Return the disjoint main-thread stage durations in canonical order. Throws a
 * descriptive error when the stages do not form a valid disjoint sequence.
 */
export function buildDisjointStages(stages: readonly Wave3CpuStageSpan[]): Wave3CpuStageSpan[] {
  if (!Array.isArray(stages)) throw new Error("stages must be an array")
  for (let index = 0; index < stages.length; index++) {
    const stage = stages[index]!
    if (stage.stage !== WAVE3_CPU_STAGE_ORDER[index]) {
      throw new Error(
        `stage order violation at index ${index}: expected ${WAVE3_CPU_STAGE_ORDER[index]}, got ${stage.stage}`,
      )
    }
    if (!Number.isFinite(stage.startMs) || !Number.isFinite(stage.endMs)) {
      throw new Error(`stage ${stage.stage} has non-finite bounds`)
    }
    if (stage.endMs < stage.startMs) {
      throw new Error(`stage ${stage.stage} is inverted (end<start)`)
    }
    if (index > 0 && stage.startMs < stages[index - 1]!.endMs) {
      throw new Error(`stage ${stage.stage} overlaps the previous stage (not disjoint)`)
    }
  }
  if (stages.length !== WAVE3_CPU_STAGE_ORDER.length) {
    const missing = WAVE3_CPU_STAGE_ORDER.filter((name) => !stages.some((s) => s.stage === name))
    if (missing.length > 0) throw new Error(`missing required stage(s): ${missing.join(", ")}`)
  }
  return [...stages]
}

/**
 * Sum the disjoint main-thread stage durations. Worker wait / worker CPU are
 * not part of the input spans, so they can never enter this sum by construction.
 */
export function computeMainThreadSum(stages: readonly Wave3CpuStageSpan[]): number {
  let total = 0
  for (const stage of stages) total += stage.endMs - stage.startMs
  return total
}

export interface Wave3CpuClassification {
  verdict: Wave3CpuVerdict
  mainThreadSumMs: number
  reasons: string[]
}

/**
 * Classify one sample. PASS requires a valid disjoint stage set, styled output
 * verified, and at least one native frame committed. UNCLEAR covers invalid
 * stage bounds or missing worker attribution (not hard-failed, not passed).
 */
export function classifyWave3CpuResult(input: Wave3CpuSampleInput): Wave3CpuClassification {
  const reasons: string[] = []
  const valid = validateDisjointStages(input.stages)
  if (!valid) reasons.push("stages are not a valid disjoint main-thread sequence")
  if (!(input.styledVerified === true)) reasons.push("final styled generation was not verified")
  if (!(input.nativeFrameDelta >= 1)) reasons.push("no native frame was committed")
  if (!Number.isFinite(input.workerWaitMs) || input.workerWaitMs < 0) {
    reasons.push("worker wait time was not measured")
  }
  if (!Number.isFinite(input.workerCpuMs) || input.workerCpuMs < 0) {
    reasons.push("worker CPU was not measured")
  }
  if (!Number.isFinite(input.updateToStyledCommitMs) || input.updateToStyledCommitMs < 0) {
    reasons.push("update→styled-commit wall time was not measured")
  }

  let verdict: Wave3CpuVerdict
  if (valid && reasons.length === 0 && input.styledVerified && input.nativeFrameDelta >= 1) {
    verdict = "PASS"
  } else if (valid && (input.styledVerified !== true || input.nativeFrameDelta < 1)) {
    verdict = "FAIL"
  } else {
    verdict = "UNCLEAR"
  }
  return { verdict, mainThreadSumMs: valid ? computeMainThreadSum(input.stages) : NaN, reasons }
}
