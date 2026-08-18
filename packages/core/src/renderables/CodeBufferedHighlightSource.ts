import type { CodeHighlightResult, CodeHighlightSource } from "./CodeHighlightSession.js"
import type {
  CreateBufferHighlightResult as ClientCreateBufferHighlightResult,
  Edit,
  SimpleHighlight,
  UpdateOutcome,
} from "../lib/tree-sitter/types.js"

export type CreateBufferHighlightResult = ClientCreateBufferHighlightResult

export interface BufferedHighlightClient {
  allocateBufferId(): number
  createBufferWithHighlights(
    id: number,
    content: string,
    filetype: string,
    version?: number,
    autoInitialize?: boolean,
  ): Promise<CreateBufferHighlightResult>
  updateBuffer(id: number, edits: Edit[], newContent: string, version: number): Promise<UpdateOutcome>
  removeBuffer(id: number): Promise<void>
}

interface ActiveBuffer {
  id: number
  version: number
  content: string
  bufferContent: string
  filetype: string
  highlights: SimpleHighlight[]
}

function endPoint(content: string): { row: number; column: number } {
  let row = 0
  let lineStart = 0

  for (let index = content.indexOf("\n"); index !== -1; index = content.indexOf("\n", index + 1)) {
    row++
    lineStart = index + 1
  }

  // web-tree-sitter positions and indexes are UTF-8 byte offsets, not JS code
  // units, code points, graphemes, or display-cell widths.
  return { row, column: Buffer.byteLength(content.slice(lineStart), "utf8") }
}

function appendEdit(content: string, nextContent: string): Edit {
  const startIndex = Buffer.byteLength(content, "utf8")
  const startPosition = endPoint(content)

  return {
    startIndex,
    oldEndIndex: startIndex,
    newEndIndex: Buffer.byteLength(nextContent, "utf8"),
    startPosition,
    oldEndPosition: startPosition,
    newEndPosition: endPoint(nextContent),
  }
}

function normalizeBufferContent(content: string, filetype: string): string {
  // Keep the buffered path output-identical to highlightOnce. The markdown
  // grammar only recognizes a closing fence at EOF when a newline follows it.
  return filetype === "markdown" && content.endsWith("```") ? `${content}\n` : content
}

/**
 * Per-CodeRenderable owner for TreeSitterClient's versioned buffer/ACK path.
 *
 * The adapter deliberately uses incremental edits only for a proven append.
 * Arbitrary replacements and filetype changes dispose and recreate with a new
 * id so a late DISPOSE_BUFFER can never tear down the replacement parser.
 */
export class CodeBufferedHighlightSource implements CodeHighlightSource {
  private active?: ActiveBuffer
  private epoch = 0
  private closed = false

  constructor(private readonly client: BufferedHighlightClient) {}

  async highlight(content: string, filetype: string): Promise<CodeHighlightResult> {
    if (this.closed) return { error: "Buffered highlight source is closed" }

    const active = this.active
    if (!active) return this.create(content, filetype)

    if (active.filetype !== filetype || !content.startsWith(active.content)) {
      this.releaseActive()
      return this.create(content, filetype)
    }

    if (active.content === content) {
      return { highlights: active.highlights }
    }

    const epoch = this.epoch
    const version = active.version + 1
    const bufferContent = normalizeBufferContent(content, filetype)
    if (!bufferContent.startsWith(active.bufferContent)) {
      this.releaseActive()
      return this.create(content, filetype)
    }
    const outcome = await this.client.updateBuffer(
      active.id,
      [appendEdit(active.bufferContent, bufferContent)],
      bufferContent,
      version,
    )

    if (this.closed || epoch !== this.epoch || this.active !== active) {
      return { error: "Buffered highlight source was superseded" }
    }

    if (outcome.status === "skipped") {
      this.releaseActive()
      return this.create(content, filetype)
    }

    if (outcome.status !== "completed") {
      if (outcome.status === "error") throw new Error(outcome.error)
      return {
        error: `Buffered highlight version ${outcome.version} was superseded by ${outcome.supersededBy}`,
      }
    }

    if (!outcome.highlights) {
      return { error: `Buffered highlight version ${version} completed without full highlights` }
    }

    active.version = version
    active.content = content
    active.bufferContent = bufferContent
    active.highlights = outcome.highlights
    return { highlights: outcome.highlights }
  }

  /** Invalidate the current buffer but keep this source reusable. */
  release(): void {
    this.epoch++
    const active = this.active
    this.active = undefined
    if (active) this.dispose(active.id)
  }

  /** Permanently close this owner and dispose its buffer exactly once. */
  close(): void {
    if (this.closed) return
    this.closed = true
    this.release()
  }

  private async create(content: string, filetype: string): Promise<CodeHighlightResult> {
    if (this.closed) return { error: "Buffered highlight source is closed" }

    const epoch = this.epoch
    const id = this.client.allocateBufferId()
    const version = 1
    const bufferContent = normalizeBufferContent(content, filetype)
    let result: CreateBufferHighlightResult

    try {
      result = await this.client.createBufferWithHighlights(id, bufferContent, filetype, version)
    } catch (error) {
      this.dispose(id)
      // Preserve highlightOnce's rejection semantics. CodeRenderable uses a
      // rejected request to enter its plain-text fallback path; converting the
      // rejection into a normal empty-highlight result would incorrectly run
      // onChunks/baseHighlight and could change fallback colors or content.
      throw error
    }

    if (this.closed || epoch !== this.epoch) {
      this.dispose(id)
      return { error: "Buffered highlight source was superseded" }
    }

    if (!result.hasParser) {
      await this.disposeAndWait(id)
      return { warning: result.warning, error: result.error, highlights: [] }
    }

    const highlights = result.highlights ?? []
    this.active = { id, version, content, bufferContent, filetype, highlights }
    return { highlights, warning: result.warning, error: result.error }
  }

  private releaseActive(): void {
    this.epoch++
    const active = this.active
    this.active = undefined
    if (active) this.dispose(active.id)
  }

  private dispose(id: number): void {
    void this.disposeAndWait(id)
  }

  private async disposeAndWait(id: number): Promise<void> {
    try {
      await this.client.removeBuffer(id)
    } catch {
      // The client owns worker-failure reporting. Disposal remains best effort
      // after that failure, and the unique id is never reused.
    }
  }
}
