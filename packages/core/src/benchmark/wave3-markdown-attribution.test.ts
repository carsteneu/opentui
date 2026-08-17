import { describe, test, expect } from "bun:test"
import {
  analyzeMarkdownStreaming,
  buildMarkdownCorpus,
  classifyTail,
  WAVE3_MARKDOWN_SCHEMA_VERSION,
  type MarkdownStepRecord,
  type TailClass,
} from "./wave3-markdown-attribution.js"
import { parseMarkdownIncremental } from "../renderables/markdown-parser.js"

const CATEGORIES = ["prose", "block", "fence", "list", "table"] as const

describe("wave3 markdown attribution", () => {
  test("corpus builders respect the byte budget for every category", () => {
    for (const category of CATEGORIES) {
      const corpus = buildMarkdownCorpus(category, 2048)
      expect(corpus.length).toBeGreaterThanOrEqual(1024)
      expect(corpus.length).toBeLessThanOrEqual(2048 + 256)
    }
  })

  test("incremental streaming preserves stable token refs across sizes", () => {
    for (const category of CATEGORIES) {
      for (const bytes of [1024, 8192]) {
        const report = analyzeMarkdownStreaming(category, bytes, 16)
        expect(report.schemaVersion).toBe(WAVE3_MARKDOWN_SCHEMA_VERSION)
        expect(report.category).toBe(category)
        expect(report.finalContentBytes).toBeLessThanOrEqual(bytes)
        expect(report.aggregate.allStableRefsPreserved).toBe(true)
        expect(report.steps.length).toBeGreaterThanOrEqual(2)
      }
    }
  })

  test("later incremental steps reuse tokens (stableReuseRatio >= 0) and tail classes sum to steps", () => {
    const report = analyzeMarkdownStreaming("prose", 4096, 8)
    const tailTotal = Object.values(report.aggregate.tailClassCounts).reduce((a, b) => a + b, 0)
    expect(tailTotal).toBe(report.steps.length)
    for (const step of report.steps.slice(1)) {
      expect(step.stableReuseRatio).toBeGreaterThanOrEqual(0)
    }
  })

  test("every reported tail class is valid and first step is a full parse", () => {
    const valid: TailClass[] = ["inline-lex-0", "inline-lex-1", "block-lex", "stable-prefix", "full-parse"]
    const report = analyzeMarkdownStreaming("table", 4096, 8)
    expect(report.steps[0]!.tailClass).toBe("full-parse")
    for (const step of report.steps) expect(valid).toContain(step.tailClass)
  })

  test("classifyTail distinguishes inline tail reuse from structural additions", () => {
    // Extending a paragraph with a stable heading prefix re-lexes only the inline tail.
    const first = parseMarkdownIncremental("# Heading\n\nA paragraph", null)
    const second = parseMarkdownIncremental("# Heading\n\nA paragraph grows", first)
    expect(["inline-lex-0", "inline-lex-1"]).toContain(classifyTail(first, second))

    // Appending a new structural (block) heading is not a pure inline tail reuse.
    const other = parseMarkdownIncremental("# Heading\n\nA paragraph grows\n\n## New heading\n", second)
    const structural = classifyTail(second, other)
    expect(["stable-prefix", "block-lex"]).toContain(structural)
  })
})
