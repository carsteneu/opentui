import { describe, expect, mock, test } from "bun:test"
import { ParserWorker } from "./parser.worker.js"

interface FakeTree {
  edit: ReturnType<typeof mock>
  getChangedRanges: ReturnType<typeof mock>
  rootNode: object
  delete: ReturnType<typeof mock>
}

function fakeTree(): FakeTree {
  return {
    edit: mock(() => {}),
    getChangedRanges: mock(() => []),
    rootNode: {},
    delete: mock(() => {}),
  }
}

function seedWorker(oldTree: FakeTree, newTree: FakeTree, simpleHighlightsOnly = true) {
  const worker = new ParserWorker()
  const parser = {
    parse: mock(() => newTree),
    delete: mock(() => {}),
  }
  const captures = mock(() => [])
  const state = {
    parser,
    tree: oldTree,
    queries: { highlights: { captures } },
    filetype: "javascript",
    content: "const before = 1",
    simpleHighlightsOnly,
  }

  ;(worker as unknown as { bufferParsers: Map<number, typeof state> }).bufferParsers.set(1, state)
  return { worker, parser, captures, state }
}

describe("ParserWorker syntax-tree ownership", () => {
  test("incremental replacement frees the previous tree exactly once and retains the current tree until dispose", async () => {
    const oldTree = fakeTree()
    const newTree = fakeTree()
    const { worker, state } = seedWorker(oldTree, newTree)

    await worker.handleEdits(1, "const after = 2", [])

    expect(state.tree).toBe(newTree)
    expect(oldTree.delete).toHaveBeenCalledTimes(1)
    expect(newTree.delete).toHaveBeenCalledTimes(0)

    worker.disposeBuffer(1)
    expect(oldTree.delete).toHaveBeenCalledTimes(1)
    expect(newTree.delete).toHaveBeenCalledTimes(1)
  })

  test("reset replacement frees the previous tree exactly once", async () => {
    const oldTree = fakeTree()
    const newTree = fakeTree()
    const { worker, state } = seedWorker(oldTree, newTree)

    await worker.handleResetBuffer(1, 2, "const reset = true")

    expect(state.tree).toBe(newTree)
    expect(oldTree.delete).toHaveBeenCalledTimes(1)
    expect(newTree.delete).toHaveBeenCalledTimes(0)
  })

  test("a replacement rejected before adoption is freed while the previous tree remains owned", async () => {
    const oldTree = fakeTree()
    const newTree = fakeTree()
    oldTree.getChangedRanges.mockImplementation(() => {
      throw new Error("range failure")
    })
    const { worker, state } = seedWorker(oldTree, newTree, false)

    await expect(worker.handleEdits(1, "const after = 2", [])).rejects.toThrow("range failure")

    expect(state.tree).toBe(oldTree)
    expect(oldTree.delete).toHaveBeenCalledTimes(0)
    expect(newTree.delete).toHaveBeenCalledTimes(1)
  })
})
