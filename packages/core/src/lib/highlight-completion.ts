export const getHighlightCompletion = Symbol.for("@opentui/core/get-highlight-completion")

export interface HighlightCompletionProvider {
  [getHighlightCompletion](): Promise<void> | null
}
