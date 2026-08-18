import type { TextChunk } from "../text-buffer.js"
import { StyledText } from "./styled-text.js"
import { SyntaxStyle, type StyleDefinition } from "../syntax-style.js"
import { TreeSitterClient } from "./tree-sitter/client.js"
import type { SimpleHighlight } from "./tree-sitter/types.js"
import { createTextAttributes } from "../utils.js"
import { registerEnvVar, env } from "./env.js"

registerEnvVar({ name: "OTUI_TS_STYLE_WARN", default: false, description: "Enable warnings for missing syntax styles" })

interface TextChunkOptions {
  enabled?: boolean
  baseHighlight?: string
}

interface Boundary {
  offset: number
  type: "start" | "end"
  highlightIndex: number
}

function getSpecificity(group: string): number {
  return group.split(".").length
}

function shouldSuppressInInjection(group: string, meta: any): boolean {
  if (meta?.isInjection) {
    return false
  }

  // Check if this is a parent block that should be suppressed
  // TODO: This is language/highlight specific,
  // not generic enough. Needs a more generic solution.
  // The styles need to be more like a stack that gets merged
  // and for a container with injections we just don't push that container style
  return group === "markup.raw.block"
}

export function treeSitterToTextChunks(
  content: string,
  highlights: SimpleHighlight[],
  syntaxStyle: SyntaxStyle,
  options?: TextChunkOptions,
): TextChunk[] {
  const chunks: TextChunk[] = []
  const defaultStyle = syntaxStyle.getStyle("default")
  const concealEnabled = options?.enabled ?? true
  const baseStyle = options?.baseHighlight ? syntaxStyle.getStyle(options.baseHighlight) : undefined

  const n = highlights.length

  // Precompute specificity and a unique total order (specificity asc, index asc) so the
  // active group list can be kept sorted incrementally instead of re-sorting on every segment.
  const spec = new Array<number>(n)
  const order = new Array<number>(n)
  for (let i = 0; i < n; i++) {
    spec[i] = getSpecificity(highlights[i][2])
    order[i] = i
  }
  order.sort((a, b) => spec[a] - spec[b] || a - b)
  const rank = new Array<number>(n)
  for (let r = 0; r < n; r++) rank[order[r]] = r

  // Injection containment reduced to a returning sweep-line counter over [start, end) ranges.
  const byStart = new Array<{ s: number; e: number }>()
  const byEnd = new Array<{ s: number; e: number }>()
  for (let i = 0; i < n; i++) {
    const [start, end, , meta] = highlights[i]
    // Only well-formed ranges participate in the containment sweep. Legacy checked each
    // segment with `.some(r => off >= r.start && off < r.end)`, which ignores inverted
    // (start > end) ranges; counting them here would cancel valid containers.
    if (start >= end) continue
    if (meta?.containsInjection) {
      byStart.push({ s: start, e: end })
      byEnd.push({ s: start, e: end })
    }
  }
  byStart.sort((a, b) => a.s - b.s)
  byEnd.sort((a, b) => a.e - b.e)
  let sPtr = 0
  let ePtr = 0
  let insideCount = 0

  const boundaries: Boundary[] = []
  for (let i = 0; i < n; i++) {
    const [start, end] = highlights[i]
    if (start === end) continue
    boundaries.push({ offset: start, type: "start", highlightIndex: i })
    boundaries.push({ offset: end, type: "end", highlightIndex: i })
  }

  // Sort boundaries by offset, with ends before starts at same offset.
  // This ensures we close old ranges before opening new ones at the same position.
  boundaries.sort((a, b) => {
    if (a.offset !== b.offset) return a.offset - b.offset
    if (a.type === "end" && b.type === "start") return -1
    if (a.type === "start" && b.type === "end") return 1
    return 0
  })

  // Active highlight indices, kept unordered. The style merge is computed as a
  // per-property max-rank winner (equivalent to folding by rank with later-wins),
  // so we never keep a sorted active array: add/remove are O(1) via swap-with-last.
  const active: number[] = []
  const isActive = new Uint8Array(n)
  const pos = new Int32Array(n)
  let currentOffset = 0

  for (let i = 0; i < boundaries.length; i++) {
    const boundary = boundaries[i]

    if (currentOffset < boundary.offset && active.length > 0) {
      while (sPtr < byStart.length && byStart[sPtr].s <= currentOffset) {
        insideCount++
        sPtr++
      }
      while (ePtr < byEnd.length && byEnd[ePtr].e <= currentOffset) {
        insideCount--
        ePtr++
      }
      const insideInjectionContainer = insideCount > 0

      const segmentText = content.slice(currentOffset, boundary.offset)

      // Check if any active highlight has a conceal property. The original logic picks the
      // first conceal in start-event order (smallest start offset, ties by index), so track the minimum.
      // Priority: 1. Check meta.conceal first 2. Check group === "conceal" or starts with "conceal."
      let concealIndex = -1
      if (concealEnabled) {
        for (let k = 0; k < active.length; k++) {
          const idx = active[k]
          const [start, , group, meta] = highlights[idx]
          if (meta?.conceal !== undefined || group === "conceal" || group.startsWith("conceal.")) {
            if (concealIndex === -1) {
              concealIndex = idx
            } else {
              const prevStart = highlights[concealIndex][0]
              if (start < prevStart || (start === prevStart && idx < concealIndex)) concealIndex = idx
            }
          }
        }
      }

      if (concealIndex !== -1) {
        const [, , group, meta] = highlights[concealIndex]
        let replacementText = ""

        if (meta?.conceal !== undefined) {
          // If meta.conceal is set, use it (this would come from (#set! conceal "...") if supported)
          replacementText = meta.conceal ?? ""
        } else if (group === "conceal.with.space") {
          // Special group name means replace with space
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
        // Later-wins by (specificity, index) rank means the fold result equals, per
        // property, the value from the highest-rank active highlight that defines it.
        // Compute these winners in one pass over the unordered active set.
        const mergedStyle: StyleDefinition = baseStyle ? { ...baseStyle } : {}
        let bestFgRank = -1
        let bestBgRank = -1
        let bestBoldRank = -1
        let bestItalicRank = -1
        let bestUnderlineRank = -1
        let bestDimRank = -1
        let bestFg: StyleDefinition["fg"]
        let bestBg: StyleDefinition["bg"]
        let bestBold: boolean | undefined
        let bestItalic: boolean | undefined
        let bestUnderline: boolean | undefined
        let bestDim: boolean | undefined

        for (let k = 0; k < active.length; k++) {
          const idx = active[k]
          const [, , group, meta] = highlights[idx]

          // If we're inside an injection container, suppress all markup.raw.block highlights
          if (insideInjectionContainer && shouldSuppressInInjection(group, meta)) {
            continue
          }

          let styleForGroup = syntaxStyle.getStyle(group)

          if (!styleForGroup && group.includes(".")) {
            // Fallback to base scope
            const baseName = group.split(".")[0]
            styleForGroup = syntaxStyle.getStyle(baseName)
          }

          if (styleForGroup) {
            const r = rank[idx]
            if (styleForGroup.fg !== undefined && r > bestFgRank) {
              bestFgRank = r
              bestFg = styleForGroup.fg
            }
            if (styleForGroup.bg !== undefined && r > bestBgRank) {
              bestBgRank = r
              bestBg = styleForGroup.bg
            }
            if (styleForGroup.bold !== undefined && r > bestBoldRank) {
              bestBoldRank = r
              bestBold = styleForGroup.bold
            }
            if (styleForGroup.italic !== undefined && r > bestItalicRank) {
              bestItalicRank = r
              bestItalic = styleForGroup.italic
            }
            if (styleForGroup.underline !== undefined && r > bestUnderlineRank) {
              bestUnderlineRank = r
              bestUnderline = styleForGroup.underline
            }
            if (styleForGroup.dim !== undefined && r > bestDimRank) {
              bestDimRank = r
              bestDim = styleForGroup.dim
            }
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

        if (bestFgRank >= 0) mergedStyle.fg = bestFg
        if (bestBgRank >= 0) mergedStyle.bg = bestBg
        if (bestBoldRank >= 0) mergedStyle.bold = bestBold
        if (bestItalicRank >= 0) mergedStyle.italic = bestItalic
        if (bestUnderlineRank >= 0) mergedStyle.underline = bestUnderline
        if (bestDimRank >= 0) mergedStyle.dim = bestDim

        // Use merged style, falling back to default if nothing was merged
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
      const idx = boundary.highlightIndex
      active.push(idx)
      pos[idx] = active.length - 1
      isActive[idx] = 1
    } else {
      const idx = boundary.highlightIndex
      if (isActive[idx]) {
        const p = pos[idx]
        const last = active.pop()!
        if (last !== idx) {
          active[p] = last
          pos[last] = p
        }
        isActive[idx] = 0
        pos[idx] = -1
      }

      if (concealEnabled) {
        const [, , group, meta] = highlights[idx]
        if (meta?.concealLines !== undefined) {
          if (boundary.offset < content.length && content[boundary.offset] === "\n") {
            currentOffset = boundary.offset + 1
            continue
          }
        }

        // TODO: This is also a query specific workaround, needs improvement
        if (meta?.conceal !== undefined) {
          // Skip the next space if we replaced with a space (prevents double spaces like "text] (url)")
          if (meta.conceal === " ") {
            if (boundary.offset < content.length && content[boundary.offset] === " ") {
              currentOffset = boundary.offset + 1
              continue
            }
          }
          // For heading markers specifically, also skip the trailing space
          // The group is just "conceal" for heading markers from the markdown query
          // We need to check if this conceal is NOT from an injection (markdown_inline)
          else if (meta.conceal === "" && group === "conceal" && !meta.isInjection) {
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
export interface TreeSitterToStyledTextOptions {
  conceal?: Pick<TextChunkOptions, "enabled">
  baseHighlight?: string
}

export async function treeSitterToStyledText(
  content: string,
  filetype: string,
  syntaxStyle: SyntaxStyle,
  client: TreeSitterClient,
  options?: TreeSitterToStyledTextOptions,
): Promise<StyledText> {
  const result = await client.highlightOnce(content, filetype)
  if ((result.highlights && result.highlights.length > 0) || options?.baseHighlight) {
    const chunks = treeSitterToTextChunks(content, result.highlights ?? [], syntaxStyle, {
      enabled: options?.conceal?.enabled ?? true,
      baseHighlight: options?.baseHighlight,
    })
    return new StyledText(chunks)
  } else {
    const defaultStyle = syntaxStyle.mergeStyles("default")
    const chunks: TextChunk[] = [
      {
        __isChunk: true,
        text: content,
        fg: defaultStyle.fg,
        bg: defaultStyle.bg,
        attributes: defaultStyle.attributes,
      },
    ]
    return new StyledText(chunks)
  }
}
