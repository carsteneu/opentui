import type { SimpleHighlight } from "../lib/tree-sitter/types.js"

/**
 * The five ownership intents a code renderable can drive its highlight session
 * with. Each maps to a unique transition of the current generation.
 */
export type HighlightOwner = "initial" | "append" | "fullReplace" | "filetypeChange" | "destroy"

export interface CodeHighlightResult {
  highlights?: SimpleHighlight[]
  warning?: string
  error?: string
}

/**
 * Source seam for the code-highlight consumer contract. Today
 * TreeSitterClient.highlightOnce satisfies it; Loop C's versioned buffer client
 * will plug in here without changing the consumer.
 */
export interface CodeHighlightSource {
  highlight(content: string, filetype: string): Promise<CodeHighlightResult>
}

export interface CodeHighlightContext {
  content: string
  filetype: string
}

export interface CodeHighlightPipeline<P> {
  convert(context: CodeHighlightContext, result: CodeHighlightResult): P | Promise<P>
  commit(payload: P, context: CodeHighlightContext): void
}

/**
 * Consumer-side generation/ownership contract for code highlighting (C1/C4).
 *
 * A code renderable owns exactly one current session. Each `revise` bumps a
 * monotonic generation and records its owner (initial/append/fullReplace/
 * filetypeChange/destroy), invalidating any result still in flight. A source
 * result may only reach conversion and UI commit if its generation is still
 * current and the session is open; staleness is re-checked immediately before
 * convert and again immediately before commit, so a stale result can neither
 * convert nor invalidate nor commit. `close` settles every open promise and
 * forbids further conversion/commit.
 */
export class CodeHighlightSession {
  private _generation = 0
  private _owner: HighlightOwner | undefined
  private _closed = false
  readonly source: CodeHighlightSource

  constructor(source: CodeHighlightSource) {
    this.source = source
  }

  get generation(): number {
    return this._generation
  }

  get owner(): HighlightOwner | undefined {
    return this._owner
  }

  get closed(): boolean {
    return this._closed
  }

  isCurrent(generation: number): boolean {
    return !this._closed && generation === this._generation
  }

  /** Bump the generation and record a new owner, invalidating any in-flight result. */
  revise(owner: HighlightOwner): number {
    this._owner = owner
    return ++this._generation
  }

  /**
   * Full convert-then-commit driver. Forward seam for Loop C: the versioned
   * buffered client will drive the whole run through this method. The current
   * CodeRenderable fences the same invariants inline via revise/isCurrent/
   * source.highlight because its streaming onChunks output does not map to a
   * single convert-payload commit; keep the two in lockstep when adopting.
   * Returns true when committed, false when stale or closed.
   */
  async run<P>(
    owner: HighlightOwner,
    context: CodeHighlightContext,
    pipeline: CodeHighlightPipeline<P>,
  ): Promise<boolean> {
    if (this._closed) return false
    const generation = this.revise(owner)

    const result = await this.source.highlight(context.content, context.filetype)
    if (!this.isCurrent(generation)) return false

    const payload = await pipeline.convert(context, result)
    if (!this.isCurrent(generation)) return false

    pipeline.commit(payload, context)
    return true
  }

  /** Close the session: no further run may convert or commit. */
  close(): void {
    if (this._closed) return
    this._closed = true
    this.revise("destroy")
  }
}
