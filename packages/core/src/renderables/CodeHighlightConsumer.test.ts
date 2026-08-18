import { test, expect, beforeEach, afterEach } from "bun:test"
import { CodeRenderable } from "./Code.js"
import { SyntaxStyle } from "../syntax-style.js"
import { RGBA } from "../lib/RGBA.js"
import { createTestRenderer, type TestRenderer, MockTreeSitterClient } from "../testing.js"
import { ManualClock } from "../testing/manual-clock.js"
import { treeSitterToTextChunks } from "../lib/tree-sitter-styled-text.js"
import type { CreateBufferHighlightResult, Edit, SimpleHighlight, UpdateOutcome } from "../lib/tree-sitter/types.js"
import type { CapturedFrame } from "../types.js"

const HIGHLIGHT_TIMEOUT_MS = 5000

let currentRenderer: TestRenderer
let renderOnce: () => Promise<void>
let captureFrame: () => string
let captureSpans: () => CapturedFrame
let clock: ManualClock

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    clock.setTimeout(resolve, ms)
  })
}

async function flushAsync(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

async function waitForHighlight(codeRenderable: CodeRenderable): Promise<void> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      codeRenderable.highlightingDone,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error("Timed out waiting for CodeRenderable highlighting")),
          HIGHLIGHT_TIMEOUT_MS,
        )
      }),
    ])
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
  }
  await flushAsync()
}

function recordHighlightContents(mockClient: MockTreeSitterClient): string[] {
  const contents: string[] = []
  const highlightOnce = mockClient.highlightOnce.bind(mockClient)
  mockClient.highlightOnce = async (content, filetype) => {
    contents.push(content)
    return highlightOnce(content, filetype)
  }
  return contents
}

class BufferedOnlyClient extends MockTreeSitterClient {
  readonly creates: Array<{ id: number; content: string; filetype: string; version: number }> = []
  readonly updates: Array<{ id: number; edits: Edit[]; content: string; version: number }> = []
  readonly removes: number[] = []
  oneShotCalls = 0

  override async highlightOnce(): Promise<{ highlights?: SimpleHighlight[]; warning?: string; error?: string }> {
    this.oneShotCalls++
    throw new Error("streaming CodeRenderable must not use highlightOnce")
  }

  override async createBufferWithHighlights(
    id: number,
    content: string,
    filetype: string,
    version: number = 1,
  ): Promise<CreateBufferHighlightResult> {
    this.creates.push({ id, content, filetype, version })
    return { hasParser: true, highlights: [[0, 5, "keyword"]] }
  }

  override async updateBuffer(id: number, edits: Edit[], content: string, version: number): Promise<UpdateOutcome> {
    this.updates.push({ id, edits, content, version })
    return { status: "completed", bufferId: id, version, highlights: [[0, 5, "keyword"]] }
  }

  override async removeBuffer(id: number): Promise<void> {
    this.removes.push(id)
  }
}

beforeEach(async () => {
  clock = new ManualClock()
  const testRenderer = await createTestRenderer({ width: 80, height: 24 })
  currentRenderer = testRenderer.renderer
  renderOnce = testRenderer.renderOnce
  captureFrame = testRenderer.captureCharFrame
  captureSpans = testRenderer.captureSpans
})

afterEach(() => {
  if (currentRenderer) {
    currentRenderer.destroy()
  }
})

test("consumer: streaming uses the versioned buffer path and releases its owned buffer", async () => {
  const client = new BufferedOnlyClient()
  const style = SyntaxStyle.create()
  const code = new CodeRenderable(currentRenderer, {
    id: "c-buffered-source",
    content: "const a = 1\n",
    filetype: "typescript",
    syntaxStyle: style,
    treeSitterClient: client,
    streaming: true,
  })
  try {
    currentRenderer.root.add(code)

    await renderOnce()
    await waitForHighlight(code)
    await renderOnce()
    expect(client.creates).toHaveLength(1)
    expect(client.oneShotCalls).toBe(0)

    code.content = "const a = 1\nconst b = 2\n"
    await renderOnce()
    await waitForHighlight(code)
    await renderOnce()
    expect(client.updates).toHaveLength(1)
    expect(client.updates[0].id).toBe(client.creates[0].id)
    expect(client.oneShotCalls).toBe(0)

    code.destroy()
    await flushAsync()
    expect(client.removes).toEqual([client.creates[0].id])
  } finally {
    code.destroy()
    await client.destroy()
    style.destroy()
  }
})

test("consumer: 100 same-turn updates produce exactly one visible final generation", async () => {
  const style = SyntaxStyle.create()
  const mock = new MockTreeSitterClient()
  mock.setMockResult({ highlights: [] })
  const recorded = recordHighlightContents(mock)
  const code = new CodeRenderable(currentRenderer, {
    id: "c-same-turn",
    content: "0",
    filetype: "typescript",
    syntaxStyle: style,
    treeSitterClient: mock,
    streaming: true,
  })
  currentRenderer.root.add(code)
  await renderOnce()
  expect(recorded).toEqual(["0"])

  // 100 updates in the same synchronous turn.
  for (let i = 1; i <= 100; i++) {
    code.content = String(i)
  }
  await renderOnce()

  // The in-flight initial run is superseded and only the latest content is re-highlighted.
  mock.resolveAllHighlightOnce()
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(recorded).toEqual(["0", "100"])

  mock.resolveAllHighlightOnce()
  await waitForHighlight(code)
  await renderOnce()

  expect(code.plainText).toBe("100")
  expect(captureFrame()).toContain("100")
})

test("consumer: filetype change starts a unique new generation under the new filetype", async () => {
  const style = SyntaxStyle.create()
  const mock = new MockTreeSitterClient()
  mock.setMockResult({ highlights: [] })
  const recorded = recordHighlightContents(mock)
  const code = new CodeRenderable(currentRenderer, {
    id: "c-filetype",
    content: "A",
    filetype: "typescript",
    syntaxStyle: style,
    treeSitterClient: mock,
    streaming: true,
  })
  currentRenderer.root.add(code)
  await renderOnce()
  expect(recorded).toEqual(["A"])

  // Change filetype while the initial run is in flight.
  code.filetype = "rust"
  await renderOnce()
  mock.resolveAllHighlightOnce()
  await new Promise<void>((resolve) => setImmediate(resolve))

  // A fresh generation re-highlights the current content under the new filetype.
  expect(recorded).toEqual(["A", "A"])
  expect(code.filetype).toBe("rust")

  mock.resolveAllHighlightOnce()
  await waitForHighlight(code)
  await renderOnce()
  expect(code.plainText).toBe("A")
})

test("consumer: destroy during in-flight highlight commits nothing afterwards", async () => {
  const style = SyntaxStyle.create()
  const mock = new MockTreeSitterClient()
  mock.setMockResult({ highlights: [] })
  const code = new CodeRenderable(currentRenderer, {
    id: "c-destroy",
    content: "B",
    filetype: "typescript",
    syntaxStyle: style,
    treeSitterClient: mock,
    streaming: true,
  })
  currentRenderer.root.add(code)
  await renderOnce()
  expect(mock.isHighlighting()).toBe(true)

  code.destroy()
  expect(code.isDestroyed).toBe(true)

  // Late results arriving after destroy are discarded without throwing.
  mock.resolveAllHighlightOnce()
  await flushAsync()
  expect(mock.isHighlighting()).toBe(false)
})

test("consumer: fixed content without streaming needs no follow-up highlight or extra frame", async () => {
  const mock = new MockTreeSitterClient()
  const recorded = recordHighlightContents(mock)
  const code = new CodeRenderable(currentRenderer, {
    id: "c-fixed",
    content: "const a = 1;",
    filetype: "typescript",
    syntaxStyle: SyntaxStyle.create(),
    treeSitterClient: mock,
  })
  currentRenderer.root.add(code)
  await renderOnce()
  await renderOnce()
  // Idle renders over fixed content must not re-issue the source.
  expect(recorded).toEqual(["const a = 1;"])

  mock.resolveAllHighlightOnce()
  await waitForHighlight(code)
  await renderOnce()
  // Still exactly one source run; no re-highlight loop or extra frame.
  expect(recorded).toEqual(["const a = 1;"])
  expect(code.plainText).toBe("const a = 1;")
})

test("consumer: worker error falls back to plain text and leaves the session open for a later retry", async () => {
  const mock = new MockTreeSitterClient()
  mock.setMockResult({ highlights: [], error: "Highlighting failed" })
  const code = new CodeRenderable(currentRenderer, {
    id: "c-error",
    content: "D",
    filetype: "typescript",
    syntaxStyle: SyntaxStyle.create(),
    treeSitterClient: mock,
  })
  currentRenderer.root.add(code)
  await renderOnce()
  mock.resolveAllHighlightOnce()
  await waitForHighlight(code)
  await renderOnce()

  // Unsupported / worker error stays visible as plain text.
  expect(code.plainText).toBe("D")
  expect(code.isHighlighting).toBe(false)
})

test("consumer: final-state output matches the full highlightOnce oracle", async () => {
  const keywordFg = RGBA.fromValues(0, 0, 1, 1)
  const stringFg = RGBA.fromValues(0, 1, 0, 1)
  const style = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
    keyword: { fg: keywordFg },
    string: { fg: stringFg },
  })
  const content = 'const x = "hi"'
  const highlights: SimpleHighlight[] = [
    [0, 5, "keyword"],
    [10, 14, "string"],
  ]

  const mock = new MockTreeSitterClient()
  mock.setMockResult({ highlights })
  const code = new CodeRenderable(currentRenderer, {
    id: "c-oracle",
    content,
    filetype: "typescript",
    syntaxStyle: style,
    treeSitterClient: mock,
    conceal: false,
  })
  currentRenderer.root.add(code)

  // The consumer's conversion stage is itself the oracle for full highlightOnce.
  const oracleText = treeSitterToTextChunks(content, highlights, style, { enabled: false })
    .map((chunk) => chunk.text)
    .join("")

  await renderOnce()
  mock.resolveAllHighlightOnce()
  await waitForHighlight(code)
  await renderOnce()

  const line = captureSpans().lines[0]
  const keywordSpan = line?.spans.find((span) => span.text.includes("const"))
  const stringSpan = line?.spans.find((span) => span.text.includes('"hi"'))

  expect(code.plainText).toBe(content)
  expect(keywordSpan?.fg.equals(keywordFg)).toBe(true)
  expect(stringSpan?.fg.equals(stringFg)).toBe(true)
  expect(oracleText).toBe(content)
})
