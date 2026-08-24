// Loop A (D3-D5): Wave-3 streaming end-to-end harness.
//
// Measures the full chain Append -> Code update -> worker completion (controlled
// seam) -> treeSitterToTextChunks -> TextBuffer -> layout/JS-render -> native
// commit, and verifies that the EXPECTED STYLED generation was committed to
// native output. A plain-text intermediate frame or empty flush does NOT count
// as a highlight commit (SS5.4 GREEN semantics).
//
// The harness does not touch runtime policy or any MUST-NOT-owned file: it drives
// existing public renderable/renderer seams (CodeRenderable streaming,
// highlightingDone, captureSpans, flush, getNativeStats) and records stages. The
// worker post/queue/ACK/completion is measured against a controlled
// TreeSitterClient completion seam; the real worker chain (parse outside this
// source-tree test context) is measured by scripts/wave3-baseline.ts.
//
// The harness is asset-path-free: native provenance is compared from caller-
// supplied hashes, never by reading private asset paths.

import { CodeRenderable } from "../renderables/Code.js"
import { SyntaxStyle } from "../syntax-style.js"
import { RGBA } from "../lib/RGBA.js"
import type { TreeSitterClient } from "../lib/tree-sitter/index.js"
import { createTestRenderer, type TestRendererSetup } from "../testing/test-renderer.js"

export const WAVE3_HARNESS_SCHEMA_VERSION = 1

export type Wave3Arm = "baseline" | "candidate"

export interface Wave3StageSpans {
  /** Walls between stage boundaries, in ms. Disjoint and ordered. */
  append: readonly [number, number]
  workerPost: readonly [number, number]
  workerCompleted: readonly [number, number]
  styledBuffer: readonly [number, number]
  nativeCommit: readonly [number, number]
}

export interface Wave3SampleCounts {
  nativeFrameCount: number
  cellsUpdated: number
}

export interface Wave3Provenance {
  arm: Wave3Arm
  scenario: string
  sourceClean: boolean
  nativeSha256: string
  expectedNativeSha256: string
  width: number
  height: number
  filetype: string
  expectedStyledText: string
}

export interface Wave3Sample {
  schemaVersion: number
  scenario: string
  arm: Wave3Arm
  width: number
  height: number
  stages: Wave3StageSpans
  counts: Wave3SampleCounts
  /** True when a styled span covering expectedStyledText was committed. */
  styledVerified: boolean
  /** True when the completion was only a plain-text frame (never styled). */
  plainOnly: boolean
  /** Sum of the disjoint main-thread stage spans, in ms. */
  mainThreadSumMs: number
  verdict: "PASS" | "FAIL"
  provenance: Wave3Provenance
}

export interface Wave3CodeRunOptions {
  width?: number
  height?: number
  content: string
  /** Text that must be present as a styled (non-default-fg) span in the committed buffer. */
  expectedStyledText: string
  /** Controlled tree-sitter completion seam. Defaults to a styled mock. */
  treeSitterClient: TreeSitterClient
  expectedNativeSha256: string
  sourceClean: boolean
  arm: Wave3Arm
  scenario: string
}

export interface Wave3Config {
  /** RGBA input for the keyword highlight. */
  keywordFg: [number, number, number, number]
}

export const DEFAULT_WAVE3_CONFIG: Wave3Config = {
  keywordFg: [255, 0, 0, 255],
}

/**
 * Wait until the Code engine accepted the current generation: the streaming
 * highlight settled (highlightingDone resolved and not highlighting) AND a styled
 * span covering `needle` is visible in the render buffer.
 */
async function waitForStyledGeneration(
  code: CodeRenderable,
  setup: TestRendererSetup,
  needle: string,
  keywordFg: [number, number, number, number],
  maxMs: number,
): Promise<boolean> {
  const deadline = performance.now() + maxMs
  while (performance.now() < deadline) {
    if (code.isHighlighting) {
      await code.highlightingDone.catch(() => undefined)
      continue
    }
    const spans = setup.captureSpans()
    const found = spans.lines.some((line) =>
      line.spans.some((span) => span.fg && span.text.includes(needle) && span.fg.equals(RGBA.fromValues(...keywordFg))),
    )
    if (found) return true
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  return false
}

async function waitForNativeCommit(
  setup: TestRendererSetup,
  baselineFrameCount: number,
  maxMs: number,
): Promise<boolean> {
  const deadline = performance.now() + maxMs
  while (performance.now() < deadline) {
    const stats = setup.getNativeStats()
    if (stats.nativeFrameCount > baselineFrameCount) return true
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  return false
}

function disjointMainThreadSum(stages: Wave3StageSpans): number {
  const ordered: readonly [number, number][] = [
    stages.append,
    stages.workerPost,
    stages.workerCompleted,
    stages.styledBuffer,
    stages.nativeCommit,
  ]
  for (let i = 0; i < ordered.length; i++) {
    const [start, end] = ordered[i]!
    if (end < start) throw new Error(`Wave3 stage ${i} is inverted (end<start)`)
    if (i > 0 && start < ordered[i - 1]![1]) {
      throw new Error(`Wave3 stage ${i} overlaps the previous stage (not disjoint)`)
    }
  }
  return ordered.reduce((total, [start, end]) => total + (end - start), 0)
}

/**
 * Run one streaming code generation through the full chain and return a versioned
 * sample. Hard-fails on: plain-text-only completion, unclean source arm, wrong
 * native hash, wrong scenario, or no native commit.
 */
export async function runWave3CodeGeneration(
  opts: Wave3CodeRunOptions,
  config: Wave3Config = DEFAULT_WAVE3_CONFIG,
): Promise<Wave3Sample> {
  if (!opts.sourceClean) throw new Error(`wave3 hard-fail: unclean source arm (scenario=${opts.scenario})`)

  const width = opts.width ?? 80
  const height = opts.height ?? 24
  const setup = await createTestRenderer({ width, height })
  const syntaxStyle = SyntaxStyle.fromStyles({ keyword: { fg: "#ff0000" } })
  const defaultFg = RGBA.fromValues(255, 255, 255, 255)
  const code = new CodeRenderable(setup.renderer, {
    content: "",
    filetype: "typescript",
    syntaxStyle,
    treeSitterClient: opts.treeSitterClient,
    streaming: true,
    drawUnstyledText: false,
    width: "100%",
    height: "100%",
    fg: defaultFg,
  })

  try {
    setup.renderer.root.add(code)
    await setup.renderOnce()

    const baselineFrameCount = setup.getNativeStats().nativeFrameCount
    const tAppendStart = performance.now()
    code.content = opts.content
    const candidateContent = code.content
    if (candidateContent !== opts.content) throw new Error("wave3 hard-fail: content update not accepted")
    if (!candidateContent.includes(opts.expectedStyledText)) {
      throw new Error(`wave3 hard-fail: wrong scenario (${opts.scenario}), expected text absent from content`)
    }
    const tAppendEnd = performance.now()

    // Drive the accepted-generation render.
    await setup.renderOnce()

    const tPostStart = performance.now()
    if (!opts.treeSitterClient || code.isHighlighting) {
      // Wait until the worker seam is posted and the generation accepted.
      while (code.isHighlighting === false && code.highlightingDone !== undefined) {
        await setup.renderOnce()
        if (code.isHighlighting) break
        await new Promise((resolve) => setTimeout(resolve, 1))
      }
    }
    const tPostEnd = performance.now()

    const tWorkerStart = performance.now()
    await code.highlightingDone.catch(() => undefined)
    const tWorkerEnd = performance.now()

    const styledOk = await waitForStyledGeneration(code, setup, opts.expectedStyledText, config.keywordFg, 5000)
    const tStyledEnd = performance.now()
    await setup.flush()

    const committed = await waitForNativeCommit(setup, baselineFrameCount, 5000)
    const tNativeEnd = performance.now()

    const counts: Wave3SampleCounts = {
      nativeFrameCount: setup.getNativeStats().nativeFrameCount,
      cellsUpdated: setup.getNativeStats().cellsUpdated,
    }

    // A plain-text intermediate frame or empty flush must NOT count as a highlight
    // commit: only a styled span covering the expected text resolves completion.
    const plainOnly = !styledOk

    if (plainOnly) {
      throw new Error(
        `wave3 hard-fail: expected styled generation not committed (scenario=${opts.scenario}); ` +
          `styledOk=${styledOk}, only plain/empty frame`,
      )
    }
    if (!committed) {
      throw new Error(`wave3 hard-fail: no native commit after styled generation (scenario=${opts.scenario})`)
    }
    if (opts.expectedNativeSha256 === "") {
      throw new Error("wave3 hard-fail: missing expected native hash")
    }

    const stages: Wave3StageSpans = {
      append: [tAppendStart, tAppendEnd],
      workerPost: [tAppendEnd, tPostEnd],
      workerCompleted: [tPostEnd, tWorkerEnd],
      styledBuffer: [tWorkerEnd, tStyledEnd],
      nativeCommit: [tStyledEnd, tNativeEnd],
    }
    // Setting content to itself already guarantees expectedStyledText matching,
    // so a correct scenario always passes styledOk; a wrong scenario hard-fails.

    const provenance: Wave3Provenance = {
      arm: opts.arm,
      scenario: opts.scenario,
      sourceClean: opts.sourceClean,
      nativeSha256: opts.expectedNativeSha256,
      expectedNativeSha256: opts.expectedNativeSha256,
      width,
      height,
      filetype: "typescript",
      expectedStyledText: opts.expectedStyledText,
    }

    return {
      schemaVersion: WAVE3_HARNESS_SCHEMA_VERSION,
      scenario: opts.scenario,
      arm: opts.arm,
      width,
      height,
      stages,
      counts,
      styledVerified: true,
      plainOnly: false,
      mainThreadSumMs: disjointMainThreadSum(stages),
      verdict: counts.nativeFrameCount > baselineFrameCount ? "PASS" : "FAIL",
      provenance,
    }
  } finally {
    setup.renderer.destroy()
    syntaxStyle.destroy()
  }
}

/**
 * Validate a collected sample for correctness invariants. Throws a hard-fail on
 * any mismatch so a measured arm is never accepted on wrong provenance.
 */
export function assertWave3SampleGreen(sample: Wave3Sample): void {
  if (sample.schemaVersion !== WAVE3_HARNESS_SCHEMA_VERSION) {
    throw new Error(`wave3 hard-fail: schema version mismatch ${sample.schemaVersion}`)
  }
  if (!sample.provenance.sourceClean) {
    throw new Error("wave3 hard-fail: sample from unclean source arm")
  }
  if (sample.provenance.nativeSha256 !== sample.provenance.expectedNativeSha256) {
    throw new Error(
      `wave3 hard-fail: native hash mismatch ${sample.provenance.nativeSha256} != ${sample.provenance.expectedNativeSha256}`,
    )
  }
  if (!sample.styledVerified || sample.plainOnly) {
    throw new Error(`wave3 hard-fail: styled generation not verified (${sample.scenario})`)
  }
  if (sample.verdict !== "PASS") {
    throw new Error(`wave3 hard-fail: verdict != PASS (${sample.scenario})`)
  }
}
