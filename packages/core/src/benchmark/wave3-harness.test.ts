import { describe, test, expect } from "bun:test"
import { runWave3CodeGeneration, assertWave3SampleGreen, WAVE3_HARNESS_SCHEMA_VERSION } from "./wave3-harness.js"
import { MockTreeSitterClient } from "../testing/mock-tree-sitter-client.js"

const HASH = "e7e9764462f2ee7f2c808856b60101ff659c6bda4a1df7cf235e418cf481a15c"

function styledClient(keywordStart: number, keywordEnd: number): MockTreeSitterClient {
  const client = new MockTreeSitterClient({ autoResolveTimeout: 2 })
  client.setMockResult({ highlights: [[keywordStart, keywordEnd, "keyword"] as [number, number, string]] })
  return client
}

describe("wave3 streaming e2e harness", () => {
  test("GREEN: full chain commits the expected styled generation with disjoint stages", async () => {
    const content = "const VALUE: number = 42\n"
    const client = styledClient(6, 11)
    try {
      const sample = await runWave3CodeGeneration({
        content,
        expectedStyledText: "VALUE",
        treeSitterClient: client,
        expectedNativeSha256: HASH,
        sourceClean: true,
        arm: "baseline",
        scenario: "code-stream:80x24:1-line",
      })
      expect(sample.schemaVersion).toBe(WAVE3_HARNESS_SCHEMA_VERSION)
      expect(sample.styledVerified).toBe(true)
      expect(sample.plainOnly).toBe(false)
      expect(sample.verdict).toBe("PASS")
      expect(sample.mainThreadSumMs).toBeGreaterThanOrEqual(0)
      const ordered = [
        sample.stages.append,
        sample.stages.workerPost,
        sample.stages.workerCompleted,
        sample.stages.styledBuffer,
        sample.stages.nativeCommit,
      ]
      for (let i = 0; i < ordered.length; i++) {
        expect(ordered[i]![1]).toBeGreaterThanOrEqual(ordered[i]![0])
        if (i > 0) expect(ordered[i]![0]).toBeGreaterThanOrEqual(ordered[i - 1]![1])
      }
      expect(sample.counts.nativeFrameCount).toBeGreaterThan(0)
      expect(() => assertWave3SampleGreen(sample)).not.toThrow()
    } finally {
      await client.destroy()
    }
  })

  test("hard-fail: unclean source arm", async () => {
    const content = "const VALUE: number = 42\n"
    const client = styledClient(6, 11)
    try {
      await expect(
        runWave3CodeGeneration({
          content,
          expectedStyledText: "VALUE",
          treeSitterClient: client,
          expectedNativeSha256: HASH,
          sourceClean: false,
          arm: "baseline",
          scenario: "code-stream:80x24:1-line",
        }),
      ).rejects.toThrow(/unclean source arm/)
    } finally {
      await client.destroy()
    }
  })

  test("hard-fail: wrong scenario (expected text absent)", async () => {
    const content = "const VALUE: number = 42\n"
    const client = styledClient(6, 11)
    try {
      await expect(
        runWave3CodeGeneration({
          content,
          expectedStyledText: "MISSING_TOKEN",
          treeSitterClient: client,
          expectedNativeSha256: HASH,
          sourceClean: true,
          arm: "baseline",
          scenario: "code-stream:80x24:1-line",
        }),
      ).rejects.toThrow(/wrong scenario/)
    } finally {
      await client.destroy()
    }
  })

  test("assertWave3SampleGreen hard-fails on native hash mismatch", async () => {
    const sample = await runWave3CodeGeneration({
      content: "const VALUE: number = 42\n",
      expectedStyledText: "VALUE",
      treeSitterClient: styledClient(6, 11),
      expectedNativeSha256: HASH,
      sourceClean: true,
      arm: "baseline",
      scenario: "code-stream:80x24:1-line",
    })
    sample.provenance.nativeSha256 = "0000000000000000000000000000000000000000000000000000000000000000"
    expect(() => assertWave3SampleGreen(sample)).toThrow(/native hash mismatch/)
  })

  test("assertWave3SampleGreen hard-fails on plain-text-only sample", async () => {
    const styled = await runWave3CodeGeneration({
      content: "const VALUE: number = 42\n",
      expectedStyledText: "VALUE",
      treeSitterClient: styledClient(6, 11),
      expectedNativeSha256: HASH,
      sourceClean: true,
      arm: "baseline",
      scenario: "code-stream:80x24:1-line",
    })
    styled.styledVerified = false
    styled.plainOnly = true
    styled.verdict = "FAIL"
    expect(() => assertWave3SampleGreen(styled)).toThrow(/styled generation not verified/)
  })
})
