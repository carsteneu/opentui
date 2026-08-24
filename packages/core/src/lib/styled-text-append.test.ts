import { describe, expect, test } from "bun:test"
import { RGBA } from "./RGBA.js"
import { createStyledAppendSnapshot, getSafeStyledAppend } from "./styled-text-append.js"
import type { TextChunk } from "../text-buffer.js"

const red = RGBA.fromValues(255, 0, 0, 255)
const green = RGBA.fromValues(0, 255, 0, 255)

function chunk(text: string, options: Omit<TextChunk, "__isChunk" | "text"> = {}): TextChunk {
  return { __isChunk: true, text, ...options }
}

function safeAppend(
  previousSource: string,
  nextSource: string,
  previousChunks: readonly TextChunk[],
  nextChunks: readonly TextChunk[],
) {
  return getSafeStyledAppend(
    createStyledAppendSnapshot(previousSource, previousChunks),
    createStyledAppendSnapshot(nextSource, nextChunks),
    nextChunks,
  )
}

describe("getSafeStyledAppend", () => {
  test("extracts a line tail even when the final style run was coalesced", () => {
    const previous = [chunk("const a = 1", { fg: red })]
    const next = [chunk("const a = 1\nconst b = 2", { fg: red })]

    expect(safeAppend("const a = 1", "const a = 1\nconst b = 2", previous, next)).toEqual([
      chunk("\nconst b = 2", { fg: red }),
    ])
  })

  test("accepts equivalent prefix styles across changed chunk boundaries", () => {
    const previous = [chunk("const ", { fg: red }), chunk("a = 1", { fg: green, attributes: 1 })]
    const next = [
      chunk("co", { fg: red }),
      chunk("nst ", { fg: red }),
      chunk("a = 1", { fg: green, attributes: 1 }),
      chunk("\nnext", { link: { url: "https://example.test" } }),
    ]

    expect(safeAppend("const a = 1", "const a = 1\nnext", previous, next)).toEqual([
      chunk("\nnext", { link: { url: "https://example.test" } }),
    ])
  })

  test("rejects a changed style anywhere in the existing prefix", () => {
    const previous = [chunk("const a = 1", { fg: red })]
    const next = [chunk("const a = 1", { fg: green }), chunk("\nnext", { fg: red })]

    expect(safeAppend("const a = 1", "const a = 1\nnext", previous, next)).toBeNull()
  })

  test("rejects replacement edits and unsafe grapheme or CRLF boundaries", () => {
    const previous = [chunk("value")]
    expect(safeAppend("value", "other\nvalue", previous, [chunk("other\nvalue")])).toBeNull()
    expect(safeAppend("value", "valué", previous, [chunk("valué")])).toBeNull()
    expect(safeAppend("value\r", "value\r\nnext", [chunk("value\r")], [chunk("value\r\nnext")])).toBeNull()
  })

  test("keeps an immutable style fingerprint without retaining mutable colors", () => {
    const mutable = RGBA.fromValues(1, 0, 0, 1)
    const snapshot = createStyledAppendSnapshot("value", [chunk("value", { fg: mutable })])
    mutable.r = 0
    mutable.g = 1

    const next = [chunk("value\nnext", { fg: mutable })]
    expect(getSafeStyledAppend(snapshot, createStyledAppendSnapshot("value\nnext", next), next)).toBeNull()
  })
})
