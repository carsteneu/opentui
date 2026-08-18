import { TreeSitterClient } from "../lib/tree-sitter/index.js"
import { SystemClock, type Clock, type TimerHandle } from "../lib/clock.js"
import type { CreateBufferHighlightResult, Edit, SimpleHighlight, UpdateOutcome } from "../lib/tree-sitter/types.js"

export class MockTreeSitterClient extends TreeSitterClient {
  private _highlightPromises: Array<{
    promise: Promise<{ highlights?: SimpleHighlight[]; warning?: string; error?: string }>
    resolve: (result: { highlights?: SimpleHighlight[]; warning?: string; error?: string }) => void
    timeout?: TimerHandle
  }> = []
  private _mockResult: { highlights?: SimpleHighlight[]; warning?: string; error?: string } = { highlights: [] }
  private _autoResolveTimeout?: number
  private readonly _clock: Clock
  private readonly _bufferFiletypes = new Map<number, string>()

  constructor(options?: { autoResolveTimeout?: number; clock?: Clock }) {
    super({ dataPath: "/tmp/mock" }, { autoStartWorker: false })
    this._autoResolveTimeout = options?.autoResolveTimeout
    this._clock = options?.clock ?? new SystemClock()
  }

  override async destroy(): Promise<void> {
    this.resolveAllHighlightOnce()
    await super.destroy()
  }

  async highlightOnce(
    content: string,
    filetype: string,
  ): Promise<{ highlights?: SimpleHighlight[]; warning?: string; error?: string }> {
    const { promise, resolve } = Promise.withResolvers<{
      highlights?: SimpleHighlight[]
      warning?: string
      error?: string
    }>()

    let timeout: TimerHandle | undefined

    if (this._autoResolveTimeout !== undefined) {
      timeout = this._clock.setTimeout(() => {
        const index = this._highlightPromises.findIndex((p) => p.promise === promise)
        if (index !== -1) {
          resolve(this._mockResult)
          this._highlightPromises.splice(index, 1)
        }
      }, this._autoResolveTimeout)
    }

    this._highlightPromises.push({ promise, resolve, timeout })

    return promise
  }

  override async createBufferWithHighlights(
    id: number,
    content: string,
    filetype: string,
    _version: number = 1,
    _autoInitialize: boolean = true,
  ): Promise<CreateBufferHighlightResult> {
    this._bufferFiletypes.set(id, filetype)
    const result = await this.highlightOnce(content, filetype)
    return { hasParser: true, ...result }
  }

  override async updateBuffer(id: number, _edits: Edit[], content: string, version: number): Promise<UpdateOutcome> {
    const result = await this.highlightOnce(content, this._bufferFiletypes.get(id) ?? "plaintext")
    if (result.error) return { status: "error", bufferId: id, version, error: result.error }
    return { status: "completed", bufferId: id, version, highlights: result.highlights ?? [] }
  }

  override async removeBuffer(id: number): Promise<void> {
    this._bufferFiletypes.delete(id)
  }

  setMockResult(result: { highlights?: SimpleHighlight[]; warning?: string; error?: string }) {
    this._mockResult = result
  }

  resolveHighlightOnce(index: number = 0) {
    if (index >= 0 && index < this._highlightPromises.length) {
      const item = this._highlightPromises[index]
      if (item.timeout) {
        this._clock.clearTimeout(item.timeout)
      }
      item.resolve(this._mockResult)
      this._highlightPromises.splice(index, 1)
    }
  }

  resolveAllHighlightOnce() {
    for (const { resolve, timeout } of this._highlightPromises) {
      if (timeout) {
        this._clock.clearTimeout(timeout)
      }
      resolve(this._mockResult)
    }
    this._highlightPromises = []
  }

  isHighlighting(): boolean {
    return this._highlightPromises.length > 0
  }
}
