import { describe, expect, test } from "bun:test"
import { resolve } from "node:path"
import { resolveBaselineSelection, scenarioTarget, scenarioUsesCommittedFrame } from "./bench-cold-import-config.js"

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
})
