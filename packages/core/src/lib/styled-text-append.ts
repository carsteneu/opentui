import type { RGBA } from "./RGBA.js"
import type { TextChunk } from "../text-buffer.js"

function colorsEqual(left: RGBA | undefined, right: RGBA | undefined): boolean {
  if (left === right) return true
  if (!left || !right) return false
  return left.equals(right)
}

function stylesEqual(left: TextChunk, right: TextChunk): boolean {
  return (
    colorsEqual(left.fg, right.fg) &&
    colorsEqual(left.bg, right.bg) &&
    (left.attributes ?? 0) === (right.attributes ?? 0) &&
    left.link?.url === right.link?.url
  )
}

function isSafeLineBoundary(previous: string, tail: string): boolean {
  if (tail.length === 0 || previous.endsWith("\r")) return false
  return previous.endsWith("\n") || tail.startsWith("\n")
}

function nextNonEmptyChunk(chunks: readonly TextChunk[], start: number): number {
  let index = start
  while (index < chunks.length && chunks[index]!.text.length === 0) index++
  return index
}

/**
 * Return the styled tail only when both source and rendered output are conservative,
 * line-boundary appends and every already-rendered code unit keeps the same style.
 */
export function getSafeStyledAppend(
  previousSource: string,
  nextSource: string,
  previousChunks: readonly TextChunk[],
  nextChunks: readonly TextChunk[],
): TextChunk[] | null {
  if (
    previousSource.length === 0 ||
    !nextSource.startsWith(previousSource) ||
    nextSource.length === previousSource.length
  )
    return null

  const sourceTail = nextSource.slice(previousSource.length)
  if (!isSafeLineBoundary(previousSource, sourceTail)) return null

  const previousRendered = previousChunks.map((chunk) => chunk.text).join("")
  const nextRendered = nextChunks.map((chunk) => chunk.text).join("")
  if (
    previousRendered.length === 0 ||
    !nextRendered.startsWith(previousRendered) ||
    nextRendered.length === previousRendered.length
  )
    return null

  const renderedTail = nextRendered.slice(previousRendered.length)
  if (!isSafeLineBoundary(previousRendered, renderedTail)) return null

  let previousIndex = nextNonEmptyChunk(previousChunks, 0)
  let nextIndex = nextNonEmptyChunk(nextChunks, 0)
  let previousOffset = 0
  let nextOffset = 0

  while (previousIndex < previousChunks.length) {
    if (nextIndex >= nextChunks.length) return null
    const previous = previousChunks[previousIndex]!
    const next = nextChunks[nextIndex]!
    if (!stylesEqual(previous, next)) return null

    const count = Math.min(previous.text.length - previousOffset, next.text.length - nextOffset)
    if (previous.text.slice(previousOffset, previousOffset + count) !== next.text.slice(nextOffset, nextOffset + count))
      return null

    previousOffset += count
    nextOffset += count
    if (previousOffset === previous.text.length) {
      previousIndex = nextNonEmptyChunk(previousChunks, previousIndex + 1)
      previousOffset = 0
    }
    if (nextOffset === next.text.length) {
      nextIndex = nextNonEmptyChunk(nextChunks, nextIndex + 1)
      nextOffset = 0
    }
  }

  const tail: TextChunk[] = []
  if (nextIndex < nextChunks.length && nextOffset > 0) {
    const chunk = nextChunks[nextIndex]!
    const text = chunk.text.slice(nextOffset)
    if (text.length > 0) tail.push({ ...chunk, text })
    nextIndex++
  }
  for (; nextIndex < nextChunks.length; nextIndex++) {
    const chunk = nextChunks[nextIndex]!
    if (chunk.text.length > 0) tail.push(chunk)
  }

  return tail.map((chunk) => ({ ...chunk }))
}
