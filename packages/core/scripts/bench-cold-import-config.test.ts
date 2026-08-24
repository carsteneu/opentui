import { describe, expect, test } from "bun:test"
import { resolve } from "node:path"
import {
  resolveBaselineSelection,
  resolveGateScenarios,
  scenarioTarget,
  scenarioUsesCommittedFrame,
} from "./bench-cold-import-config.js"

const repositoryRoot = resolve(import.meta.dir, "..", "..", "..")

describe("cold-import benchmark configuration", () => {
  test("Bun renderer entry measures a committed frame while renderable entry stays import-only", () => {
    expect(scenarioUsesCommittedFrame("renderer-entry", "bun")).toBe(true)
    expect(scenarioTarget(repositoryRoot, "renderer-entry", "bun")).toMatchObject({
      entry: resolve(repositoryRoot, "packages/core/src/renderer-entry.ts"),
      render: true,
    })

    expect(scenarioUsesCommittedFrame("renderable-entry", "bun")).toBe(false)
    expect(scenarioTarget(repositoryRoot, "renderable-entry", "bun")).toMatchObject({
      entry: resolve(repositoryRoot, "packages/core/src/renderable-entry.ts"),
      render: false,
    })
  })

  test("Node and dist scenarios remain import-only", () => {
    expect(scenarioUsesCommittedFrame("renderer-entry", "node")).toBe(false)
    expect(scenarioUsesCommittedFrame("dist", "bun")).toBe(false)
  })

  test("keeps fastpatch as the compatible default baseline", () => {
    expect(resolveBaselineSelection({}, repositoryRoot)).toEqual({
      root: resolve(repositoryRoot, "..", "fastpatch"),
      label: "fastpatch",
      explicit: false,
    })
  })

  test("accepts an explicit absolute baseline worktree and derives a neutral label", () => {
    const baselineRoot = resolve(repositoryRoot, "..", "wave2-baseline")
    expect(resolveBaselineSelection({ "baseline-root": baselineRoot }, repositoryRoot)).toEqual({
      root: baselineRoot,
      label: "wave2-baseline",
      explicit: true,
    })
  })

  test("rejects a relative baseline root", () => {
    expect(() => resolveBaselineSelection({ "baseline-root": "../wave2-baseline" }, repositoryRoot)).toThrow(
      "--baseline-root must be absolute",
    )
  })

  test("keeps root against root as the compatible gate default", () => {
    expect(resolveGateScenarios({}, "root", "bun")).toEqual({
      baseline: "root",
      candidate: "root",
    })
  })

  test("pairs the Wave-1 root baseline with the Wave-2 renderer entry", () => {
    const selection = resolveGateScenarios({ "baseline-scenario": "root" }, "renderer-entry", "bun")
    expect(selection).toEqual({ baseline: "root", candidate: "renderer-entry" })
    expect(scenarioUsesCommittedFrame(selection.baseline, "bun")).toBe(true)
    expect(scenarioUsesCommittedFrame(selection.candidate, "bun")).toBe(true)
  })

  test("rejects import-only and unknown scenarios from a TTFMF gate", () => {
    expect(() => resolveGateScenarios({}, "renderable-entry", "bun")).toThrow(
      "candidate scenario renderable-entry has no committed-frame TTFMF",
    )
    expect(() => resolveGateScenarios({ "baseline-scenario": "renderable-entry" }, "renderer-entry", "bun")).toThrow(
      "baseline scenario renderable-entry has no committed-frame TTFMF",
    )
    expect(() => resolveGateScenarios({ "baseline-scenario": "unknown" }, "renderer-entry", "bun")).toThrow(
      "unknown baseline scenario: unknown",
    )
  })
})
