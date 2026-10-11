import { describe, test, expect, spyOn } from "bun:test"
import { createTestRenderer } from "../../testing/test-renderer.js"
import { CodeRenderable } from "../Code.js"
import { SyntaxStyle } from "../../syntax-style.js"
import { MockTreeSitterClient } from "../../testing/mock-tree-sitter-client.js"
import { StyledText } from "../../lib/styled-text.js"
import { RGBA } from "../../lib/RGBA.js"
import type { TextBuffer } from "../../text-buffer.js"
import { TreeSitterClient } from "../../lib/tree-sitter/client.js"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

describe("CodeRenderable", () => {
  test("default-styled streaming prose uses layout-safe full replacements", async () => {
    const { renderer } = await createTestRenderer({ width: 30, height: 10 })
    const syntaxStyle = SyntaxStyle.create()
    const client = new MockTreeSitterClient()
    const fg = RGBA.fromValues(1, 1, 1, 1)
    const initial = new StyledText([{ __isChunk: true, text: "Stable prose", fg }])
    const code = new CodeRenderable(renderer, {
      content: "Stable prose",
      filetype: "markdown",
      syntaxStyle,
      initialStyledText: initial,
      deferStreamingHighlight: true,
      drawUnstyledText: true,
      streaming: true,
      treeSitterClient: client,
      fg,
    })
    const buffer = (code as unknown as { textBuffer: TextBuffer }).textBuffer
    const append = spyOn(buffer, "append")
    const setText = spyOn(buffer, "setText")
    const setStyledText = spyOn(buffer, "setStyledText")

    try {
      code.initialStyledText = new StyledText([{ __isChunk: true, text: "Stable prose grows", fg }])
      code.content = "Stable prose grows"

      expect(append).not.toHaveBeenCalled()
      expect(setText).toHaveBeenCalledTimes(1)
      expect(setText).toHaveBeenCalledWith("Stable prose grows")
      expect(setStyledText).not.toHaveBeenCalled()
      expect(buffer.getPlainText()).toBe("Stable prose grows")

      const accent = RGBA.fromValues(1, 0, 0, 1)
      code.initialStyledText = new StyledText([{ __isChunk: true, text: "Stable prose grows styled", fg: accent }])
      code.content = "Stable prose grows styled"

      expect(append).not.toHaveBeenCalled()
      expect(setText).toHaveBeenCalledTimes(1)
      expect(setStyledText).toHaveBeenCalledTimes(1)
      expect(buffer.getPlainText()).toBe("Stable prose grows styled")
    } finally {
      renderer.destroy()
      await client.destroy()
      syntaxStyle.destroy()
    }
  })

  test("default-styled streaming prose replaces the buffer after its default style changes", async () => {
    const { renderer } = await createTestRenderer({ width: 30, height: 10 })
    const syntaxStyle = SyntaxStyle.create()
    const client = new MockTreeSitterClient()
    const red = RGBA.fromValues(1, 0, 0, 1)
    const green = RGBA.fromValues(0, 1, 0, 1)
    const code = new CodeRenderable(renderer, {
      content: "Hello",
      filetype: "markdown",
      syntaxStyle,
      initialStyledText: new StyledText([{ __isChunk: true, text: "Hello", fg: red }]),
      deferStreamingHighlight: true,
      drawUnstyledText: true,
      streaming: true,
      treeSitterClient: client,
      fg: red,
    })
    const buffer = (code as unknown as { textBuffer: TextBuffer }).textBuffer
    const append = spyOn(buffer, "append")
    const setText = spyOn(buffer, "setText")
    const setStyledText = spyOn(buffer, "setStyledText")

    try {
      code.fg = green
      code.initialStyledText = new StyledText([{ __isChunk: true, text: "Hello world", fg: green }])
      code.content = "Hello world"

      expect(append).not.toHaveBeenCalled()
      expect(setText).toHaveBeenCalledTimes(1)
      expect(setStyledText).not.toHaveBeenCalled()
      expect(buffer.getPlainText()).toBe("Hello world")
    } finally {
      renderer.destroy()
      await client.destroy()
      syntaxStyle.destroy()
    }
  })

  test("default-styled streaming prose replaces unsafe native text boundaries", async () => {
    const { renderer } = await createTestRenderer({ width: 30, height: 10 })
    const syntaxStyle = SyntaxStyle.create()
    const client = new MockTreeSitterClient()
    const fg = RGBA.fromValues(1, 1, 1, 1)

    try {
      for (const [initial, content] of [
        ["abc", "abcdef"],
        ["\uD83D", "😀"],
        ["A\r", "A\r\nB"],
        ["👩", "👩‍💻"],
        ["🇩", "🇩🇪"],
        ["👍", "👍🏽"],
        ["ᄀ", "가"],
        ["1", "1️⃣"],
      ] as const) {
        const code = new CodeRenderable(renderer, {
          content: initial,
          filetype: "markdown",
          syntaxStyle,
          initialStyledText: new StyledText([{ __isChunk: true, text: initial, fg }]),
          deferStreamingHighlight: true,
          drawUnstyledText: true,
          streaming: true,
          treeSitterClient: client,
          fg,
          width: 5,
          wrapMode: "word",
        })
        const full = new CodeRenderable(renderer, {
          content,
          filetype: "markdown",
          syntaxStyle,
          initialStyledText: new StyledText([{ __isChunk: true, text: content, fg }]),
          deferStreamingHighlight: true,
          drawUnstyledText: true,
          streaming: true,
          treeSitterClient: client,
          fg,
          width: 5,
          wrapMode: "word",
        })
        const buffer = (code as unknown as { textBuffer: TextBuffer }).textBuffer
        const append = spyOn(buffer, "append")
        const replace = spyOn(buffer, "setText")

        code.initialStyledText = new StyledText([{ __isChunk: true, text: content, fg }])
        code.content = content

        expect(append).not.toHaveBeenCalled()
        expect(replace).toHaveBeenCalledTimes(1)
        expect(code.plainText).toBe(full.plainText)
        expect(code.textLength).toBe(full.textLength)
        expect(code.lineCount).toBe(full.lineCount)
        expect(code.lineInfo).toEqual(full.lineInfo)
        expect(code.scrollWidth).toBe(full.scrollWidth)
        code.destroy()
        full.destroy()
      }
    } finally {
      renderer.destroy()
      await client.destroy()
      syntaxStyle.destroy()
    }
  })

  test("deferred streaming highlight reapplies same-content styled text", async () => {
    const { renderer, renderOnce, captureSpans } = await createTestRenderer({ width: 30, height: 10 })
    const syntaxStyle = SyntaxStyle.create()
    const client = new MockTreeSitterClient()
    const red = RGBA.fromValues(1, 0, 0, 1)
    const green = RGBA.fromValues(0, 1, 0, 1)
    const code = new CodeRenderable(renderer, {
      content: "Hello",
      filetype: "markdown",
      syntaxStyle,
      initialStyledText: new StyledText([{ __isChunk: true, text: "Hello", fg: red }]),
      deferStreamingHighlight: true,
      drawUnstyledText: true,
      streaming: true,
      treeSitterClient: client,
      fg: red,
    })

    try {
      renderer.root.add(code)
      await renderOnce()
      expect(
        captureSpans()
          .lines[0].spans.find((span) => span.text.includes("Hello"))
          ?.fg.toInts(),
      ).toEqual(red.toInts())

      code.initialStyledText = new StyledText([{ __isChunk: true, text: "Hello", fg: green }])
      await renderOnce()

      expect(
        captureSpans()
          .lines[0].spans.find((span) => span.text.includes("Hello"))
          ?.fg.toInts(),
      ).toEqual(green.toInts())
    } finally {
      renderer.destroy()
      await client.destroy()
      syntaxStyle.destroy()
    }
  })

  test("reassigning a concealed styled snapshot keeps its source pairing", async () => {
    const { renderer, renderOnce } = await createTestRenderer({ width: 30, height: 10 })
    const syntaxStyle = SyntaxStyle.create()
    const client = new MockTreeSitterClient()
    const fg = RGBA.fromValues(1, 1, 1, 1)
    const styledText = new StyledText([{ __isChunk: true, text: "bold", fg }])
    const code = new CodeRenderable(renderer, {
      content: "**bold**",
      filetype: "markdown",
      syntaxStyle,
      treeSitterClient: client,
      initialStyledText: styledText,
      deferStreamingHighlight: true,
      drawUnstyledText: true,
      streaming: true,
      fg,
    })

    try {
      renderer.root.add(code)
      await renderOnce()
      expect(code.plainText).toBe("bold")
      expect(client.isHighlighting()).toBe(false)

      code.initialStyledText = styledText
      await renderOnce()
      expect(code.plainText).toBe("bold")
      expect(client.isHighlighting()).toBe(false)
    } finally {
      if (client.isHighlighting()) client.resolveAllHighlightOnce()
      await code.highlightingDone.catch(() => undefined)
      renderer.destroy()
      await client.destroy()
      syntaxStyle.destroy()
    }
  })

  test("deferred streaming highlight does not hide content that outgrows its styled snapshot", async () => {
    const { renderer, renderOnce } = await createTestRenderer({ width: 30, height: 10 })
    const syntaxStyle = SyntaxStyle.create()
    const client = new MockTreeSitterClient()
    const fg = RGBA.fromValues(1, 1, 1, 1)
    const code = new CodeRenderable(renderer, {
      content: "Hello",
      filetype: "markdown",
      syntaxStyle,
      treeSitterClient: client,
      initialStyledText: new StyledText([{ __isChunk: true, text: "Hello", fg }]),
      deferStreamingHighlight: true,
      drawUnstyledText: true,
      streaming: true,
      fg,
    })

    try {
      renderer.root.add(code)
      code.content = "Hello world"

      expect(code.plainText).toBe("Hello world")
      await renderOnce()
      expect(code.isHighlighting).toBe(true)

      client.resolveAllHighlightOnce()
      await code.highlightingDone
      expect(code.plainText).toBe("Hello world")
    } finally {
      if (client.isHighlighting()) client.resolveAllHighlightOnce()
      await code.highlightingDone.catch(() => undefined)
      renderer.destroy()
      await client.destroy()
      syntaxStyle.destroy()
    }
  })

  test("large JSON retains native token highlights and paints syntax colors", async () => {
    const scratch = join(tmpdir(), "tree-sitter-styled-text-test")
    await mkdir(scratch, { recursive: true })
    const dataPath = await mkdtemp(join(scratch, "json-tokens-"))
    const client = new TreeSitterClient({ dataPath })
    const syntaxStyle = SyntaxStyle.fromStyles({
      default: { fg: RGBA.fromHex("#ffffff") },
      property: { fg: RGBA.fromHex("#ff0000"), bold: true },
      number: { fg: RGBA.fromHex("#00ff00") },
    })
    const setup = await createTestRenderer({ width: 80, height: 10 })
    try {
      // Match the production JSON grammar/query rather than falling back to plaintext.
      client.addFiletypeParser({
        filetype: "json",
        wasm: join(process.cwd(), "src/tests/fixtures/json/tree-sitter-json.wasm"),
        queries: {
          highlights: [join(process.cwd(), "src/tests/fixtures/json/highlights.scm")],
        },
      })
      await client.initialize()
      const lines = Number(process.env.OPENTUI_STYLED_PROBE_LINES ?? 1000)
      const content = JSON.stringify(
        Object.fromEntries(Array.from({ length: lines }, (_, row) => [`field${row}`, 123])),
        null,
        2,
      )
      class HighlightedCode extends CodeRenderable {
        get nativeTextBuffer() {
          return this.textBuffer
        }
      }
      const code = new HighlightedCode(setup.renderer, {
        content,
        filetype: "json",
        syntaxStyle,
        treeSitterClient: client,
        drawUnstyledText: true,
        conceal: false,
        width: "100%",
        height: "100%",
      })
      setup.renderer.root.add(code)
      const start = performance.now()
      await setup.renderOnce()
      const firstFrameMs = performance.now() - start
      await code.highlightingDone
      const highlightedMs = performance.now() - start
      expect(code.nativeTextBuffer.getHighlightCount()).toBe(lines * 8 + 1)
      expect(code.nativeTextBuffer.getPlainText()).toBe(content)
      for (const row of [1, Math.floor(lines / 2), lines]) {
        expect(code.nativeTextBuffer.getLineHighlights(row).length).toBeGreaterThan(2)
      }
      await setup.renderOnce()
      const spans = setup.captureSpans().lines.flatMap((line) => line.spans)
      expect(spans.find((span) => span.text.includes("field0"))?.fg.toInts()).toEqual(RGBA.fromHex("#ff0000").toInts())
      expect(spans.find((span) => span.text.includes("123"))?.fg.toInts()).toEqual(RGBA.fromHex("#00ff00").toInts())
      const paintedMs = performance.now() - start
      code.scrollY = lines
      await setup.renderOnce()
      expect(setup.captureCharFrame()).toContain(`field${lines - 1}`)
      expect(
        setup
          .captureSpans()
          .lines.flatMap((line) => line.spans)
          .find((span) => span.text.includes(`field${lines - 1}`))
          ?.fg.toInts(),
      ).toEqual(RGBA.fromHex("#ff0000").toInts())
      setup.resize(30, 10)
      await setup.renderOnce()
      expect(setup.captureCharFrame()).toContain(`field${lines - 1}`)
      if (process.env.OPENTUI_STYLED_PROBE_LINES) {
        console.log(
          JSON.stringify({
            lines,
            firstFrameMs,
            highlightedMs,
            paintedMs,
            scrolledAndResizedMs: performance.now() - start,
            highlights: code.nativeTextBuffer.getHighlightCount(),
          }),
        )
      }
    } finally {
      setup.renderer.destroy()
      await client.destroy()
      syntaxStyle.destroy()
      await rm(dataPath, { recursive: true, force: true })
    }
  }, 60_000)

  test("streaming content update schedules render and starts highlighting when renderer is idle", async () => {
    const { renderer, renderOnce } = await createTestRenderer({
      width: 30,
      height: 10,
    })

    const client = new MockTreeSitterClient()
    const syntaxStyle = SyntaxStyle.create()

    const code = new CodeRenderable(renderer, {
      content: "",
      filetype: "typescript",
      syntaxStyle,
      drawUnstyledText: false,
      streaming: true,
      width: "100%",
      height: "100%",
      treeSitterClient: client,
    })

    try {
      renderer.root.add(code)
      await renderOnce()

      // Set content in streaming mode — this should schedule a render
      code.content = 'console.log("hello")'

      // Render once — this should trigger startHighlight because highlights are dirty
      await renderOnce()

      // Highlighting should have started (mock client hasn't resolved yet)
      expect(code.isHighlighting).toBe(true)
      expect(client.isHighlighting()).toBe(true)

      client.resolveAllHighlightOnce()
      await code.highlightingDone
    } finally {
      if (client.isHighlighting()) {
        client.resolveAllHighlightOnce()
      }

      await code.highlightingDone.catch(() => undefined)
      renderer.destroy()
      await client.destroy()
      syntaxStyle.destroy()
    }
  })
})
