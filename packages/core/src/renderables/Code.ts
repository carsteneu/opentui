import { type LineInfo, type RenderContext } from "../types.js"
import { StyledText } from "../lib/styled-text.js"
import { SyntaxStyle } from "../syntax-style.js"
import { getTreeSitterClient, TreeSitterClient } from "../lib/tree-sitter/index.js"
import { TextBufferRenderable, type TextBufferOptions } from "./TextBufferRenderable.js"
import type { OptimizedBuffer } from "../buffer.js"
import type { SimpleHighlight } from "../lib/tree-sitter/types.js"
import type { TextChunk } from "../text-buffer.js"
import { treeSitterToTextChunks } from "../lib/tree-sitter-styled-text.js"
import type { RGBA } from "../lib/RGBA.js"

export interface HighlightContext {
  content: string
  filetype: string
  syntaxStyle: SyntaxStyle
}

export type OnHighlightCallback = (
  highlights: SimpleHighlight[],
  context: HighlightContext,
) => SimpleHighlight[] | undefined | Promise<SimpleHighlight[] | undefined>

export interface ChunkRenderContext extends HighlightContext {
  highlights: SimpleHighlight[]
}

export type OnChunksCallback = (
  chunks: TextChunk[],
  context: ChunkRenderContext,
) => TextChunk[] | undefined | Promise<TextChunk[] | undefined>

export interface CodeOptions extends TextBufferOptions {
  content?: string
  filetype?: string
  syntaxStyle: SyntaxStyle
  treeSitterClient?: TreeSitterClient
  conceal?: boolean
  drawUnstyledText?: boolean
  streaming?: boolean
  /**
   * Paint the complete layout rectangle with `bg` and allow retained partial
   * redraws while streaming. The background must be fully opaque.
   */
  retainedRendering?: boolean
  initialStyledText?: StyledText
  deferStreamingHighlight?: boolean
  baseHighlight?: string
  onHighlight?: OnHighlightCallback
  onChunks?: OnChunksCallback
}

type ConcealLineRange = [start: number, end: number]

export class CodeRenderable extends TextBufferRenderable {
  private _content: string
  private _filetype?: string
  // Collapse synchronous streaming updates into one renderer request.
  private _renderCoalesceScheduled: boolean = false
  private _syntaxStyle: SyntaxStyle
  private _isHighlighting: boolean = false
  private _treeSitterClient: TreeSitterClient
  private _highlightsDirty: boolean = false
  private _highlightSnapshotId: number = 0
  private _highlightLoopActive: boolean = false
  private _highlightPromise?: Promise<void>
  private _highlightRerun: boolean = false
  private _conceal: boolean
  private _drawUnstyledText: boolean
  private _shouldRenderTextBuffer: boolean = true
  private _streaming: boolean
  private _retainedRendering: boolean
  private _initialStyledText?: StyledText
  private _initialStyledTextContent?: string
  private _deferStreamingHighlight: boolean
  private _hadInitialContent: boolean = false
  private _lastHighlights: SimpleHighlight[] = []
  private _baseHighlight?: string
  private _onHighlight?: OnHighlightCallback
  private _onChunks?: OnChunksCallback
  private _highlightingPromise: Promise<void> = Promise.resolve()
  // Temporary rendered-line -> source-line map for concealment; native extmarks should replace this.
  private _renderedLineSources?: number[]
  private _mappedLineInfo?: LineInfo

  protected _contentDefaultOptions = {
    content: "",
    conceal: true,
    drawUnstyledText: true,
    streaming: false,
  } satisfies Partial<CodeOptions>

  constructor(ctx: RenderContext, options: CodeOptions) {
    super(ctx, options)

    this._content = options.content ?? this._contentDefaultOptions.content
    this._filetype = options.filetype
    this._syntaxStyle = options.syntaxStyle
    this._treeSitterClient = options.treeSitterClient ?? getTreeSitterClient()
    this._conceal = options.conceal ?? this._contentDefaultOptions.conceal
    this._drawUnstyledText = options.drawUnstyledText ?? this._contentDefaultOptions.drawUnstyledText
    this._streaming = options.streaming ?? this._contentDefaultOptions.streaming
    this._retainedRendering = options.retainedRendering ?? false
    this._initialStyledText = options.initialStyledText
    this._initialStyledTextContent = this._initialStyledText ? this._content : undefined
    this._deferStreamingHighlight = options.deferStreamingHighlight ?? false
    this._baseHighlight = options.baseHighlight
    this._onHighlight = options.onHighlight
    this._onChunks = options.onChunks

    this.updatePartialEligibility()

    if (this._content.length > 0) {
      if (this._initialStyledText && this._initialStyledTextContent === this._content && this._drawUnstyledText) {
        this.setInitialStyledTextContent(this._initialStyledText, this._content)
      } else {
        this.textBuffer.setText(this._content)
      }
      this.updateTextInfo()
      this._shouldRenderTextBuffer = this._drawUnstyledText || !this._filetype
    }

    this._highlightsDirty = this._content.length > 0
  }

  get content(): string {
    return this._content
  }

  private invalidateHighlights(): void {
    this._highlightsDirty = true
    this._highlightSnapshotId++
  }

  set content(value: string) {
    if (this._content !== value) {
      const scrollWidth = this.scrollWidth
      const scrollHeight = this.scrollHeight
      this._content = value
      this.invalidateHighlights()

      if (this._streaming && this._filetype && !this._drawUnstyledText) {
        this.coalesceRender()
        return
      }

      if (this._initialStyledText && this._initialStyledTextContent === value && this._drawUnstyledText) {
        this.setInitialStyledTextContent(this._initialStyledText, value)
      } else {
        this.textBuffer.setText(value)
      }
      this.setRenderedLineSources(undefined)
      this.updateTextInfoAfterBufferChange(scrollWidth, scrollHeight)
    }
  }

  private isDefaultStyledContent(styledText: StyledText, content: string): boolean {
    let offset = 0
    for (const chunk of styledText.chunks) {
      if (chunk.fg && !chunk.fg.equals(this._defaultFg)) return false
      if (chunk.bg && !chunk.bg.equals(this._defaultBg)) return false
      if ((chunk.attributes ?? 0) !== this._defaultAttributes || chunk.link) return false
      if (!content.startsWith(chunk.text, offset)) return false
      offset += chunk.text.length
    }
    return offset === content.length
  }

  private setInitialStyledTextContent(styledText: StyledText, content: string): void {
    // Native append boundaries do not reflow word wrapping or re-segment all
    // grapheme clusters, so streaming updates must remain full replacements.
    if (this.isDefaultStyledContent(styledText, content)) {
      this.textBuffer.setText(content)
      return
    }
    this.textBuffer.setStyledText(styledText)
  }

  private applyDeferredInitialStyledText(): void {
    if (
      !this._deferStreamingHighlight ||
      !this._streaming ||
      !this._drawUnstyledText ||
      !this._initialStyledText ||
      this._initialStyledTextContent !== this._content
    )
      return

    const scrollWidth = this.scrollWidth
    const scrollHeight = this.scrollHeight
    this.setInitialStyledTextContent(this._initialStyledText, this._content)
    this.setRenderedLineSources(undefined)
    this._shouldRenderTextBuffer = true
    this.updateTextInfoAfterBufferChange(scrollWidth, scrollHeight)
  }

  private updateTextInfoAfterBufferChange(scrollWidth: number, scrollHeight: number): void {
    this.updateTextInfo(
      (this._width === "auto" && scrollWidth !== this.scrollWidth) ||
        (this._height === "auto" && scrollHeight !== this.scrollHeight),
    )
  }

  private updateTextInfoAfterHighlight(scrollWidth: number, scrollHeight: number): void {
    if (!this._streaming) {
      this.updateTextInfo()
      return
    }
    this.updateTextInfoAfterBufferChange(scrollWidth, scrollHeight)
  }

  private coalesceRender(): void {
    if (this._renderCoalesceScheduled) return
    this._renderCoalesceScheduled = true
    queueMicrotask(() => {
      this._renderCoalesceScheduled = false
      if (!this.isDestroyed) this.requestRender()
    })
  }

  private retryLatestHighlight(): void {
    if (this._streaming) this._isHighlighting = false
    this.coalesceRender()
  }

  public override get lineInfo(): LineInfo {
    if (!this._renderedLineSources) return super.lineInfo
    if (this._mappedLineInfo) return this._mappedLineInfo

    const lineInfo = super.lineInfo
    const renderedLineSources = this._renderedLineSources

    // Native reports visual rows for the rendered buffer; remap those rows back to source lines.
    this._mappedLineInfo = {
      ...lineInfo,
      lineSources: lineInfo.lineSources.map((line) => renderedLineSources[line] ?? line),
    }
    return this._mappedLineInfo
  }

  public override get wrapMode(): "none" | "char" | "word" {
    return super.wrapMode
  }

  public override set wrapMode(value: "none" | "char" | "word") {
    if (super.wrapMode !== value) {
      this._mappedLineInfo = undefined
      super.wrapMode = value
    }
  }

  protected override onResize(width: number, height: number): void {
    this._mappedLineInfo = undefined
    super.onResize(width, height)
  }

  protected override updateTextInfo(layoutChanged: boolean = true): void {
    this._mappedLineInfo = undefined
    super.updateTextInfo(layoutChanged)
  }

  get filetype(): string | undefined {
    return this._filetype
  }

  set filetype(value: string | undefined) {
    if (this._filetype !== value) {
      this._filetype = value
      this.invalidateHighlights()
    }
  }

  get syntaxStyle(): SyntaxStyle {
    return this._syntaxStyle
  }

  set syntaxStyle(value: SyntaxStyle) {
    if (this._syntaxStyle !== value) {
      this._syntaxStyle = value
      this.invalidateHighlights()
    }
  }

  get conceal(): boolean {
    return this._conceal
  }

  set conceal(value: boolean) {
    if (this._conceal !== value) {
      this._conceal = value
      this.invalidateHighlights()
    }
  }

  get drawUnstyledText(): boolean {
    return this._drawUnstyledText
  }

  set drawUnstyledText(value: boolean) {
    if (this._drawUnstyledText !== value) {
      this._drawUnstyledText = value
      this.invalidateHighlights()
      this.applyDeferredInitialStyledText()
    }
  }

  get streaming(): boolean {
    return this._streaming
  }

  get retainedRendering(): boolean {
    return this._retainedRendering
  }

  set retainedRendering(value: boolean) {
    if (this._retainedRendering === value) return
    this._retainedRendering = value
    this.updatePartialEligibility()
    this.requestRender()
  }

  set initialStyledText(value: StyledText | undefined) {
    if (this._initialStyledText === value) return
    this.setInitialStyledText(value, value?.chunks.map((chunk) => chunk.text).join(""))
  }

  setInitialStyledText(value: StyledText | undefined, content?: string): void {
    const snapshotContent = value ? content : undefined
    if (this._initialStyledText === value && this._initialStyledTextContent === snapshotContent) return
    this._initialStyledText = value
    this._initialStyledTextContent = snapshotContent
    this.invalidateHighlights()
    this.applyDeferredInitialStyledText()
  }

  get deferStreamingHighlight(): boolean {
    return this._deferStreamingHighlight
  }

  set deferStreamingHighlight(value: boolean) {
    if (this._deferStreamingHighlight !== value) {
      this._deferStreamingHighlight = value
      this.invalidateHighlights()
      this.applyDeferredInitialStyledText()
    }
  }

  set streaming(value: boolean) {
    if (this._streaming !== value) {
      this._streaming = value
      this.updatePartialEligibility()
      this._hadInitialContent = false
      this._lastHighlights = []
      this.invalidateHighlights()
      this.applyDeferredInitialStyledText()
    }
  }

  get treeSitterClient(): TreeSitterClient {
    return this._treeSitterClient
  }

  set treeSitterClient(value: TreeSitterClient) {
    if (this._treeSitterClient !== value) {
      this._treeSitterClient = value
      this.invalidateHighlights()
    }
  }

  get onHighlight(): OnHighlightCallback | undefined {
    return this._onHighlight
  }

  get baseHighlight(): string | undefined {
    return this._baseHighlight
  }

  set baseHighlight(value: string | undefined) {
    if (this._baseHighlight !== value) {
      this._baseHighlight = value
      this.invalidateHighlights()
    }
  }

  set onHighlight(value: OnHighlightCallback | undefined) {
    if (this._onHighlight !== value) {
      this._onHighlight = value
      this.invalidateHighlights()
    }
  }

  get onChunks(): OnChunksCallback | undefined {
    return this._onChunks
  }

  set onChunks(value: OnChunksCallback | undefined) {
    if (this._onChunks !== value) {
      this._onChunks = value
      this.invalidateHighlights()
    }
  }

  get isHighlighting(): boolean {
    return this._isHighlighting || this._highlightRerun
  }

  get highlightingDone(): Promise<void> {
    return this._highlightingPromise
  }

  protected async transformChunks(chunks: TextChunk[], context: ChunkRenderContext): Promise<TextChunk[]> {
    if (!this._onChunks) return chunks

    const modified = await this._onChunks(chunks, context)
    return modified ?? chunks
  }

  private ensureVisibleTextBeforeHighlight(): void {
    if (this.isDestroyed) return

    const content = this._content

    if (!this._filetype) {
      this._shouldRenderTextBuffer = true
      return
    }

    const isInitialContent = this._streaming && !this._hadInitialContent
    const shouldDrawUnstyledNow = this._streaming ? isInitialContent && this._drawUnstyledText : this._drawUnstyledText

    if (this._streaming && !isInitialContent) {
      this._shouldRenderTextBuffer = true
    } else if (shouldDrawUnstyledNow) {
      if (this._initialStyledText && this._initialStyledTextContent === content) {
        this.setInitialStyledTextContent(this._initialStyledText, content)
      } else {
        this.textBuffer.setText(content)
      }
      this.setRenderedLineSources(undefined)
      this._shouldRenderTextBuffer = true
    } else {
      this._shouldRenderTextBuffer = false
    }
  }

  private async startHighlight(): Promise<void> {
    const content = this._content
    const filetype = this._filetype
    const snapshotId = ++this._highlightSnapshotId

    if (!filetype) return

    const isInitialContent = this._streaming && !this._hadInitialContent
    if (isInitialContent) {
      this._hadInitialContent = true
    }

    this._isHighlighting = true

    try {
      const result = await this._treeSitterClient.highlightOnce(content, filetype)

      if (snapshotId !== this._highlightSnapshotId) {
        this.retryLatestHighlight()
        return
      }

      if (this.isDestroyed) return

      let highlights = result.highlights ?? []

      if (this._onHighlight && highlights.length >= 0) {
        const context: HighlightContext = {
          content,
          filetype,
          syntaxStyle: this._syntaxStyle,
        }
        const modified = await this._onHighlight(highlights, context)
        if (modified !== undefined) {
          highlights = modified
        }
      }

      if (snapshotId !== this._highlightSnapshotId) {
        this.retryLatestHighlight()
        return
      }

      if (this.isDestroyed) return

      if (highlights.length > 0) {
        if (this._streaming) {
          this._lastHighlights = highlights
        }
      }

      const scrollWidth = this.scrollWidth
      const scrollHeight = this.scrollHeight

      if (highlights.length > 0 || this._onChunks || this._baseHighlight) {
        const context: ChunkRenderContext = {
          content,
          filetype,
          syntaxStyle: this._syntaxStyle,
          highlights,
        }

        let chunks = treeSitterToTextChunks(content, highlights, this._syntaxStyle, {
          enabled: this._conceal,
          baseHighlight: this._baseHighlight,
        })
        // onChunks may rewrite text arbitrarily, so the conceal-only source map would be invalid.
        const renderedLineSources = this._onChunks ? undefined : this.getConcealLinesSourceMap(content, highlights)

        chunks = await this.transformChunks(chunks, context)

        if (snapshotId !== this._highlightSnapshotId) {
          this.retryLatestHighlight()
          return
        }

        if (this.isDestroyed) return

        const styledText = new StyledText(chunks)
        this.textBuffer.setStyledText(styledText)
        this.setRenderedLineSources(renderedLineSources)
      } else {
        this.textBuffer.setText(content)
        this.setRenderedLineSources(undefined)
      }

      this._shouldRenderTextBuffer = true
      this._isHighlighting = false
      this._highlightsDirty = false
      this.updateTextInfoAfterHighlight(scrollWidth, scrollHeight)
      this.coalesceRender()
    } catch (error) {
      if (snapshotId !== this._highlightSnapshotId) {
        this.retryLatestHighlight()
        return
      }

      console.warn("Code highlighting failed, falling back to plain text:", error)
      if (this.isDestroyed) return
      const scrollWidth = this.scrollWidth
      const scrollHeight = this.scrollHeight
      this.textBuffer.setText(content)
      this.setRenderedLineSources(undefined)
      this._shouldRenderTextBuffer = true
      this._isHighlighting = false
      this._highlightsDirty = false
      this.updateTextInfoAfterHighlight(scrollWidth, scrollHeight)
      this.coalesceRender()
    }
  }

  private async runHighlights(): Promise<void> {
    try {
      do {
        this._highlightRerun = false
        await this.startHighlight()
      } while (this._highlightRerun && !this.isDestroyed && this._content.length > 0 && this._filetype)
    } finally {
      this._highlightLoopActive = false
      this._highlightRerun = false
    }
  }

  private clearPendingHighlight(): void {
    this._highlightSnapshotId++
    this._isHighlighting = false
    this._highlightRerun = false
    this._highlightingPromise = Promise.resolve()
  }

  private setRenderedLineSources(lineSources: number[] | undefined): void {
    this._renderedLineSources = lineSources
    this._mappedLineInfo = undefined
  }

  private static isIdentityLineSources(lineSources: number[]): boolean {
    for (let i = 0; i < lineSources.length; i++) {
      if (lineSources[i] !== i) return false
    }
    return true
  }

  private static getMergedConcealLineRanges(highlights: SimpleHighlight[]): ConcealLineRange[] {
    const ranges: ConcealLineRange[] = []

    for (const highlight of highlights) {
      const meta = highlight[3]
      if (meta?.concealLines === undefined) continue

      const group = highlight[2]
      const isEmptyConceal =
        meta.conceal === "" || (meta.conceal === undefined && (group === "conceal" || group.startsWith("conceal.")))
      if (isEmptyConceal) {
        ranges.push([highlight[0], highlight[1]])
      }
    }

    if (ranges.length <= 1) return ranges

    // Overlapping conceal ranges must collapse before line-by-line source mapping.
    ranges.sort((a, b) => a[0] - b[0])
    let writeIndex = 0

    for (let i = 1; i < ranges.length; i++) {
      const current = ranges[writeIndex]
      const next = ranges[i]

      if (next[0] <= current[1]) {
        current[1] = Math.max(current[1], next[1])
      } else {
        writeIndex++
        ranges[writeIndex] = next
      }
    }

    ranges.length = writeIndex + 1
    return ranges
  }

  private getConcealLinesSourceMap(content: string, highlights: SimpleHighlight[]): number[] | undefined {
    if (!this._conceal || content.length === 0) return undefined

    // setStyledText gives native only rendered text; rebuild enough source identity for concealed lines.
    // Native view-resolved extmarks should make this a layout query instead of a parallel map.
    const concealLineRanges = CodeRenderable.getMergedConcealLineRanges(highlights)
    if (concealLineRanges.length === 0) return undefined

    const lineSources: number[] = []
    let sourceLine = 0
    let lineStart = 0
    let rangeIndex = 0
    let currentRenderedLineHasText = false

    const setCurrentRenderedLineSource = (line: number, hasText: boolean): void => {
      // Until visible text is emitted, a rendered line can still map to a later collapsed source line.
      if (lineSources.length === 0) {
        lineSources.push(line)
      } else if (!currentRenderedLineHasText) {
        lineSources[lineSources.length - 1] = line
      }

      if (hasText) currentRenderedLineHasText = true
    }

    while (lineStart <= content.length) {
      const newlineOffset = content.indexOf("\n", lineStart)
      const lineEnd = newlineOffset === -1 ? content.length : newlineOffset

      while (rangeIndex < concealLineRanges.length && concealLineRanges[rangeIndex][1] <= lineStart) {
        rangeIndex++
      }

      const range = concealLineRanges[rangeIndex]
      const fullyConcealed = !!range && lineEnd > lineStart && range[0] <= lineStart && range[1] >= lineEnd
      const lineBreakConcealed =
        newlineOffset !== -1 && !!range && range[0] <= newlineOffset && range[1] >= newlineOffset

      if (!fullyConcealed || !lineBreakConcealed) {
        const hasText = lineEnd > lineStart && !fullyConcealed
        if (hasText || newlineOffset !== -1 || !fullyConcealed) {
          setCurrentRenderedLineSource(sourceLine, hasText)
        }

        if (newlineOffset !== -1 && !lineBreakConcealed) {
          lineSources.push(sourceLine + 1)
          currentRenderedLineHasText = false
        }
      }

      sourceLine++
      if (newlineOffset === -1) break
      lineStart = newlineOffset + 1
    }

    if (lineSources.length === 0 || CodeRenderable.isIdentityLineSources(lineSources)) return undefined
    return lineSources
  }

  public getLineHighlights(lineIdx: number) {
    return this.textBuffer.getLineHighlights(lineIdx)
  }

  protected override onBgChanged(newColor: RGBA): void {
    this.setPartialEligible(this._streaming && this._retainedRendering && newColor.a === 1)
  }

  private updatePartialEligibility(): void {
    this.setPartialEligible(this._streaming && this._retainedRendering && this._defaultBg.a === 1)
  }

  protected renderSelf(buffer: OptimizedBuffer): void {
    if (this._retainedRendering && this._defaultBg.a === 1) {
      const x = Math.max(0, this._screenX)
      const y = Math.max(0, this._screenY)
      const right = Math.min(buffer.width, this._screenX + this.width)
      const bottom = Math.min(buffer.height, this._screenY + this.height)
      if (right > x && bottom > y) buffer.fillRect(x, y, right - x, bottom - y, this._defaultBg)
    }

    if (this._highlightsDirty) {
      if (this.isDestroyed) return

      const hasContent = this._content.length > 0
      if (!hasContent || !this._filetype) {
        this._shouldRenderTextBuffer = hasContent
        this._highlightsDirty = false
        this.clearPendingHighlight()

        if (hasContent) {
          this.textBuffer.setText(this._content)
          this.setRenderedLineSources(undefined)
          this.updateTextInfo()
        }
      } else if (
        this._deferStreamingHighlight &&
        this._streaming &&
        this._initialStyledText &&
        this._drawUnstyledText &&
        this._initialStyledTextContent === this._content
      ) {
        // MarkdownRenderable already parsed and styled the unstable streaming
        // token. Re-highlighting it would replace the same buffer asynchronously.
        this._shouldRenderTextBuffer = true
        this._highlightsDirty = false
      } else {
        this.ensureVisibleTextBeforeHighlight()
        this._highlightsDirty = false
        if (this._highlightLoopActive) {
          this._isHighlighting = true
          this._highlightRerun = true
          this._highlightingPromise = this._highlightPromise!
        } else {
          const { promise: highlightingPromise, resolve, reject } = Promise.withResolvers<void>()
          this._highlightLoopActive = true
          this._highlightPromise = highlightingPromise
          this._highlightingPromise = highlightingPromise
          const clearHighlight = () => {
            if (this._highlightPromise === highlightingPromise) {
              this._highlightPromise = undefined
            }
          }
          void this.runHighlights().then(
            () => {
              clearHighlight()
              resolve()
            },
            (error) => {
              clearHighlight()
              reject(error)
            },
          )
        }
      }
    }

    if (!this._shouldRenderTextBuffer) return
    super.renderSelf(buffer)
  }

  public override destroy(): void {
    if (this.isDestroyed) return
    this.clearPendingHighlight()
    super.destroy()
  }
}
