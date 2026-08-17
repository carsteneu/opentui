// Loop A (D3-D5): Markdown streaming attribution.
//
// Measures parseMarkdownIncremental behavior from 1k to 100k bytes across
// prose/block/fence/list/table, classifying the unstable tail (0/1 inline-lex,
// block-lex, stable-prefix reuse) and verifying that stable tokens keep their
// object references across incremental parses. Layout/render-list and native
// commit attribution is reported by the Wave-3 E2E harness separately
// (wave3-harness.ts). Per SS5.5 no parser optimization is performed here.

import { parseMarkdownIncremental, type ParseState } from "../renderables/markdown-parser.js"

export type MarkdownCategory = "prose" | "block" | "fence" | "list" | "table"

export type TailClass = "inline-lex-0" | "inline-lex-1" | "block-lex" | "stable-prefix" | "full-parse"

export interface MarkdownStepRecord {
  step: number
  contentBytes: number
  tokens: number
  stableTokenCount: number
  stableReuseRatio: number
  parseDurationMs: number
  tailClass: TailClass
  stableRefsPreserved: boolean
}

export interface MarkdownAttributionReport {
  schemaVersion: number
  category: MarkdownCategory
  finalContentBytes: number
  steps: MarkdownStepRecord[]
  aggregate: {
    meanParseDurationMs: number
    meanStableReuseRatio: number
    tailClassCounts: Partial<Record<TailClass, number>>
    allStableRefsPreserved: boolean
  }
}

export const WAVE3_MARKDOWN_SCHEMA_VERSION = 1

/** Build a markdown corpus of roughly `bytes` for the given category. */
export function buildMarkdownCorpus(category: MarkdownCategory, bytes: number): string {
  const units: Record<MarkdownCategory, string[]> = {
    prose: [
      "# Heading one\n",
      "A paragraph with **bold**, *italic*, and `inline code` and a trailing sentence that keeps the paragraph open.\n\n",
    ],
    block: [
      "> A blockquote line spanning enough text to count toward the byte budget.\n>\n",
      "```\n<div class=\"x\">\n```\n\n",
    ],
    fence: [
      "```js\nconst a = 1; function f() { return a + 2 }\n```\n\n",
      "    indent    ed code line with enough width to consume bytes\n",
    ],
    list: [
      "- item with a **bold** span and more descriptive text to fill the line.\n",
      "1. numbered item continuing the ordered list across many entries.\n",
    ],
    table: [
      "| a | b | c |\n| - | - | - |\n| 1 | 2 | 3 |\n\n",
      "| left | center | right |\n| :--- | :---: | ---: |\n| x | y | z |\n\n",
    ],
  }

  const parts = units[category]!
  let out = ""
  while (out.length < bytes) {
    out += parts[Math.floor(Math.random() * parts.length)]!
  }
  return out.slice(0, bytes)
}

/** Classify whether a single-step incremental parse only re-lexed an inline tail. */
export function classifyTail(prev: ParseState, next: ParseState): TailClass {
  const nextTokens = next.tokens
  const prevTokens = prev.tokens
  if (nextTokens.length === 0 && prevTokens.length > 0) return "full-parse"

  // Prefix length over structurally equal leading tokens (by raw content).
  let prefix = 0
  while (
    prefix < prevTokens.length &&
    prefix < nextTokens.length &&
    prevTokens[prefix]!.raw === nextTokens[prefix]!.raw
  ) {
    prefix++
  }

  if (prefix === nextTokens.length && prefix === prevTokens.length) return "inline-lex-0"
  const lastNext = nextTokens[nextTokens.length - 1]
  if (lastNext?.type === "paragraph" && prefix >= 1) return "inline-lex-1"
  if (prefix >= 1) return "stable-prefix"
  return "block-lex"
}

/**
 * Run an incremental parse over a corpus in `chunks` pieces. Always produces an
 * authoritative full parse on the first step and incremental steps afterwards.
 */
export function analyzeMarkdownStreaming(
  category: MarkdownCategory,
  totalBytes: number,
  chunks = 32,
): MarkdownAttributionReport {
  const content = buildMarkdownCorpus(category, totalBytes)
  const stepSize = Math.max(1, Math.ceil(content.length / chunks))
  const steps: MarkdownStepRecord[] = []

  let prev: ParseState | null = null
  let prevRefs: readonly unknown[] = []
  for (let offset = 0; offset < content.length; offset += stepSize) {
    const slice = content.slice(0, Math.min(content.length, offset + stepSize))
    const t0 = performance.now()
    const state = parseMarkdownIncremental(slice, prev)
    const duration = performance.now() - t0

    let stableRefsPreserved = true
    const stableCount = state.stableTokenCount ?? state.tokens.length
    for (let i = 0; i < Math.min(prevRefs.length, stableCount); i++) {
      if (state.tokens[i] !== prevRefs[i]) stableRefsPreserved = false
    }

    steps.push({
      step: steps.length,
      contentBytes: slice.length,
      tokens: state.tokens.length,
      stableTokenCount: stableCount,
      stableReuseRatio: state.tokens.length === 0 ? 0 : stableCount / state.tokens.length,
      parseDurationMs: duration,
      tailClass: prev ? classifyTail(prev, state) : "full-parse",
      stableRefsPreserved,
    })

    prevRefs = state.tokens
    prev = state
  }

  const tailClassCounts: Partial<Record<TailClass, number>> = {}
  for (const step of steps) {
    tailClassCounts[step.tailClass] = (tailClassCounts[step.tailClass] ?? 0) + 1
  }

  return {
    schemaVersion: WAVE3_MARKDOWN_SCHEMA_VERSION,
    category,
    finalContentBytes: content.length,
    steps,
    aggregate: {
      meanParseDurationMs: steps.reduce((sum, s) => sum + s.parseDurationMs, 0) / steps.length,
      meanStableReuseRatio:
        steps.reduce((sum, s) => sum + s.stableReuseRatio, 0) / (steps.length || 1),
      tailClassCounts,
      allStableRefsPreserved: steps.every((s) => s.stableRefsPreserved),
    },
  }
}
