import { test, expect, beforeAll, afterAll, describe } from "bun:test"
import { TreeSitterClient } from "./tree-sitter/client.js"
import { treeSitterToStyledText, treeSitterToTextChunks } from "./tree-sitter-styled-text.js"
import { SyntaxStyle } from "../syntax-style.js"
import { RGBA } from "./RGBA.js"
import { createTextAttributes } from "../utils.js"
import { tmpdir } from "os"
import { join } from "path"
import { mkdir } from "fs/promises"
import type { SimpleHighlight } from "./tree-sitter/types.js"
import type { TextChunk } from "../text-buffer.js"
import type { StyleDefinition } from "../syntax-style.js"
import { env } from "./env.js"

describe("TreeSitter Styled Text", () => {
  let client: TreeSitterClient
  let syntaxStyle: SyntaxStyle
  const dataPath = join(tmpdir(), "tree-sitter-styled-text-test")

  beforeAll(async () => {
    await mkdir(dataPath, { recursive: true })
    client = new TreeSitterClient({ dataPath })
    await client.initialize()

    // Create a syntax style similar to common themes
    syntaxStyle = SyntaxStyle.fromStyles({
      default: { fg: RGBA.fromInts(255, 255, 255, 255) }, // white
      keyword: { fg: RGBA.fromInts(255, 100, 100, 255), bold: true }, // red bold
      string: { fg: RGBA.fromInts(100, 255, 100, 255) }, // green
      number: { fg: RGBA.fromInts(100, 100, 255, 255) }, // blue
      function: { fg: RGBA.fromInts(255, 255, 100, 255), italic: true }, // yellow italic
      comment: { fg: RGBA.fromInts(128, 128, 128, 255), italic: true }, // gray italic
      variable: { fg: RGBA.fromInts(200, 200, 255, 255) }, // light blue
      type: { fg: RGBA.fromInts(255, 200, 100, 255) }, // orange
      "markup.heading": { fg: RGBA.fromInts(255, 200, 200, 255), bold: true }, // light red bold
      "markup.strong": { bold: true }, // bold
      "markup.italic": { italic: true }, // italic
      "markup.raw": { fg: RGBA.fromInts(200, 255, 200, 255) }, // light green
      "markup.quote": { fg: RGBA.fromInts(180, 180, 180, 255), italic: true }, // gray italic
      "markup.list": { fg: RGBA.fromInts(255, 200, 100, 255) }, // orange
    })
  })

  afterAll(async () => {
    await client.destroy()
    syntaxStyle.destroy()
  })

  test("should convert JavaScript code to styled text", async () => {
    const jsCode = 'const greeting = "Hello, world!";\nfunction test() { return 42; }'

    const styledText = await treeSitterToStyledText(jsCode, "javascript", syntaxStyle, client)

    expect(styledText).toBeDefined()

    const chunks = styledText.chunks
    expect(chunks.length).toBeGreaterThan(1) // Should have multiple styled chunks

    const chunksWithColor = chunks.filter((chunk) => chunk.fg)
    expect(chunksWithColor.length).toBeGreaterThan(0) // Some chunks should have colors
  })

  test("should convert TypeScript code to styled text", async () => {
    const tsCode = "interface User {\n  name: string;\n  age: number;\n}"

    const styledText = await treeSitterToStyledText(tsCode, "typescript", syntaxStyle, client)

    expect(styledText).toBeDefined()

    const chunks = styledText.chunks
    expect(chunks.length).toBeGreaterThan(1)

    const styledChunks = chunks.filter((chunk) => chunk.fg)
    expect(styledChunks.length).toBeGreaterThan(0)
  })

  test("should handle unsupported filetype gracefully", async () => {
    const content = "some random content"

    const styledText = await treeSitterToStyledText(content, "unsupported", syntaxStyle, client)

    expect(styledText).toBeDefined()

    const chunks = styledText.chunks
    expect(chunks).toHaveLength(1)
    expect(chunks[0].text).toBe(content)

    expect(chunks[0].fg).toBeDefined()
  })

  test("should handle empty content", async () => {
    const styledText = await treeSitterToStyledText("", "javascript", syntaxStyle, client)

    expect(styledText).toBeDefined()

    const chunks = styledText.chunks
    expect(chunks).toHaveLength(1)
    expect(chunks[0].text).toBe("")
  })

  test("should handle multiline content correctly", async () => {
    const multilineCode = `// This is a comment
const value = 123;
const text = "hello";
function add(a, b) {
  return a + b;
}`

    const styledText = await treeSitterToStyledText(multilineCode, "javascript", syntaxStyle, client)

    expect(styledText).toBeDefined()

    const chunks = styledText.chunks
    expect(chunks.length).toBeGreaterThan(5) // Multiple chunks for different elements

    // Should contain newlines
    const newlineChunks = chunks.filter((chunk) => chunk.text.includes("\n"))
    expect(newlineChunks.length).toBeGreaterThan(0)
  })

  test("should preserve original text content", async () => {
    const originalCode = 'const test = "preserve this exact text";'

    const styledText = await treeSitterToStyledText(originalCode, "javascript", syntaxStyle, client)

    const reconstructed = styledText.chunks.map((chunk) => chunk.text).join("")
    expect(reconstructed).toBe(originalCode)
  })

  test("should apply different styles to different syntax elements", async () => {
    const jsCode = "const number = 42; // comment"

    const styledText = await treeSitterToStyledText(jsCode, "javascript", syntaxStyle, client)
    const chunks = styledText.chunks

    // Should have some chunks with colors
    const chunksWithColors = chunks.filter((chunk) => chunk.fg)
    expect(chunksWithColors.length).toBeGreaterThan(0)

    // Should have some chunks with attributes (bold, italic, etc.)
    const chunksWithAttributes = chunks.filter((chunk) => chunk.attributes && chunk.attributes > 0)
    expect(chunksWithAttributes.length).toBeGreaterThan(0)
  })

  test("should handle template literals correctly without duplication", async () => {
    const templateLiteralCode = "console.log(`Total users: ${manager.getUserCount()}`);"

    const styledText = await treeSitterToStyledText(templateLiteralCode, "javascript", syntaxStyle, client)
    const chunks = styledText.chunks

    // Reconstruct the text from chunks to check for duplication
    const reconstructed = chunks.map((chunk) => chunk.text).join("")

    expect(reconstructed).toBe(templateLiteralCode)

    expect(chunks.length).toBeGreaterThan(1)

    const styledChunks = chunks.filter((chunk) => chunk.fg)
    expect(styledChunks.length).toBeGreaterThan(0)
  })

  test("should handle complex template literals with multiple expressions", async () => {
    const complexTemplateCode =
      'console.log(`User: ${user.name}, Age: ${user.age}, Status: ${user.active ? "active" : "inactive"}`);'

    const styledText = await treeSitterToStyledText(complexTemplateCode, "javascript", syntaxStyle, client)
    const chunks = styledText.chunks

    const reconstructed = chunks.map((chunk) => chunk.text).join("")

    expect(reconstructed).toBe(complexTemplateCode)
  })

  test("should correctly highlight template literal with embedded expressions", async () => {
    const templateLiteralCode = "console.log(`Total users: ${manager.getUserCount()}`);"

    const result = await client.highlightOnce(templateLiteralCode, "javascript")

    expect(result.highlights).toBeDefined()
    expect(result.highlights!.length).toBeGreaterThan(0)

    const groups = result.highlights!.map(([, , group]) => group)
    expect(groups).toContain("variable") // console, manager
    expect(groups).toContain("property") // log, getUserCount
    expect(groups).toContain("string") // template literal
    expect(groups).toContain("embedded") // ${...} expression
    expect(groups).toContain("punctuation.bracket") // (), {}

    const styledText = await treeSitterToStyledText(templateLiteralCode, "javascript", syntaxStyle, client)
    const chunks = styledText.chunks

    expect(chunks.length).toBeGreaterThan(5)

    const reconstructed = chunks.map((chunk) => chunk.text).join("")
    expect(reconstructed).toBe(templateLiteralCode)

    const styledChunks = chunks.filter((chunk) => chunk.fg !== syntaxStyle.mergeStyles("default").fg)
    expect(styledChunks.length).toBeGreaterThan(0) // Some chunks should be styled differently
  })

  test("should work with real tree-sitter output containing dot-delimited groups", async () => {
    const tsCode = "interface User { name: string; age?: number; }"

    const result = await client.highlightOnce(tsCode, "typescript")
    expect(result.highlights).toBeDefined()

    const groups = result.highlights!.map(([, , group]) => group)
    const dotDelimitedGroups = groups.filter((group) => group.includes("."))
    expect(dotDelimitedGroups.length).toBeGreaterThan(0)

    const styledText = await treeSitterToStyledText(tsCode, "typescript", syntaxStyle, client)
    const chunks = styledText.chunks

    expect(chunks.length).toBeGreaterThan(1)

    const styledChunks = chunks.filter((chunk) => chunk.fg !== syntaxStyle.mergeStyles("default").fg)
    expect(styledChunks.length).toBeGreaterThan(0)

    const reconstructed = chunks.map((chunk) => chunk.text).join("")
    expect(reconstructed).toBe(tsCode)
  })

  test("should resolve styles correctly for dot-delimited groups and multiple overlapping groups", async () => {
    // Test the getStyle method directly
    expect(syntaxStyle.getStyle("function.method")).toEqual(syntaxStyle.getStyle("function"))
    expect(syntaxStyle.getStyle("variable.member")).toEqual(syntaxStyle.getStyle("variable"))
    expect(syntaxStyle.getStyle("nonexistent.fallback")).toBeUndefined()
    expect(syntaxStyle.getStyle("function")).toBeDefined()
    expect(syntaxStyle.getStyle("constructor")).toBeUndefined() // Should not return Object constructor

    // Test with mock highlights that have multiple groups for same range
    const mockHighlights: Array<[number, number, string]> = [
      [0, 4, "variable.member"], // should resolve to 'variable' style
      [0, 4, "function.method"], // should resolve to 'function' style (last valid)
      [0, 4, "nonexistent"], // undefined, should not override
      [4, 8, "keyword"], // should resolve to 'keyword' style
    ]

    const content = "testfunc"
    const chunks = treeSitterToTextChunks(content, mockHighlights, syntaxStyle)

    expect(chunks.length).toBe(2) // Two highlight ranges, no gaps

    // First chunk [0,4] should have function style (last valid style)
    const functionStyle = syntaxStyle.getStyle("function")!
    expect(chunks[0].text).toBe("test")
    expect(chunks[0].fg).toEqual(functionStyle.fg)
    expect(chunks[0].attributes).toBe(
      createTextAttributes({
        bold: functionStyle.bold,
        italic: functionStyle.italic,
        underline: functionStyle.underline,
        dim: functionStyle.dim,
      }),
    )

    // Second chunk [4,8] should have keyword style
    const keywordStyle = syntaxStyle.getStyle("keyword")!
    expect(chunks[1].text).toBe("func")
    expect(chunks[1].fg).toEqual(keywordStyle.fg)
    expect(chunks[1].attributes).toBe(
      createTextAttributes({
        bold: keywordStyle.bold,
        italic: keywordStyle.italic,
        underline: keywordStyle.underline,
        dim: keywordStyle.dim,
      }),
    )
  })

  test("should handle constructor group correctly", async () => {
    expect(syntaxStyle.getStyle("constructor")).toBeUndefined()

    const mockHighlights: Array<[number, number, string]> = [
      [0, 11, "variable.member"], // should resolve to 'variable' style
      [0, 11, "constructor"], // should resolve to undefined
      [0, 11, "function.method"], // should resolve to 'function' style (last valid)
    ]

    const content = "constructor"
    const chunks = treeSitterToTextChunks(content, mockHighlights, syntaxStyle)

    expect(chunks.length).toBe(1)

    const functionStyle = syntaxStyle.getStyle("function")!
    expect(chunks[0].text).toBe("constructor")
    expect(chunks[0].fg).toEqual(functionStyle.fg)
    expect(chunks[0].attributes).toBe(
      createTextAttributes({
        bold: functionStyle.bold,
        italic: functionStyle.italic,
        underline: functionStyle.underline,
        dim: functionStyle.dim,
      }),
    )
  })

  test("should handle markdown with TypeScript injection - suppress parent block styles", async () => {
    const markdownCode = `\`\`\`typescript
const x: string = "hello";
\`\`\``

    const styledText = await treeSitterToStyledText(markdownCode, "markdown", syntaxStyle, client, {
      conceal: { enabled: false }, // Disable concealing to test text preservation
    })
    const chunks = styledText.chunks

    const reconstructed = chunks.map((c) => c.text).join("")
    expect(reconstructed).toBe(markdownCode)

    const tsStart = markdownCode.indexOf("const")
    const tsEnd = markdownCode.lastIndexOf(";") + 1

    let currentPos = 0
    const tsChunks: typeof chunks = []
    for (const chunk of chunks) {
      const chunkStart = currentPos
      const chunkEnd = currentPos + chunk.text.length
      if (chunkStart >= tsStart && chunkEnd <= tsEnd) {
        tsChunks.push(chunk)
      }
      currentPos = chunkEnd
    }

    // and NOT the parent markup.raw.block background
    expect(tsChunks.length).toBeGreaterThan(0)

    const hasKeywordStyle = tsChunks.some((chunk) => {
      const keywordStyle = syntaxStyle.getStyle("keyword")
      return (
        keywordStyle &&
        chunk.fg &&
        keywordStyle.fg &&
        chunk.fg.r === keywordStyle.fg.r &&
        chunk.fg.g === keywordStyle.fg.g &&
        chunk.fg.b === keywordStyle.fg.b
      )
    })
    expect(hasKeywordStyle).toBe(true)
  })

  test("should conceal backticks in inline code", async () => {
    const markdownCode = "Some text with `inline code` here."

    const styledText = await treeSitterToStyledText(markdownCode, "markdown", syntaxStyle, client, {
      conceal: { enabled: true },
    })
    const chunks = styledText.chunks

    const reconstructed = chunks.map((c) => c.text).join("")
    expect(reconstructed).not.toContain("`")
    expect(reconstructed).toContain("inline code")
    expect(reconstructed).toContain("Some text with ")
    expect(reconstructed).toContain(" here.")
  })

  test("should conceal bold markers", async () => {
    const markdownCode = "Some **bold** text"

    const styledText = await treeSitterToStyledText(markdownCode, "markdown", syntaxStyle, client, {
      conceal: { enabled: true },
    })
    const chunks = styledText.chunks

    const reconstructed = chunks.map((c) => c.text).join("")
    expect(reconstructed).not.toContain("**")
    expect(reconstructed).not.toContain("*")
    expect(reconstructed).toContain("bold")
    expect(reconstructed).toContain("Some ")
    expect(reconstructed).toContain(" text")
  })

  test("should conceal link syntax but keep text and URL", async () => {
    const markdownCode = "[Link text](https://example.com)"

    const result = await client.highlightOnce(markdownCode, "markdown")
    expect(result.highlights).toBeDefined()

    const styledText = await treeSitterToStyledText(markdownCode, "markdown", syntaxStyle, client, {
      conceal: { enabled: true },
    })
    const chunks = styledText.chunks

    const reconstructed = chunks.map((c) => c.text).join("")

    expect(reconstructed).not.toContain("[")
    expect(reconstructed).not.toContain("]")
    expect(reconstructed).toContain("(")
    expect(reconstructed).toContain(")")

    expect(reconstructed).toContain("Link text")
    expect(reconstructed).toContain("https://example.com")

    expect(reconstructed).toBe("Link text (https://example.com)")
  })

  test("should conceal code block delimiters and language info", async () => {
    const markdownCode = `\`\`\`typescript
const x: string = "hello";
\`\`\``

    const result = await client.highlightOnce(markdownCode, "markdown")
    expect(result.highlights).toBeDefined()

    const styledText = await treeSitterToStyledText(markdownCode, "markdown", syntaxStyle, client, {
      conceal: { enabled: true },
    })
    const chunks = styledText.chunks

    const reconstructed = chunks.map((c) => c.text).join("")

    expect(reconstructed).toContain("const x")
    expect(reconstructed).toContain("hello")

    expect(reconstructed).not.toContain("typescript")

    expect(reconstructed.startsWith("const")).toBe(true)

    expect(reconstructed.split("\n").filter((l) => l.trim() === "").length).toBeLessThanOrEqual(1)
  })

  test("should handle overlapping highlights with specificity resolution", async () => {
    const mockHighlights: SimpleHighlight[] = [
      [0, 10, "variable"],
      [0, 10, "variable.member"], // More specific, should win
      [0, 10, "type"],
      [11, 16, "keyword"],
      [11, 16, "keyword.coroutine"], // More specific, should win
    ]

    const content = "identifier const"
    // "identifier" = indices 0-9 (10 chars)
    // " " = index 10 (1 char)
    // "const" = indices 11-15 (5 chars)
    const chunks = treeSitterToTextChunks(content, mockHighlights, syntaxStyle)

    expect(chunks.length).toBe(3) // "identifier", " ", "const"

    const variableStyle = syntaxStyle.getStyle("variable")!
    expect(chunks[0].text).toBe("identifier")
    expect(chunks[0].fg).toEqual(variableStyle.fg)

    expect(chunks[1].text).toBe(" ")

    const keywordStyle = syntaxStyle.getStyle("keyword")!
    expect(chunks[2].text).toBe("const")
    expect(chunks[2].fg).toEqual(keywordStyle.fg)
  })

  test("should not conceal when conceal option is disabled", async () => {
    const markdownCode = "Some text with `inline code` here."

    const styledText = await treeSitterToStyledText(markdownCode, "markdown", syntaxStyle, client, {
      conceal: { enabled: false },
    })
    const chunks = styledText.chunks

    const reconstructed = chunks.map((c) => c.text).join("")
    expect(reconstructed).toContain("`")
    expect(reconstructed).toBe(markdownCode)
  })

  test("should handle complex markdown with multiple features", async () => {
    const markdownCode = `# Heading

Some **bold** text and \`code\`.

\`\`\`typescript
const hello: string = "world";
\`\`\`

[Link](https://example.com)`

    const styledText = await treeSitterToStyledText(markdownCode, "markdown", syntaxStyle, client, {
      conceal: { enabled: true },
    })
    const chunks = styledText.chunks

    const reconstructed = chunks.map((c) => c.text).join("")

    expect(reconstructed).toContain("Heading")
    expect(reconstructed).toContain("bold")
    expect(reconstructed).toContain("code")
    expect(reconstructed).toContain("const hello")
    expect(reconstructed).toContain("Link")

    expect(reconstructed).not.toContain("**")
  })

  test("should correctly handle ranges after concealed text", async () => {
    const markdownCode = "Text with **bold** and *italic* markers."

    const styledText = await treeSitterToStyledText(markdownCode, "markdown", syntaxStyle, client, {
      conceal: { enabled: true },
    })
    const chunks = styledText.chunks

    const reconstructed = chunks.map((c) => c.text).join("")

    expect(reconstructed).toContain("Text with ")
    expect(reconstructed).toContain("bold")
    expect(reconstructed).toContain(" and ")
    expect(reconstructed).toContain("italic")
    expect(reconstructed).toContain(" markers.")

    expect(reconstructed).not.toContain("**")
    expect(reconstructed).not.toContain("*")

    expect(reconstructed).toMatch(/Text with \w+ and \w+ markers\./)
  })

  test("should conceal heading markers and preserve heading styling", async () => {
    const markdownCode = "## Heading 2"

    const result = await client.highlightOnce(markdownCode, "markdown")

    const hasAnyConceals = result.highlights!.some(([, , , meta]) => meta?.conceal !== undefined)
    expect(hasAnyConceals).toBe(true) // Should have conceal on the ## marker

    const styledText = await treeSitterToStyledText(markdownCode, "markdown", syntaxStyle, client, {
      conceal: { enabled: true },
    })
    const chunks = styledText.chunks

    const reconstructed = chunks.map((c) => c.text).join("")

    expect(reconstructed).toContain("Heading 2")

    expect(reconstructed).not.toContain("##")
    expect(reconstructed).not.toContain("#")

    expect(reconstructed).toBe("Heading 2")

    expect(reconstructed.startsWith(" ")).toBe(false)
    expect(reconstructed.startsWith("Heading")).toBe(true)

    // Note: Heading styling depends on having the parent markup.heading style
    // properly cascade to child text. In a real application with proper theme setup,
    // the heading text will be styled correctly as shown in other tests.
  })

  test("should not create empty lines when concealing code block delimiters", async () => {
    const markdownCode = `\`\`\`typescript
const x = 1;
const y = 2;
\`\`\``

    const styledText = await treeSitterToStyledText(markdownCode, "markdown", syntaxStyle, client, {
      conceal: { enabled: true },
    })

    const reconstructed = styledText.chunks.map((c) => c.text).join("")

    const originalLines = markdownCode.split("\n")
    expect(originalLines.length).toBe(4)

    // (The ```typescript line is completely removed including its newline)
    const reconstructedLines = reconstructed.split("\n")
    expect(reconstructedLines.length).toBe(3)

    expect(reconstructedLines[0]).toBe("const x = 1;")

    expect(reconstructed.startsWith("\n")).toBe(false)
    expect(reconstructed.startsWith("const")).toBe(true)
  })

  test("should conceal closing triple backticks in plain code block (no injection)", async () => {
    const markdownCode = `\`\`\`
const msg = "hello";
\`\`\``

    const result = await client.highlightOnce(markdownCode, "markdown")
    expect(result.highlights).toBeDefined()

    const closingBackticksHighlight = result.highlights!.find(([start, end, , meta]) => {
      const text = markdownCode.slice(start, end)
      return text === "```" && start > 10 && meta?.conceal !== undefined
    })

    expect(closingBackticksHighlight).toBeDefined()

    const styledText = await treeSitterToStyledText(markdownCode, "markdown", syntaxStyle, client, {
      conceal: { enabled: true },
    })
    const chunks = styledText.chunks

    const reconstructed = chunks.map((c) => c.text).join("")

    expect(reconstructed).not.toContain("```")
    expect(reconstructed).toContain("const msg")
  })

  test("should conceal closing triple backticks when they are the last content (with TypeScript injection)", async () => {
    const markdownCode = `\`\`\`typescript
const msg = "hello";
\`\`\``

    const result = await client.highlightOnce(markdownCode, "markdown")
    expect(result.highlights).toBeDefined()

    const closingBackticksHighlights = result.highlights!.filter(([start, end]) => {
      const text = markdownCode.slice(start, end)
      return start > 30 && text.includes("`")
    })

    const hasClosingConceal = closingBackticksHighlights.some(([, , , meta]) => meta?.conceal !== undefined)
    expect(hasClosingConceal).toBe(true)

    const styledText = await treeSitterToStyledText(markdownCode, "markdown", syntaxStyle, client, {
      conceal: { enabled: true },
    })
    const chunks = styledText.chunks

    const reconstructed = chunks.map((c) => c.text).join("")

    expect(reconstructed).not.toContain("```")
    expect(reconstructed).toContain("const msg")
    expect(reconstructed).toContain("hello")

    expect(reconstructed.endsWith("```")).toBe(false)
    expect(reconstructed.endsWith("`")).toBe(false)
  })

  describe("Markdown highlighting comprehensive coverage", () => {
    test("headings should have full styling applied", async () => {
      const markdownCode = `# Heading 1
## Heading 2
### Heading 3`

      const result = await client.highlightOnce(markdownCode, "markdown")
      expect(result.highlights).toBeDefined()

      const groups = result.highlights!.map(([, , group]) => group)
      expect(groups).toContain("markup.heading.1")
      expect(groups).toContain("markup.heading.2")
      expect(groups).toContain("markup.heading.3")

      const styledText = await treeSitterToStyledText(markdownCode, "markdown", syntaxStyle, client, {
        conceal: { enabled: false }, // Disable concealing to test text preservation
      })
      const chunks = styledText.chunks

      const reconstructed = chunks.map((c) => c.text).join("")
      expect(reconstructed).toBe(markdownCode)

      const hashOrHeadingChunks = chunks.filter((chunk) => chunk.text.includes("#") || /heading/i.test(chunk.text))
      expect(hashOrHeadingChunks.length).toBeGreaterThan(0)

      const headingGroups = groups.filter((g) => g.includes("markup.heading"))
      expect(headingGroups.length).toBeGreaterThan(0)
    })

    test("inline raw blocks (code) should be styled", async () => {
      const markdownCode = "Some text with `inline code` here."

      const result = await client.highlightOnce(markdownCode, "markdown")
      expect(result.highlights).toBeDefined()

      const groups = result.highlights!.map(([, , group]) => group)
      const hasCodeGroup = groups.some((g) => g.includes("markup.raw") || g.includes("code"))
      expect(hasCodeGroup).toBe(true)

      const styledText = await treeSitterToStyledText(markdownCode, "markdown", syntaxStyle, client, {
        conceal: { enabled: false },
      })
      const chunks = styledText.chunks

      const codeChunks = chunks.filter((c) => c.text.includes("inline") || c.text.includes("code"))
      expect(codeChunks.length).toBeGreaterThan(0)

      const defaultStyle = syntaxStyle.mergeStyles("default")
      const styledCodeChunks = codeChunks.filter((c) => c.fg !== defaultStyle.fg || c.attributes !== 0)
      expect(styledCodeChunks.length).toBeGreaterThan(0)
    })

    test("quotes should be styled correctly", async () => {
      const markdownCode = `> This is a quote
> Another line`

      const result = await client.highlightOnce(markdownCode, "markdown")
      expect(result.highlights).toBeDefined()

      const groups = result.highlights!.map(([, , group]) => group)
      const hasQuoteGroup = groups.some((g) => g.includes("quote"))
      expect(hasQuoteGroup).toBe(true)

      const styledText = await treeSitterToStyledText(markdownCode, "markdown", syntaxStyle, client)
      const chunks = styledText.chunks

      const reconstructed = chunks.map((c) => c.text).join("")
      expect(reconstructed).toBe(markdownCode)
    })

    test("italic text should be styled in all places", async () => {
      const markdownCode = `*italic* text in paragraph

# *italic in heading*

- *italic in list*`

      const result = await client.highlightOnce(markdownCode, "markdown")
      expect(result.highlights).toBeDefined()

      const groups = result.highlights!.map(([, , group]) => group)
      const hasItalicGroup = groups.some((g) => g.includes("italic") || g.includes("emphasis"))
      expect(hasItalicGroup).toBe(true)

      const styledText = await treeSitterToStyledText(markdownCode, "markdown", syntaxStyle, client, {
        conceal: { enabled: true },
      })
      const chunks = styledText.chunks

      const reconstructed = chunks.map((c) => c.text).join("")
      const asteriskCount = (reconstructed.match(/\*/g) || []).length
      const originalAsteriskCount = (markdownCode.match(/\*/g) || []).length
      expect(asteriskCount).toBeLessThan(originalAsteriskCount)
    })

    test("bold text should work in all contexts", async () => {
      const markdownCode = `**bold** text in paragraph

# **bold in heading**

- **bold in list**

> **bold in quote**`

      const result = await client.highlightOnce(markdownCode, "markdown")
      expect(result.highlights).toBeDefined()

      const groups = result.highlights!.map(([, , group]) => group)
      const hasBoldGroup = groups.some((g) => g.includes("strong") || g.includes("bold"))
      expect(hasBoldGroup).toBe(true)

      const styledText = await treeSitterToStyledText(markdownCode, "markdown", syntaxStyle, client, {
        conceal: { enabled: true },
      })
      const chunks = styledText.chunks

      const reconstructed = chunks.map((c) => c.text).join("")
      expect(reconstructed).not.toContain("**")
      expect(reconstructed).toContain("bold")
    })

    test("TypeScript code block should not contain parent markup.raw.block fragments between syntax ranges", async () => {
      const markdownCode = `\`\`\`typescript
const greeting: string = "hello";
function test() { return 42; }
\`\`\``

      const result = await client.highlightOnce(markdownCode, "markdown")
      expect(result.highlights).toBeDefined()

      const hasInjection = result.highlights!.some(([, , , meta]) => meta?.injectionLang === "typescript")
      expect(hasInjection).toBe(true)

      const styledText = await treeSitterToStyledText(markdownCode, "markdown", syntaxStyle, client, {
        conceal: { enabled: false }, // Disable concealing to test text preservation
      })
      const chunks = styledText.chunks

      const reconstructed = chunks.map((c) => c.text).join("")
      expect(reconstructed).toBe(markdownCode)

      const tsCodeStart = markdownCode.indexOf("\n") + 1 // After first ```typescript\n
      const tsCodeEnd = markdownCode.lastIndexOf("\n```") // Before last \n```

      let currentPos = 0
      const tsChunks: typeof chunks = []
      for (const chunk of chunks) {
        const chunkStart = currentPos
        const chunkEnd = currentPos + chunk.text.length
        if (chunkEnd > tsCodeStart && chunkStart < tsCodeEnd) {
          tsChunks.push(chunk)
        }
        currentPos = chunkEnd
      }

      expect(tsChunks.length).toBeGreaterThan(0)

      // (keyword, type, string, etc.) and NOT markup.raw.block background
      const keywordStyle = syntaxStyle.getStyle("keyword")
      const stringStyle = syntaxStyle.getStyle("string")
      const typeStyle = syntaxStyle.getStyle("type")

      const hasKeywordStyle = tsChunks.some((chunk) => {
        return (
          keywordStyle &&
          chunk.fg &&
          keywordStyle.fg &&
          chunk.fg.r === keywordStyle.fg.r &&
          chunk.fg.g === keywordStyle.fg.g &&
          chunk.fg.b === keywordStyle.fg.b
        )
      })

      const hasStringStyle = tsChunks.some((chunk) => {
        return (
          stringStyle &&
          chunk.fg &&
          stringStyle.fg &&
          chunk.fg.r === stringStyle.fg.r &&
          chunk.fg.g === stringStyle.fg.g &&
          chunk.fg.b === stringStyle.fg.b
        )
      })

      expect(hasKeywordStyle || hasStringStyle).toBe(true)

      const defaultStyle = syntaxStyle.mergeStyles("default")

      for (const chunk of tsChunks) {
        // 1. TypeScript-specific styling (keyword, string, type, etc.)
        // 2. Default styling (for whitespace, punctuation)
        // 3. NOT markup.raw.block background (which would be wrong)

        // we verify that chunks are either styled or default
        const isStyled = chunk.fg !== defaultStyle.fg || chunk.attributes !== 0
        const isDefault = chunk.fg === defaultStyle.fg

        expect(isStyled || isDefault).toBe(true)
      }
    })

    test("mixed formatting (bold + italic) should work", async () => {
      const markdownCode = "***bold and italic*** text"

      const result = await client.highlightOnce(markdownCode, "markdown")
      expect(result.highlights).toBeDefined()

      const styledText = await treeSitterToStyledText(markdownCode, "markdown", syntaxStyle, client, {
        conceal: { enabled: true },
      })
      const chunks = styledText.chunks

      const reconstructed = chunks.map((c) => c.text).join("")
      expect(reconstructed).not.toContain("***")
      expect(reconstructed).toContain("bold and italic")
    })

    test("inline code in headings should be styled", async () => {
      const markdownCode = "# Heading with `code` inside"

      const result = await client.highlightOnce(markdownCode, "markdown")
      expect(result.highlights).toBeDefined()

      const styledText = await treeSitterToStyledText(markdownCode, "markdown", syntaxStyle, client, {
        conceal: { enabled: false },
      })
      const chunks = styledText.chunks

      const reconstructed = chunks.map((c) => c.text).join("")
      expect(reconstructed).toBe(markdownCode)

      const groups = result.highlights!.map(([, , group]) => group)
      expect(groups.some((g) => g.includes("heading"))).toBe(true)
      expect(groups.some((g) => g.includes("markup.raw") || g.includes("code"))).toBe(true)
    })

    test("bold and italic in lists should work", async () => {
      const markdownCode = `- **bold item**
- *italic item*
- normal item`

      const result = await client.highlightOnce(markdownCode, "markdown")
      expect(result.highlights).toBeDefined()

      const styledText = await treeSitterToStyledText(markdownCode, "markdown", syntaxStyle, client, {
        conceal: { enabled: true },
      })
      const chunks = styledText.chunks

      const reconstructed = chunks.map((c) => c.text).join("")
      expect(reconstructed).toContain("bold item")
      expect(reconstructed).toContain("italic item")
      expect(reconstructed).not.toContain("**")
    })

    test("code blocks with different languages should suppress parent styles", async () => {
      const markdownCode = `\`\`\`javascript
const x = 42;
\`\`\`

\`\`\`typescript
const y: number = 42;
\`\`\``

      const result = await client.highlightOnce(markdownCode, "markdown")
      expect(result.highlights).toBeDefined()

      const styledText = await treeSitterToStyledText(markdownCode, "markdown", syntaxStyle, client, {
        conceal: { enabled: false }, // Disable concealing to test text preservation
      })
      const chunks = styledText.chunks

      const reconstructed = chunks.map((c) => c.text).join("")
      expect(reconstructed).toBe(markdownCode)

      const jsInjection = result.highlights!.some(([, , , meta]) => meta?.injectionLang === "javascript")
      const tsInjection = result.highlights!.some(([, , , meta]) => meta?.injectionLang === "typescript")

      expect(jsInjection || tsInjection).toBe(true)
    })

    test("complex nested markdown structures", async () => {
      const markdownCode = `# Main Heading

> This is a quote with **bold** and *italic* and \`code\`.

## Sub Heading

- List item with **bold**
- Another item with \`inline code\`

\`\`\`typescript
// Comment in code
const value = "string";
\`\`\`

Normal paragraph with [link](https://example.com).`

      const result = await client.highlightOnce(markdownCode, "markdown")
      expect(result.highlights).toBeDefined()
      expect(result.highlights!.length).toBeGreaterThan(10)

      const styledText = await treeSitterToStyledText(markdownCode, "markdown", syntaxStyle, client, {
        conceal: { enabled: true },
      })
      const chunks = styledText.chunks

      const reconstructed = chunks.map((c) => c.text).join("")

      expect(reconstructed).toContain("Main Heading")
      expect(reconstructed).toContain("Sub Heading")
      expect(reconstructed).toContain("quote")
      expect(reconstructed).toContain("bold")
      expect(reconstructed).toContain("italic")
      expect(reconstructed).toContain("code")
      expect(reconstructed).toContain("const value")
      expect(reconstructed).toContain("link")

      expect(reconstructed).not.toContain("**")

      const defaultStyle = syntaxStyle.mergeStyles("default")
      const styledChunks = chunks.filter((c) => c.fg !== defaultStyle.fg || c.attributes !== 0)
      expect(styledChunks.length).toBeGreaterThan(5)
    })
  })

  describe("Style Inheritance", () => {
    test("should merge styles from nested highlights with child overriding parent", () => {
      const mockHighlights: SimpleHighlight[] = [
        [0, 20, "markup.link"], // Parent: entire link with underline
        [1, 11, "markup.link.label"], // Child: label with different color
        [13, 19, "markup.link.url"], // Child: url with different color
      ]

      const testStyle = SyntaxStyle.fromStyles({
        default: { fg: RGBA.fromInts(255, 255, 255, 255) },
        "markup.link": { fg: RGBA.fromInts(100, 100, 255, 255), underline: true }, // Blue underlined
        "markup.link.label": { fg: RGBA.fromInts(165, 214, 255, 255) }, // Light blue (no underline specified)
        "markup.link.url": { fg: RGBA.fromInts(88, 166, 255, 255) }, // Different blue (no underline specified)
      })

      const content = "[Link text](url)"

      const labelStyle = testStyle.getStyle("markup.link.label")!
      const urlStyle = testStyle.getStyle("markup.link.url")!

      const chunks = treeSitterToTextChunks(content, mockHighlights, testStyle)

      testStyle.destroy()

      expect(chunks.length).toBeGreaterThan(0)

      let currentPos = 0
      const labelChunks: typeof chunks = []
      const urlChunks: typeof chunks = []

      for (const chunk of chunks) {
        const chunkStart = currentPos
        const chunkEnd = currentPos + chunk.text.length

        // Label is at [1, 11] - "Link text"
        if (chunkStart >= 1 && chunkStart < 11 && chunk.text.length > 0) {
          labelChunks.push(chunk)
        }

        // URL is at [13, 19] - "url"
        if (chunkStart >= 13 && chunkStart < 19 && chunk.text.length > 0) {
          urlChunks.push(chunk)
        }

        currentPos = chunkEnd
      }

      expect(labelChunks.length).toBeGreaterThan(0)
      expect(urlChunks.length).toBeGreaterThan(0)

      const underlineAttr = createTextAttributes({ underline: true })
      for (const chunk of [...labelChunks, ...urlChunks]) {
        expect(chunk.attributes).toBe(underlineAttr)
      }

      for (const chunk of labelChunks) {
        expect(chunk.fg?.r).toBeCloseTo(labelStyle.fg!.r, 2)
        expect(chunk.fg?.g).toBeCloseTo(labelStyle.fg!.g, 2)
        expect(chunk.fg?.b).toBeCloseTo(labelStyle.fg!.b, 2)
      }

      for (const chunk of urlChunks) {
        expect(chunk.fg?.r).toBeCloseTo(urlStyle.fg!.r, 2)
        expect(chunk.fg?.g).toBeCloseTo(urlStyle.fg!.g, 2)
        expect(chunk.fg?.b).toBeCloseTo(urlStyle.fg!.b, 2)
      }
    })

    test("should merge multiple overlapping styles with correct priority", () => {
      const mockHighlights: SimpleHighlight[] = [
        [0, 10, "text"], // Base style
        [0, 10, "text.special"], // More specific: adds bold
        [0, 10, "text.special.highlighted"], // Most specific: adds underline
      ]

      const testStyle = SyntaxStyle.fromStyles({
        default: { fg: RGBA.fromInts(255, 255, 255, 255) },
        text: { fg: RGBA.fromInts(200, 200, 200, 255) }, // Gray
        "text.special": { bold: true }, // Add bold, no color change
        "text.special.highlighted": { underline: true, fg: RGBA.fromInts(255, 255, 100, 255) }, // Add underline and yellow
      })

      const content = "test text "
      const chunks = treeSitterToTextChunks(content, mockHighlights, testStyle)

      testStyle.destroy()

      expect(chunks.length).toBeGreaterThan(0)

      const chunk = chunks[0]

      expect(chunk.fg?.r).toBeCloseTo(1.0, 2)
      expect(chunk.fg?.g).toBeCloseTo(1.0, 2)
      expect(chunk.fg?.b).toBeCloseTo(100 / 255, 2)

      const expectedAttributes = createTextAttributes({ bold: true, underline: true })
      expect(chunk.attributes).toBe(expectedAttributes)
    })

    test("should handle style inheritance when parent only sets attributes", () => {
      const mockHighlights: SimpleHighlight[] = [
        [0, 15, "container"], // Parent: only underline
        [0, 5, "container.part1"], // Child: only color
        [5, 10, "container.part2"], // Child: different color
        [10, 15, "container.part3"], // Child: yet another color
      ]

      const testStyle = SyntaxStyle.fromStyles({
        default: { fg: RGBA.fromInts(255, 255, 255, 255) },
        container: { underline: true }, // Only underline, no color
        "container.part1": { fg: RGBA.fromInts(255, 100, 100, 255) }, // Red
        "container.part2": { fg: RGBA.fromInts(100, 255, 100, 255) }, // Green
        "container.part3": { fg: RGBA.fromInts(100, 100, 255, 255) }, // Blue
      })

      const content = "part1part2part3"
      const chunks = treeSitterToTextChunks(content, mockHighlights, testStyle)

      testStyle.destroy()

      expect(chunks.length).toBe(3)

      const underlineAttr = createTextAttributes({ underline: true })
      for (const chunk of chunks) {
        expect(chunk.attributes).toBe(underlineAttr)
      }

      expect(chunks[0].fg?.r).toBeCloseTo(1.0, 2) // 255 / 255
      expect(chunks[0].fg?.g).toBeCloseTo(100 / 255, 2)
      expect(chunks[0].fg?.b).toBeCloseTo(100 / 255, 2)

      expect(chunks[1].fg?.r).toBeCloseTo(100 / 255, 2)
      expect(chunks[1].fg?.g).toBeCloseTo(1.0, 2) // 255 / 255
      expect(chunks[1].fg?.b).toBeCloseTo(100 / 255, 2)

      expect(chunks[2].fg?.r).toBeCloseTo(100 / 255, 2)
      expect(chunks[2].fg?.g).toBeCloseTo(100 / 255, 2)
      expect(chunks[2].fg?.b).toBeCloseTo(1.0, 2) // 255 / 255
    })

    test("should handle markdown link with realistic tree-sitter output", async () => {
      const markdownCode = "[Label](url)"

      const result = await client.highlightOnce(markdownCode, "markdown")
      expect(result.highlights).toBeDefined()

      // IMPORTANT: Tree-sitter markdown parser emits:
      // - markup.link ONLY for brackets/parens: "[", "]", "(", ")"
      // - markup.link.label ONLY for the label text: "Label" (not nested under markup.link!)
      // - markup.link.url for the URL text: "url" (ALONG WITH markup.link as sibling)
      //
      // This means label does NOT inherit from markup.link because it's not a child range!
      // Therefore, if you want label underlined, you must specify it explicitly.

      const labelHighlights = result.highlights!.filter(
        ([start, end, group]) => group === "markup.link.label" && markdownCode.slice(start, end) === "Label",
      )
      expect(labelHighlights.length).toBe(1)

      const labelStart = labelHighlights[0][0]
      const labelEnd = labelHighlights[0][1]
      const labelHasParentLink = result.highlights!.some(
        ([start, end, group]) => group === "markup.link" && start === labelStart && end === labelEnd,
      )
      expect(labelHasParentLink).toBe(false) // Confirms label is NOT nested

      const linkStyle = SyntaxStyle.fromStyles({
        default: { fg: RGBA.fromInts(255, 255, 255, 255) },
        "markup.link": { underline: true }, // Brackets and parens
        "markup.link.label": { fg: RGBA.fromInts(165, 214, 255, 255), underline: true }, // Must set underline!
        "markup.link.url": { fg: RGBA.fromInts(88, 166, 255, 255), underline: true }, // Must set underline!
      })

      const styledText = await treeSitterToStyledText(markdownCode, "markdown", linkStyle, client, {
        conceal: { enabled: false },
      })
      const chunks = styledText.chunks

      linkStyle.destroy()

      const reconstructed = chunks.map((c) => c.text).join("")
      expect(reconstructed).toBe(markdownCode)

      const labelChunk = chunks.find((c) => c.text === "Label")
      const urlChunk = chunks.find((c) => c.text === "url")

      expect(labelChunk).toBeDefined()
      expect(urlChunk).toBeDefined()

      const underlineAttr = createTextAttributes({ underline: true })
      expect(labelChunk!.attributes).toBe(underlineAttr)
      expect(urlChunk!.attributes).toBe(underlineAttr)

      expect(labelChunk!.fg?.r).toBeCloseTo(165 / 255, 2)
      expect(urlChunk!.fg?.r).toBeCloseTo(88 / 255, 2)
    })

    test("should preserve original behavior for non-overlapping highlights", () => {
      const mockHighlights: SimpleHighlight[] = [
        [0, 5, "keyword"], // "const"
        [6, 11, "string"], // "'str'"
        [12, 15, "number"], // "123"
      ]

      const testStyle = SyntaxStyle.fromStyles({
        default: { fg: RGBA.fromInts(255, 255, 255, 255) },
        keyword: { fg: RGBA.fromInts(255, 100, 100, 255), bold: true },
        string: { fg: RGBA.fromInts(100, 255, 100, 255) },
        number: { fg: RGBA.fromInts(100, 100, 255, 255) },
      })

      const content = "const 'str' 123"
      const chunks = treeSitterToTextChunks(content, mockHighlights, testStyle)

      testStyle.destroy()

      expect(chunks.length).toBe(5)

      expect(chunks[0].text).toBe("const")
      expect(chunks[0].fg?.r).toBeCloseTo(1.0, 2) // 255 / 255
      expect(chunks[0].attributes).toBe(createTextAttributes({ bold: true }))

      expect(chunks[1].text).toBe(" ")

      expect(chunks[2].text).toBe("'str'")
      expect(chunks[2].fg?.g).toBeCloseTo(1.0, 2) // 255 / 255

      expect(chunks[3].text).toBe(" ")

      expect(chunks[4].text).toBe("123")
      expect(chunks[4].fg?.b).toBeCloseTo(1.0, 2) // 255 / 255
    })

    test("should demonstrate when inheritance works vs when it does not", () => {
      const nestedHighlights: SimpleHighlight[] = [
        [0, 10, "parent"], // Parent covers entire range
        [2, 8, "parent.child"], // Child is INSIDE parent
      ]

      const nestedStyle = SyntaxStyle.fromStyles({
        default: { fg: RGBA.fromInts(255, 255, 255, 255) },
        parent: { underline: true },
        "parent.child": { fg: RGBA.fromInts(200, 100, 100, 255) }, // No underline specified
      })

      const nestedContent = "0123456789"
      const nestedChunks = treeSitterToTextChunks(nestedContent, nestedHighlights, nestedStyle)

      nestedStyle.destroy()

      const childChunk = nestedChunks.find((c) => c.text.includes("234567"))
      expect(childChunk).toBeDefined()
      expect(childChunk!.attributes).toBe(createTextAttributes({ underline: true }))
      expect(childChunk!.fg?.r).toBeCloseTo(200 / 255, 2)

      const siblingHighlights: SimpleHighlight[] = [
        [0, 5, "typeA"], // First range
        [5, 10, "typeB"], // Second range (NOT nested)
      ]

      const siblingStyle = SyntaxStyle.fromStyles({
        default: { fg: RGBA.fromInts(255, 255, 255, 255) },
        typeA: { underline: true, fg: RGBA.fromInts(100, 100, 255, 255) },
        typeB: { fg: RGBA.fromInts(255, 100, 100, 255) }, // No underline
      })

      const siblingContent = "0123456789"
      const siblingChunks = treeSitterToTextChunks(siblingContent, siblingHighlights, siblingStyle)

      siblingStyle.destroy()

      expect(siblingChunks.length).toBe(2)

      expect(siblingChunks[0].attributes).toBe(createTextAttributes({ underline: true }))

      expect(siblingChunks[1].attributes).toBe(0) // No attributes
      expect(siblingChunks[1].fg?.r).toBeCloseTo(255 / 255, 2)
    })

    test("should handle child style completely overriding parent attributes", () => {
      const mockHighlights: SimpleHighlight[] = [
        [0, 10, "parent"],
        [0, 10, "parent.child"],
      ]

      const testStyle = SyntaxStyle.fromStyles({
        default: { fg: RGBA.fromInts(255, 255, 255, 255) },
        parent: { bold: true, italic: true, underline: true },
        "parent.child": { bold: false, fg: RGBA.fromInts(200, 200, 200, 255) }, // Override bold, set color
      })

      const content = "test text "
      const chunks = treeSitterToTextChunks(content, mockHighlights, testStyle)

      testStyle.destroy()

      expect(chunks.length).toBeGreaterThan(0)

      const chunk = chunks[0]

      expect(chunk.fg?.r).toBeCloseTo(200 / 255, 2)

      const expectedAttributes = createTextAttributes({ bold: false, italic: true, underline: true })
      expect(chunk.attributes).toBe(expectedAttributes)
    })
  })
})

// ============================================================================
// Differential correctness harness (Wave 3 Loop D). The optimized
// treeSitterToTextChunks must be output-identical to the pre-optimization
// implementation. Sparked by .yesmem/bench/wave3-loop-d/. Spanning the full
// chunk sequence (text, style, concealment, boundaries) over the §8.3 corpus.
// ============================================================================

function legacyGetSpecificity(group: string): number {
  return group.split(".").length
}

function legacyShouldSuppressInInjection(group: string, meta: any): boolean {
  if (meta?.isInjection) {
    return false
  }
  return group === "markup.raw.block"
}

interface LegacyBoundary {
  offset: number
  type: "start" | "end"
  highlightIndex: number
}

function legacyTreeSitterToTextChunks(
  content: string,
  highlights: SimpleHighlight[],
  syntaxStyle: SyntaxStyle,
  options?: { enabled?: boolean; baseHighlight?: string },
): TextChunk[] {
  const chunks: TextChunk[] = []
  const defaultStyle = syntaxStyle.getStyle("default")
  const concealEnabled = options?.enabled ?? true
  const baseStyle = options?.baseHighlight ? syntaxStyle.getStyle(options.baseHighlight) : undefined

  const injectionContainerRanges: Array<{ start: number; end: number }> = []
  const boundaries: LegacyBoundary[] = []

  for (let i = 0; i < highlights.length; i++) {
    const [start, end, , meta] = highlights[i]
    if (start === end) continue // Skip zero-length ranges
    if (meta?.containsInjection) {
      injectionContainerRanges.push({ start, end })
    }
    boundaries.push({ offset: start, type: "start", highlightIndex: i })
    boundaries.push({ offset: end, type: "end", highlightIndex: i })
  }

  // Sort boundaries by offset, with ends before starts at same offset
  // This ensures we close old ranges before opening new ones at the same position
  boundaries.sort((a, b) => {
    if (a.offset !== b.offset) return a.offset - b.offset
    if (a.type === "end" && b.type === "start") return -1
    if (a.type === "start" && b.type === "end") return 1
    return 0
  })

  const activeHighlights = new Set<number>()
  let currentOffset = 0

  for (let i = 0; i < boundaries.length; i++) {
    const boundary = boundaries[i]

    if (currentOffset < boundary.offset && activeHighlights.size > 0) {
      const segmentText = content.slice(currentOffset, boundary.offset)

      const activeGroups: Array<{ group: string; meta: any; index: number }> = []
      for (const idx of activeHighlights) {
        const [, , group, meta] = highlights[idx]
        activeGroups.push({ group, meta, index: idx })
      }

      const concealHighlight = concealEnabled
        ? activeGroups.find(
            (h) => h.meta?.conceal !== undefined || h.group === "conceal" || h.group.startsWith("conceal."),
          )
        : undefined

      if (concealHighlight) {
        let replacementText = ""

        if (concealHighlight.meta?.conceal !== undefined) {
          replacementText = concealHighlight.meta.conceal
        } else if (concealHighlight.group === "conceal.with.space") {
          replacementText = " "
        }

        if (replacementText) {
          chunks.push({
            __isChunk: true,
            text: replacementText,
            fg: defaultStyle?.fg,
            bg: defaultStyle?.bg,
            attributes: defaultStyle
              ? createTextAttributes({
                  bold: defaultStyle.bold,
                  italic: defaultStyle.italic,
                  underline: defaultStyle.underline,
                  dim: defaultStyle.dim,
                })
              : 0,
          })
        }
      } else {
        const insideInjectionContainer = injectionContainerRanges.some(
          (range) => currentOffset >= range.start && currentOffset < range.end,
        )

        const validGroups = activeGroups.filter((h) => {
          if (insideInjectionContainer && legacyShouldSuppressInInjection(h.group, h.meta)) {
            return false
          }
          return true
        })

        const sortedGroups = validGroups.sort((a, b) => {
          const aSpec = legacyGetSpecificity(a.group)
          const bSpec = legacyGetSpecificity(b.group)
          if (aSpec !== bSpec) return aSpec - bSpec
          return a.index - b.index
        })

        const mergedStyle: StyleDefinition = baseStyle ? { ...baseStyle } : {}

        for (const { group } of sortedGroups) {
          let styleForGroup = syntaxStyle.getStyle(group)

          if (!styleForGroup && group.includes(".")) {
            const baseName = group.split(".")[0]
            styleForGroup = syntaxStyle.getStyle(baseName)
          }

          if (styleForGroup) {
            if (styleForGroup.fg !== undefined) mergedStyle.fg = styleForGroup.fg
            if (styleForGroup.bg !== undefined) mergedStyle.bg = styleForGroup.bg
            if (styleForGroup.bold !== undefined) mergedStyle.bold = styleForGroup.bold
            if (styleForGroup.italic !== undefined) mergedStyle.italic = styleForGroup.italic
            if (styleForGroup.underline !== undefined) mergedStyle.underline = styleForGroup.underline
            if (styleForGroup.dim !== undefined) mergedStyle.dim = styleForGroup.dim
          } else {
            if (group.includes(".")) {
              const baseName = group.split(".")[0]
              if (env.OTUI_TS_STYLE_WARN) {
                console.warn(
                  `Syntax style not found for group "${group}" or base scope "${baseName}", using default style`,
                )
              }
            } else {
              if (env.OTUI_TS_STYLE_WARN) {
                console.warn(`Syntax style not found for group "${group}", using default style`)
              }
            }
          }
        }

        const finalStyle = Object.keys(mergedStyle).length > 0 ? mergedStyle : defaultStyle

        chunks.push({
          __isChunk: true,
          text: segmentText,
          fg: finalStyle?.fg,
          bg: finalStyle?.bg,
          attributes: finalStyle
            ? createTextAttributes({
                bold: finalStyle.bold,
                italic: finalStyle.italic,
                underline: finalStyle.underline,
                dim: finalStyle.dim,
              })
            : 0,
        })
      }
    } else if (currentOffset < boundary.offset) {
      const text = content.slice(currentOffset, boundary.offset)
      const style = baseStyle ?? defaultStyle
      chunks.push({
        __isChunk: true,
        text,
        fg: style?.fg,
        bg: style?.bg,
        attributes: style
          ? createTextAttributes({
              bold: style.bold,
              italic: style.italic,
              underline: style.underline,
              dim: style.dim,
            })
          : 0,
      })
    }

    if (boundary.type === "start") {
      activeHighlights.add(boundary.highlightIndex)
    } else {
      activeHighlights.delete(boundary.highlightIndex)

      if (concealEnabled) {
        const [, , group, meta] = highlights[boundary.highlightIndex]
        if (meta?.concealLines !== undefined) {
          if (boundary.offset < content.length && content[boundary.offset] === "\n") {
            currentOffset = boundary.offset + 1
            continue
          }
        }

        if (meta?.conceal !== undefined) {
          if (meta.conceal === " ") {
            if (boundary.offset < content.length && content[boundary.offset] === " ") {
              currentOffset = boundary.offset + 1
              continue
            }
          } else if (meta.conceal === "" && group === "conceal" && !meta.isInjection) {
            if (boundary.offset < content.length && content[boundary.offset] === " ") {
              currentOffset = boundary.offset + 1
              continue
            }
          }
        }
      }
    }

    currentOffset = boundary.offset
  }

  if (currentOffset < content.length) {
    const text = content.slice(currentOffset)
    const style = baseStyle ?? defaultStyle
    chunks.push({
      __isChunk: true,
      text,
      fg: style?.fg,
      bg: style?.bg,
      attributes: style
        ? createTextAttributes({
            bold: style.bold,
            italic: style.italic,
            underline: style.underline,
            dim: style.dim,
          })
        : 0,
    })
  }

  return chunks
}

// --- corpus helpers (deterministic) -------------------------------------------------

function mulberry32(seed: number) {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const UNICODE_CELLS = [
  "é", // combining on single precomposed
  "e\u0301", // combining mark
  "\u{1F600}", // surrogate / emoji
  "\u200d", // ZWJ
  "\u{1F1E6}\u{1F1E7}", // regional indicator flags
  "\u{1F3FB}", // skin tone modifier
  "\uac00", // hangul syllable
  "\u{1FA9D}", // keycap-ish wide
  "界", // CJK wide
  "a", // ascii
]

interface DiffCase {
  name: string
  content: string
  highlights: SimpleHighlight[]
  options?: { enabled?: boolean; baseHighlight?: string }
}

function buildDiffCorpus(): DiffCase[] {
  const cases: DiffCase[] = []

  // sparse: few isolated highlights
  cases.push({
    name: "sparse",
    content: "const a = 1; // hi\nconst b = 2; // yo\n",
    highlights: [
      [0, 5, "keyword", undefined],
      [14, 18, "comment", undefined],
      [20, 25, "keyword", undefined],
      [34, 38, "comment", undefined],
    ],
  })

  // dense: adjacent highlights covering everything
  cases.push({
    name: "dense",
    content: "abcd efgh ijkl mnop",
    highlights: [
      [0, 4, "string", undefined],
      [4, 5, "keyword", undefined],
      [5, 9, "number", undefined],
      [9, 15, "comment", undefined],
    ],
  })

  // nested ranges with overlapping siblings and priorities
  cases.push({
    name: "nested-overlap",
    content: "0123456789abcdefghij",
    highlights: [
      [0, 20, "markup.raw.block", undefined],
      [2, 18, "string", undefined],
      [5, 15, "keyword", undefined],
      [7, 12, "number", undefined],
      [4, 16, "comment", undefined],
    ],
  })

  // equal start
  cases.push({
    name: "equal-start",
    content: "0123456789",
    highlights: [
      [0, 10, "keyword", undefined],
      [0, 6, "string", undefined],
      [0, 3, "number", undefined],
    ],
  })

  // equal end
  cases.push({
    name: "equal-end",
    content: "0123456789",
    highlights: [
      [0, 9, "keyword", undefined],
      [2, 9, "string", undefined],
      [5, 9, "number", undefined],
    ],
  })

  // equal start AND end (fully identical ranges, different groups)
  cases.push({
    name: "equal-both",
    content: "0123456789",
    highlights: [
      [2, 7, "keyword", undefined],
      [2, 7, "string", undefined],
      [2, 7, "number", undefined],
    ],
  })

  // empty + invalid spans
  cases.push({
    name: "empty-invalid-spans",
    content: "hello world",
    highlights: [
      [3, 3, "keyword", undefined], // zero-length
      [0, 5, "string", undefined], // start == end? no
      [6, 11, "number", undefined],
      [9, 2, "comment", undefined], // start > end (degenerate, end before start)
      [11, 12, "keyword", undefined], // starts at content.length
    ],
  })

  // injection container (markup.raw.block) with inner groups
  cases.push({
    name: "injection-container",
    content: "para ```js const x=1 ``` more",
    highlights: [
      [0, 26, "markup.raw.block", { containsInjection: true }],
      [8, 10, "punctuation", { isInjection: true }],
      [10, 18, "keyword", { isInjection: true }],
      [18, 21, "number", { isInjection: true }],
    ],
  })

  // conceal with space replacement
  cases.push({
    name: "conceal-space",
    content: "text [url](https://x) more",
    highlights: [
      [5, 9, "bracket", { conceal: " " }],
      [9, 12, "string", undefined],
      [12, 13, "bracket", { conceal: "" }],
      [13, 23, "conceal", undefined],
      [23, 24, "bracket", { conceal: " " }],
    ],
  })

  // conceal.with.space group
  cases.push({
    name: "conceal-with-space-group",
    content: "aaa bb cc",
    highlights: [
      [0, 3, "conceal.with.space", { conceal: " " }],
      [4, 6, "string", undefined],
    ],
  })

  // concealLines: whole line conceal on newline
  cases.push({
    name: "conceal-lines",
    content: "line1\nline2\nline3",
    highlights: [
      [0, 5, "conceal", { concealLines: "" }],
      [8, 13, "conceal", { concealLines: "" }],
    ],
  })

  // baseHighlight option
  cases.push({
    name: "base-highlight",
    content: "const x = 1;",
    highlights: [[0, 13, "keyword", undefined]],
    options: { baseHighlight: "comment" },
  })

  // conceal disabled
  cases.push({
    name: "conceal-disabled",
    content: "text [url](x)",
    highlights: [
      [5, 9, "bracket", { conceal: " " }],
      [10, 11, "conceal", undefined],
    ],
    options: { enabled: false },
  })

  // CRLF
  cases.push({
    name: "crlf",
    content: "const a = 1;\r\nconst b = 2;\r\n",
    highlights: [
      [0, 5, "keyword", undefined],
      [16, 21, "keyword", undefined],
    ],
  })

  // unicode cells: wide, combining, surrogate, hangul, flags, skin-tone, ZWJ
  cases.push({
    name: "unicode-cells",
    content: UNICODE_CELLS.join(" "),
    highlights: [
      [0, 1, "string", undefined],
      [2, 7, "keyword", undefined],
      [8, 10, "comment", undefined],
    ],
  })

  // nested conceal inside injection (heading marker non-injection conceal handling)
  cases.push({
    name: "conceal-in-injection",
    content: "# heading ",
    highlights: [
      [0, 1, "conceal", { conceal: "", isInjection: false }],
      [2, 9, "markup.heading", undefined],
    ],
  })

  // injection with isInjection suppress override
  cases.push({
    name: "injection-suppress-override",
    content: "```js let x=1 ```",
    highlights: [
      [0, 17, "markup.raw.block", { containsInjection: true }],
      [5, 8, "markup.raw.block", { isInjection: true }], // should NOT be suppressed
      [8, 14, "keyword", { isInjection: true }],
    ],
  })

  return cases
}

function generateMixedHighlights(
  lines: number,
  seed: number,
  density: number,
): { content: string; hl: SimpleHighlight[] } {
  const rnd = mulberry32(seed)
  const groups = ["keyword", "string", "number", "function", "comment", "variable", "type", "markup.raw.block"]
  let content = ""
  const hl: SimpleHighlight[] = []
  for (let li = 0; li < lines; li++) {
    const start = content.length
    const line = `let id${li} = "val${li}" + f(${li}); // note ${li}\n`
    content += line
    for (let s = 0; s < density; s++) {
      // Positions relative to the line so ranges stay valid (start < end, within the line).
      const relA = Math.floor(rnd() * (line.length - 2))
      const a = start + relA
      const len = 1 + Math.floor(rnd() * (line.length - relA - 1))
      const g = groups[Math.floor(rnd() * groups.length)]
      hl.push([a, a + len, g, undefined])
    }
  }
  return { content, hl }
}

function chunkSignature(chunk: TextChunk): string {
  return JSON.stringify([chunk.text, chunk.fg, chunk.bg, chunk.attributes])
}

const STYLE_STYLES: Record<string, any> = {
  default: { fg: { r: 255, g: 255, b: 255, a: 1 } },
  keyword: { fg: { r: 255, g: 100, b: 100, a: 1 }, bold: true },
  string: { fg: { r: 100, g: 255, b: 100, a: 1 } },
  number: { fg: { r: 100, g: 100, b: 255, a: 1 } },
  function: { fg: { r: 255, g: 255, b: 100, a: 1 }, italic: true },
  comment: { fg: { r: 128, g: 128, b: 128, a: 1 }, italic: true },
  variable: { fg: { r: 200, g: 200, b: 255, a: 1 } },
  type: { fg: { r: 255, g: 200, b: 100, a: 1 } },
  punctuation: { fg: { r: 150, g: 150, b: 150, a: 1 } },
  bracket: { fg: { r: 210, g: 210, b: 210, a: 1 } },
  conceal: { fg: { r: 0, g: 0, b: 0, a: 1 } },
  "conceal.with.space": { fg: { r: 0, g: 0, b: 0, a: 1 } },
  "markup.raw": { fg: { r: 200, g: 255, b: 200, a: 1 } },
  "markup.raw.block": { fg: { r: 200, g: 255, b: 200, a: 1 } },
  "markup.heading": { fg: { r: 255, g: 200, b: 200, a: 1 }, bold: true },
}
const diffStyleStub = {
  getStyle(name: string) {
    return (STYLE_STYLES as Record<string, any>)[name]
  },
} as unknown as SyntaxStyle

function compareChunkSequences(legacy: TextChunk[], opt: TextChunk[], context: string): void {
  expect(opt.length, `${context}: chunk count`).toBe(legacy.length)
  for (let i = 0; i < legacy.length; i++) {
    expect(chunkSignature(opt[i]), `${context}: chunk[${i}]`).toBe(chunkSignature(legacy[i]))
  }
}

describe("Wave3 Loop D differential: optimized vs legacy oracle", () => {
  const corpus = buildDiffCorpus()
  for (const c of corpus) {
    test(`differential ${c.name}`, () => {
      const legacy = legacyTreeSitterToTextChunks(c.content, c.highlights, diffStyleStub, c.options)
      const opt = treeSitterToTextChunks(c.content, c.highlights, diffStyleStub, c.options)
      compareChunkSequences(legacy, opt, c.name)
    })
  }

  const large = [
    [100, 2, 1],
    [1000, 3, 2],
    [1000, 8, 4],
  ] as const
  for (const [lines, density, seed] of large) {
    test(`differential large lines=${lines} density=${density}`, () => {
      const { content, hl } = generateMixedHighlights(lines, seed, density)
      const legacy = legacyTreeSitterToTextChunks(content, hl, diffStyleStub)
      const opt = treeSitterToTextChunks(content, hl, diffStyleStub)
      compareChunkSequences(legacy, opt, `large-${lines}-${density}`)
    }, 120_000)
  }
})
