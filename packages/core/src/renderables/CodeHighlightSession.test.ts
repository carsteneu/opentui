import { test, expect } from "bun:test"
import {
  CodeHighlightSession,
  type CodeHighlightPipeline,
  type CodeHighlightResult,
  type CodeHighlightSource,
} from "./CodeHighlightSession.js"
import type { SimpleHighlight } from "../lib/tree-sitter/types.js"

const EMPTY: CodeHighlightResult = { highlights: [] }

class ScriptedSource implements CodeHighlightSource {
  calls: Array<{ content: string; filetype: string; resolve: (r: CodeHighlightResult) => void }> = []

  highlight(content: string, filetype: string): Promise<CodeHighlightResult> {
    return new Promise((resolve) => {
      this.calls.push({ content, filetype, resolve })
    })
  }

  settle(index: number, result: CodeHighlightResult = EMPTY): void {
    this.calls[index].resolve(result)
  }
}

function countingPipeline() {
  const counters = { converts: 0, commits: 0 }
  const pipeline: CodeHighlightPipeline<string> = {
    convert: async (ctx) => {
      counters.converts++
      return ctx.content
    },
    commit: (payload) => {
      counters.commits++
    },
  }
  return { counters, pipeline }
}

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

test("commits the latest result and discards a stale result before conversion (out-of-order)", async () => {
  const source = new ScriptedSource()
  const session = new CodeHighlightSession(source)
  const { counters, pipeline } = countingPipeline()

  const runA = session.run("append", { content: "A", filetype: "ts" }, pipeline)
  const runB = session.run("fullReplace", { content: "B", filetype: "ts" }, pipeline)

  // Newer generation resolves first.
  source.settle(1)
  expect(await runB).toBe(true)
  // Older generation arrives afterwards: discarded before conversion.
  source.settle(0)
  expect(await runA).toBe(false)

  expect(counters.converts).toBe(1)
  expect(counters.commits).toBe(1)
})

test("discards a stale result before commit when the generation changes mid-conversion", async () => {
  const source = new ScriptedSource()
  const session = new CodeHighlightSession(source)
  let releaseConvert!: () => void
  let converts = 0
  let commits = 0
  const pipeline: CodeHighlightPipeline<string> = {
    convert: async (ctx) => {
      converts++
      await new Promise<void>((resolve) => {
        releaseConvert = resolve
      })
      return ctx.content
    },
    commit: () => {
      commits++
    },
  }

  const run = session.run("append", { content: "X", filetype: "ts" }, pipeline)
  source.settle(0)
  await flush()
  expect(converts).toBe(1)

  // Full replacement supersedes while conversion is in flight.
  session.revise("fullReplace")
  releaseConvert()

  expect(await run).toBe(false)
  expect(commits).toBe(0)
})

test("100 same-turn runs commit exactly one visible final generation", async () => {
  const source = new ScriptedSource()
  const session = new CodeHighlightSession(source)
  const { counters, pipeline } = countingPipeline()

  const runs: Promise<boolean>[] = []
  const N = 100
  for (let i = 0; i < N; i++) {
    runs.push(session.run("append", { content: String(i), filetype: "ts" }, pipeline))
  }
  for (let i = 0; i < N; i++) {
    source.settle(i)
  }

  const results = await Promise.all(runs)
  expect(results.filter(Boolean)).toEqual([true])
  expect(counters.converts).toBe(1)
  expect(counters.commits).toBe(1)
})

test("filetype change starts a unique new generation and discards the old session result", async () => {
  const source = new ScriptedSource()
  const session = new CodeHighlightSession(source)
  const { counters, pipeline } = countingPipeline()

  const run = session.run("initial", { content: "A", filetype: "ts" }, pipeline)
  session.revise("filetypeChange")

  source.settle(0)
  expect(await run).toBe(false)
  expect(session.owner).toBe("filetypeChange")
  expect(counters.converts).toBe(0)
  expect(counters.commits).toBe(0)

  // A new generation under the new filetype still works.
  const run2 = session.run("append", { content: "B", filetype: "rust" }, pipeline)
  source.settle(1)
  expect(await run2).toBe(true)
  expect(counters.commits).toBe(1)
})

test("closing the session forbids conversion and commit and leaves no run open", async () => {
  const source = new ScriptedSource()
  const session = new CodeHighlightSession(source)
  const { counters, pipeline } = countingPipeline()

  const run = session.run("initial", { content: "A", filetype: "ts" }, pipeline)
  session.close()
  expect(session.closed).toBe(true)

  // A late in-flight result arriving after close is fully discarded.
  source.settle(0)
  expect(await run).toBe(false)
  expect(counters.converts).toBe(0)
  expect(counters.commits).toBe(0)

  // Runs issued after close never reach the source.
  const callCount = source.calls.length
  expect(await session.run("append", { content: "B", filetype: "ts" }, pipeline)).toBe(false)
  expect(source.calls.length).toBe(callCount)
})

test("full replacement remains available as the safe default for an unclassified edit", async () => {
  const source = new ScriptedSource()
  const session = new CodeHighlightSession(source)
  const { counters, pipeline } = countingPipeline()

  const run = session.run("fullReplace", { content: "FULL", filetype: "ts" }, pipeline)
  source.settle(0)
  expect(await run).toBe(true)
  expect(counters.commits).toBe(1)
})

test("records the owner of the current generation across revisions", () => {
  const session = new CodeHighlightSession(new ScriptedSource())
  expect(session.owner).toBeUndefined()

  expect(session.revise("initial")).toBe(1)
  expect(session.owner).toBe("initial")

  expect(session.revise("append")).toBe(2)
  expect(session.owner).toBe("append")

  expect(session.revise("filetypeChange")).toBe(3)
  expect(session.owner).toBe("filetypeChange")

  expect(session.isCurrent(3)).toBe(true)
  expect(session.isCurrent(2)).toBe(false)
})
