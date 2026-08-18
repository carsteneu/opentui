import type { RGBA } from "./RGBA.js"
import type { TextChunk } from "../text-buffer.js"

export interface StyledAppendSnapshot {
  source: string
  renderedLength: number
  renderedEnd: string
  canonicalPrefix: string
}

function colorKey(color: RGBA | undefined): string {
  if (!color) return "-"
  const buffer = color.buffer
  return `${buffer[0]},${buffer[1]},${buffer[2]},${buffer[3]}`
}

function styleKey(chunk: TextChunk): string {
  return `${colorKey(chunk.fg)}|${colorKey(chunk.bg)}|${chunk.attributes ?? 0}|${JSON.stringify(chunk.link?.url ?? null)}`
}

function canonicalizePrefix(chunks: readonly TextChunk[], limit = Number.POSITIVE_INFINITY) {
  const parts: string[] = []
  let currentStyle: string | undefined
  let currentText: string[] = []
  let currentLength = 0
  let renderedLength = 0
  let renderedEnd = ""

  const flush = () => {
    if (currentStyle === undefined) return
    parts.push(`${currentStyle.length}:`, currentStyle, `${currentLength}:`, currentText.join(""))
    currentStyle = undefined
    currentText = []
    currentLength = 0
  }

  for (const chunk of chunks) {
    if (renderedLength >= limit) break
    const remaining = limit - renderedLength
    const text = chunk.text.length > remaining ? chunk.text.slice(0, remaining) : chunk.text
    if (text.length === 0) continue

    const key = styleKey(chunk)
    if (currentStyle !== key) {
      flush()
      currentStyle = key
    }
    currentText.push(text)
    currentLength += text.length
    renderedLength += text.length
    renderedEnd = text.at(-1)!
  }
  flush()

  return { canonical: parts.join(""), renderedLength, renderedEnd }
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

function isSafeLineBoundary(previousEnd: string, tail: readonly TextChunk[]): boolean {
  const first = tail.find((chunk) => chunk.text.length > 0)?.text[0]
  return previousEnd !== "\r" && first !== undefined && (previousEnd === "\n" || first === "\n")
}

/**
 * Capture an immutable, chunk-boundary-independent representation of committed styled output.
 * The canonical string retains no mutable chunk or color objects.
 */
export function createStyledAppendSnapshot(source: string, chunks: readonly TextChunk[]): StyledAppendSnapshot {
  const rendered = canonicalizePrefix(chunks)
  return {
    source,
    renderedLength: rendered.renderedLength,
    renderedEnd: rendered.renderedEnd,
    canonicalPrefix: rendered.canonical,
  }
}

/**
 * Return the styled tail only when source, rendered text, and every prefix style
 * are unchanged at a conservative line boundary.
 */
export function getSafeStyledAppend(
  previous: StyledAppendSnapshot,
  nextSource: string,
  nextChunks: readonly TextChunk[],
): TextChunk[] | null {
  if (
    previous.source.length === 0 ||
    !nextSource.startsWith(previous.source) ||
    nextSource.length === previous.source.length
  )
    return null

  const sourceTail = nextSource.slice(previous.source.length)
  if (previous.source.endsWith("\r") || (!previous.source.endsWith("\n") && !sourceTail.startsWith("\n"))) return null

  const nextPrefix = canonicalizePrefix(nextChunks, previous.renderedLength)
  if (nextPrefix.renderedLength !== previous.renderedLength || nextPrefix.canonical !== previous.canonicalPrefix)
    return null

  const tail = extractTail(nextChunks, previous.renderedLength)
  if (!tail || tail.length === 0 || !isSafeLineBoundary(previous.renderedEnd, tail)) return null
  return tail
}
