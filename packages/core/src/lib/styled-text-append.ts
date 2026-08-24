import type { RGBA } from "./RGBA.js"
import type { TextChunk } from "../text-buffer.js"

export interface StyledAppendSnapshot {
  source: string
  renderedText: string
  runEnds: Uint32Array
  runStyles: Uint32Array
  styleKeys: readonly string[]
}

function colorKey(color: RGBA | undefined): string {
  if (!color) return "-"
  const buffer = color.buffer
  return `${buffer[0]},${buffer[1]},${buffer[2]},${buffer[3]}`
}

function styleKey(chunk: TextChunk): string {
  return `${colorKey(chunk.fg)}|${colorKey(chunk.bg)}|${chunk.attributes ?? 0}|${JSON.stringify(chunk.link?.url ?? null)}`
}

function extractTail(chunks: readonly TextChunk[], prefixLength: number): TextChunk[] | null {
  const tail: TextChunk[] = []
  let remaining = prefixLength

  for (const chunk of chunks) {
    if (remaining >= chunk.text.length) {
      remaining -= chunk.text.length
      continue
    }

    const text = chunk.text.slice(remaining)
    remaining = 0
    if (text.length > 0) tail.push({ ...chunk, text })
  }

  return remaining === 0 ? tail : null
}

function prefixStylesEqual(previous: StyledAppendSnapshot, next: StyledAppendSnapshot): boolean {
  const prefixLength = previous.renderedText.length
  let previousRun = 0
  let nextRun = 0
  let offset = 0

  while (offset < prefixLength) {
    const previousEnd = previous.runEnds[previousRun]
    const nextEnd = next.runEnds[nextRun]
    if (previousEnd === undefined || nextEnd === undefined) return false
    if (previous.styleKeys[previous.runStyles[previousRun]!] !== next.styleKeys[next.runStyles[nextRun]!]) return false

    offset = Math.min(previousEnd, nextEnd, prefixLength)
    if (previousEnd === offset) previousRun++
    if (nextEnd === offset) nextRun++
  }

  return true
}

/** Capture immutable styled output without retaining mutable chunk or color objects. */
export function createStyledAppendSnapshot(source: string, chunks: readonly TextChunk[]): StyledAppendSnapshot {
  const textParts: string[] = []
  const runEnds: number[] = []
  const runStyles: number[] = []
  const styleKeys: string[] = []
  const styleIds = new Map<string, number>()
  let renderedLength = 0

  for (const chunk of chunks) {
    if (chunk.text.length === 0) continue
    const key = styleKey(chunk)
    let styleId = styleIds.get(key)
    if (styleId === undefined) {
      styleId = styleKeys.length
      styleIds.set(key, styleId)
      styleKeys.push(key)
    }

    textParts.push(chunk.text)
    renderedLength += chunk.text.length
    const lastRun = runStyles.length - 1
    if (lastRun >= 0 && runStyles[lastRun] === styleId) {
      runEnds[lastRun] = renderedLength
    } else {
      runStyles.push(styleId)
      runEnds.push(renderedLength)
    }
  }

  return {
    source,
    renderedText: textParts.join(""),
    runEnds: Uint32Array.from(runEnds),
    runStyles: Uint32Array.from(runStyles),
    styleKeys,
  }
}

/**
 * Return the styled tail only when source, rendered text, and every prefix style
 * are unchanged at a conservative line boundary.
 */
export function getSafeStyledAppend(
  previous: StyledAppendSnapshot,
  next: StyledAppendSnapshot,
  nextChunks: readonly TextChunk[],
): TextChunk[] | null {
  if (
    previous.source.length === 0 ||
    !next.source.startsWith(previous.source) ||
    next.source.length === previous.source.length
  )
    return null

  const sourceTail = next.source.slice(previous.source.length)
  if (previous.source.endsWith("\r") || (!previous.source.endsWith("\n") && !sourceTail.startsWith("\n"))) return null
  if (
    previous.renderedText.length === 0 ||
    !next.renderedText.startsWith(previous.renderedText) ||
    next.renderedText.length === previous.renderedText.length ||
    !prefixStylesEqual(previous, next)
  )
    return null

  const tail = extractTail(nextChunks, previous.renderedText.length)
  if (!tail || tail.length === 0) return null
  const renderedTail = next.renderedText.slice(previous.renderedText.length)
  if (previous.renderedText.endsWith("\r") || (!previous.renderedText.endsWith("\n") && !renderedTail.startsWith("\n")))
    return null
  return tail
}
