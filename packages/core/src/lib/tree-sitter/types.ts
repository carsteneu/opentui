export interface HighlightRange {
  startCol: number
  endCol: number
  group: string
}

export interface HighlightResponse {
  line: number
  highlights: HighlightRange[]
  droppedHighlights: HighlightRange[]
}

export interface HighlightMeta {
  isInjection?: boolean
  injectionLang?: string
  containsInjection?: boolean
  conceal?: string | null // Value from (#set! conceal "...") predicate
  concealLines?: string | null // Value from (#set! conceal_lines "...") predicate - indicates the whole line should be concealed
}

export type SimpleHighlight = [number, number, string, HighlightMeta?]

export interface InjectionMapping {
  // Maps tree-sitter node types to target filetypes
  nodeTypes?: { [nodeType: string]: string }
  // Maps info string content (e.g., from code blocks) to target filetypes
  infoStringMap?: { [infoString: string]: string }
}

export interface FiletypeParserOptions {
  filetype: string
  aliases?: string[]
  queries: {
    highlights: string[] // Array of URLs or local file paths to fetch highlight queries from
    injections?: string[] // Array of URLs or local file paths to fetch injection queries from
  }
  wasm: string // URL or local file path to the language parser WASM file
  injectionMapping?: InjectionMapping // Optional mapping for injection handling
}

export interface BufferState {
  id: number
  version: number
  content: string
  filetype: string
  hasParser: boolean
}

export interface ParsedBuffer extends BufferState {
  hasParser: true
}

export type TreeSitterWorkerLogType = "log" | "error" | "warn"

export type TreeSitterWorkerRequest =
  | { type: "INIT"; dataPath: string; treeSitterWasmPath?: string }
  | { type: "ADD_FILETYPE_PARSER"; filetypeParser: FiletypeParserOptions }
  | { type: "PRELOAD_PARSER"; filetype: string; messageId: string }
  | {
      type: "INITIALIZE_PARSER"
      bufferId: number
      version: number
      content: string
      filetype: string
      messageId: string
      simpleHighlightsOnly?: boolean
    }
  | { type: "HANDLE_EDITS"; bufferId: number; version: number; content: string; edits: Edit[] }
  | { type: "GET_PERFORMANCE"; messageId: string }
  | { type: "RESET_BUFFER"; bufferId: number; version: number; content: string; edits: Edit[] }
  | { type: "DISPOSE_BUFFER"; bufferId: number }
  | { type: "ONESHOT_HIGHLIGHT"; content: string; filetype: string; messageId: string }
  | { type: "UPDATE_DATA_PATH"; dataPath: string; messageId: string }
  | { type: "CLEAR_CACHE"; messageId: string }

export type TreeSitterWorkerResponse =
  | { type: "INIT_RESPONSE"; error?: string }
  | {
      type: "PARSER_INIT_RESPONSE"
      bufferId: number
      messageId: string
      hasParser: boolean
      simpleHighlights?: SimpleHighlight[]
      warning?: string
      error?: string
    }
  | {
      type: "HIGHLIGHT_RESPONSE"
      bufferId: number
      version: number
      highlights: HighlightResponse[]
      simpleHighlights?: SimpleHighlight[]
    }
  | { type: "PRELOAD_PARSER_RESPONSE"; messageId: string; hasParser: boolean }
  | { type: "BUFFER_DISPOSED"; bufferId: number }
  | { type: "PERFORMANCE_RESPONSE"; performance: PerformanceStats; messageId: string }
  | {
      type: "ONESHOT_HIGHLIGHT_RESPONSE"
      messageId: string
      hasParser: boolean
      highlights?: SimpleHighlight[]
      warning?: string
      error?: string
    }
  | { type: "UPDATE_DATA_PATH_RESPONSE"; messageId: string; error?: string }
  | { type: "CLEAR_CACHE_RESPONSE"; messageId: string; error?: string }
  | { type: "WARNING"; bufferId?: number; warning: string }
  | { type: "ERROR"; bufferId?: number; messageId?: string; error: string }
  | { type: "WORKER_LOG"; logType: TreeSitterWorkerLogType; data: unknown[] }

export interface TreeSitterClientEvents {
  "highlights:response": [bufferId: number, version: number, highlights: HighlightResponse[]]
  "buffer:initialized": [bufferId: number, hasParser: boolean]
  "buffer:disposed": [bufferId: number]
  "worker:log": [logType: TreeSitterWorkerLogType, message: string]
  error: [error: string, bufferId?: number]
  warning: [warning: string, bufferId?: number]
}

export interface TreeSitterClientOptions {
  dataPath: string // Directory for storing downloaded parsers and queries
  workerPath?: string | URL
  initTimeout?: number // Timeout in milliseconds for worker initialization, defaults to 10000
}

export interface Edit {
  startIndex: number
  oldEndIndex: number
  newEndIndex: number
  startPosition: { row: number; column: number }
  oldEndPosition: { row: number; column: number }
  newEndPosition: { row: number; column: number }
}

/** Full initial highlight result for a newly owned versioned buffer. */
export interface CreateBufferHighlightResult {
  hasParser: boolean
  highlights?: SimpleHighlight[]
  warning?: string
  error?: string
}

/** Result of a single updateBuffer() call, settled exactly once. */
export type UpdateOutcome =
  | { status: "completed"; bufferId: number; version: number; highlights?: SimpleHighlight[] }
  | { status: "superseded"; bufferId: number; version: number; supersededBy: number }
  | { status: "error"; bufferId: number; version: number; error: string }
  | { status: "skipped"; bufferId: number; version: number }

/** Always-on backpressure/queue counters (payload sizes in UTF-8 bytes). */
export interface UpdateQueueStats {
  /** Number of edit/reset jobs actually posted to the worker. */
  posted: number
  /** Number of posted jobs scheduled (always equals posted for now). */
  started: number
  /** updateBuffer() calls settled as completed via a versioned worker-ACK. */
  completed: number
  /** updateBuffer() calls settled as superseded by a newer update. */
  superseded: number
  /** Cumulative UTF-8 bytes of posted job payloads (newest content only per job). */
  postedBytes: number
  /** Maximum concurrent active jobs (target <= 1). */
  activeHighWater: number
  /** Maximum pending jobs per buffer (target <= 1). */
  pendingJobsHighWater: number
  /** Bytes of the single newest pending payload (0 when none). */
  pendingBytes: number
  /** Peak bytes held by a single pending payload, never the sum of versions. */
  pendingByteHighWater: number
}

export interface PerformanceStats {
  averageParseTime: number
  parseTimes: number[]
  averageQueryTime: number
  queryTimes: number[]
}
