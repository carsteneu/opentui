import { describe, test, expect, spyOn } from "bun:test"
import { createTestRenderer } from "../../testing/test-renderer.js"
import { CodeRenderable } from "../Code.js"
import { SyntaxStyle } from "../../syntax-style.js"
import { MockTreeSitterClient } from "../../testing/mock-tree-sitter-client.js"
import { StyledText } from "../../lib/styled-text.js"
import { RGBA } from "../../lib/RGBA.js"
import type { TextBuffer } from "../../text-buffer.js"

describe("CodeRenderable", () => {
  test("default-styled streaming prose appends only the new suffix", async () => {
    const { renderer } = await createTestRenderer({ width: 30, height: 10 })
    const syntaxStyle = SyntaxStyle.create()
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
      fg,
    })
    const buffer = (code as unknown as { textBuffer: TextBuffer }).textBuffer
    const append = spyOn(buffer, "append")
    const replace = spyOn(buffer, "setStyledText")

    try {
      code.initialStyledText = new StyledText([{ __isChunk: true, text: "Stable prose grows", fg }])
      code.content = "Stable prose grows"

      expect(append).toHaveBeenCalledTimes(1)
      expect(append).toHaveBeenCalledWith(" grows")
      expect(replace).not.toHaveBeenCalled()
      expect(buffer.getPlainText()).toBe("Stable prose grows")

      const accent = RGBA.fromValues(1, 0, 0, 1)
      code.initialStyledText = new StyledText([{ __isChunk: true, text: "Stable prose grows styled", fg: accent }])
      code.content = "Stable prose grows styled"

      expect(append).toHaveBeenCalledTimes(1)
      expect(replace).toHaveBeenCalledTimes(1)
      expect(buffer.getPlainText()).toBe("Stable prose grows styled")
    } finally {
      renderer.destroy()
      syntaxStyle.destroy()
    }
  })

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
