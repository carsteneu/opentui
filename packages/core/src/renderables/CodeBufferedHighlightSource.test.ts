import { describe, expect, test } from "bun:test"
import type { Edit, SimpleHighlight, UpdateOutcome } from "../lib/tree-sitter/types.js"
import {
  CodeBufferedHighlightSource,
  type BufferedHighlightClient,
  type CreateBufferHighlightResult,
} from "./CodeBufferedHighlightSource.js"

class RecordingClient implements BufferedHighlightClient {
  readonly creates: Array<{
    id: number
    content: string
    filetype: string
    version: number
    simpleHighlightsOnly?: boolean
  }> = []
  readonly updates: Array<{ id: number; edits: Edit[]; content: string; version: number }> = []
  readonly removes: number[] = []
  createResult: CreateBufferHighlightResult = { hasParser: true, highlights: [] }
  updateHighlights: SimpleHighlight[] = []
  private nextId = -1

  allocateBufferId(): number {
    return this.nextId--
  }

  async createBufferWithHighlights(
    id: number,
    content: string,
    filetype: string,
    version: number,
    _autoInitialize?: boolean,
    simpleHighlightsOnly?: boolean,
  ): Promise<CreateBufferHighlightResult> {
    this.creates.push({ id, content, filetype, version, simpleHighlightsOnly })
    return this.createResult
  }

  async updateBuffer(id: number, edits: Edit[], content: string, version: number): Promise<UpdateOutcome> {
    this.updates.push({ id, edits, content, version })
    return { status: "completed", bufferId: id, version, highlights: this.updateHighlights }
  }

  async removeBuffer(id: number): Promise<void> {
    this.removes.push(id)
  }
}

describe("CodeBufferedHighlightSource", () => {
  test("creates once, caches identical content, and sends a byte-correct append edit", async () => {
    const client = new RecordingClient()
    const initialHighlights: SimpleHighlight[] = [[0, 5, "keyword", { isInjection: true, injectionLang: "tsx" }]]
    const updateHighlights: SimpleHighlight[] = [[7, 12, "string", { conceal: "…", concealLines: "1" }]]
    client.createResult = { hasParser: true, highlights: initialHighlights }
    client.updateHighlights = updateHighlights
    const source = new CodeBufferedHighlightSource(client)

    await expect(source.highlight("const λ = '💡'\n", "typescript")).resolves.toEqual({ highlights: initialHighlights })
    await expect(source.highlight("const λ = '💡'\n", "typescript")).resolves.toEqual({ highlights: initialHighlights })

    const before = "const λ = '💡'\n"
    const after = `${before}// 追加🚀\n`
    await expect(source.highlight(after, "typescript")).resolves.toEqual({ highlights: updateHighlights })

    expect(client.creates).toHaveLength(1)
    expect(client.creates[0].simpleHighlightsOnly).toBe(true)
    expect(client.updates).toHaveLength(1)
    expect(client.updates[0]).toEqual({
      id: client.creates[0].id,
      content: after,
      version: 2,
      edits: [
        {
          startIndex: Buffer.byteLength(before),
          oldEndIndex: Buffer.byteLength(before),
          newEndIndex: Buffer.byteLength(after),
          startPosition: { row: 1, column: 0 },
          oldEndPosition: { row: 1, column: 0 },
          newEndPosition: { row: 2, column: 0 },
        },
      ],
    })
  })

  test("recreates for non-append edits and filetype changes without reusing a disposed id", async () => {
    const client = new RecordingClient()
    const source = new CodeBufferedHighlightSource(client)

    await source.highlight("const a = 1\n", "typescript")
    const firstId = client.creates[0].id
    await source.highlight("let a = 2\n", "typescript")
    const secondId = client.creates[1].id
    await source.highlight("let a = 2\n", "javascript")
    const thirdId = client.creates[2].id

    expect(new Set([firstId, secondId, thirdId]).size).toBe(3)
    expect(client.updates).toHaveLength(0)
    expect(client.removes).toEqual([firstId, secondId])
  })

  test("normalizes a closing markdown fence exactly like highlightOnce", async () => {
    const client = new RecordingClient()
    const source = new CodeBufferedHighlightSource(client)

    await source.highlight("# title", "markdown")
    await source.highlight("# title\n\n```ts\nconst x = 1\n```", "markdown")

    expect(client.creates[0].content).toBe("# title")
    expect(client.updates[0].content).toBe("# title\n\n```ts\nconst x = 1\n```\n")
    expect(client.updates[0].edits[0].newEndPosition).toEqual({ row: 5, column: 0 })
  })

  test("close during create disposes the late buffer exactly once and forbids later work", async () => {
    const client = new RecordingClient()
    const { promise, resolve } = Promise.withResolvers<CreateBufferHighlightResult>()
    client.createBufferWithHighlights = async (
      id,
      content,
      filetype,
      version,
      _autoInitialize,
      simpleHighlightsOnly,
    ) => {
      client.creates.push({ id, content, filetype, version, simpleHighlightsOnly })
      return promise
    }
    const source = new CodeBufferedHighlightSource(client)

    const highlighting = source.highlight("const late = true\n", "typescript")
    source.close()
    source.close()
    resolve({ hasParser: true, highlights: [[0, 5, "keyword"]] })

    await expect(highlighting).resolves.toEqual({ error: "Buffered highlight source was superseded" })
    expect(client.removes).toEqual([client.creates[0].id])
    await expect(source.highlight("later", "typescript")).resolves.toEqual({
      error: "Buffered highlight source is closed",
    })
    expect(client.creates).toHaveLength(1)
  })

  test("release invalidates an in-flight create and keeps the source reusable", async () => {
    const client = new RecordingClient()
    const { promise, resolve } = Promise.withResolvers<CreateBufferHighlightResult>()
    client.createBufferWithHighlights = async (
      id,
      content,
      filetype,
      version,
      _autoInitialize,
      simpleHighlightsOnly,
    ) => {
      client.creates.push({ id, content, filetype, version, simpleHighlightsOnly })
      return client.creates.length === 1 ? promise : { hasParser: true, highlights: [] }
    }
    const source = new CodeBufferedHighlightSource(client)

    const stale = source.highlight("old", "typescript")
    source.release()
    resolve({ hasParser: true, highlights: [] })
    await expect(stale).resolves.toEqual({ error: "Buffered highlight source was superseded" })

    await expect(source.highlight("new", "rust")).resolves.toEqual({ highlights: [] })
    expect(client.removes).toEqual([client.creates[0].id])
    expect(client.creates).toHaveLength(2)
  })

  test("a failed create still releases its reserved buffer id", async () => {
    const client = new RecordingClient()
    client.createBufferWithHighlights = async (
      id,
      content,
      filetype,
      version,
      _autoInitialize,
      simpleHighlightsOnly,
    ) => {
      client.creates.push({ id, content, filetype, version, simpleHighlightsOnly })
      throw new Error("worker failed after reserving the buffer")
    }
    const source = new CodeBufferedHighlightSource(client)

    await expect(source.highlight("const failure = true", "typescript")).rejects.toThrow(
      "worker failed after reserving the buffer",
    )
    expect(client.removes).toEqual([client.creates[0].id])
  })

  test("a failed update preserves the rejected highlight contract", async () => {
    const client = new RecordingClient()
    const source = new CodeBufferedHighlightSource(client)
    await source.highlight("const before = true\n", "typescript")

    client.updateBuffer = async (id, edits, content, version) => {
      client.updates.push({ id, edits, content, version })
      return { status: "error", bufferId: id, version, error: "worker update failed" }
    }

    await expect(source.highlight("const before = true\nconst after = true\n", "typescript")).rejects.toThrow(
      "worker update failed",
    )
  })
})
