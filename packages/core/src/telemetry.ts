// Opt-in performance telemetry. Disabled by default; every hot-path call is a
// single boolean guard, so the disabled state has ~zero cost (no allocation, no
// clock reads). This is the A3 foundation for the Wave-0 observability work.
//
// Deliberately a standalone module with no imports: wiring it into the core
// entry is optional (callers/harness import by path) so it never adds to the
// cold-import graph unless explicitly used.

export type TelemetryCounterName =
  | "frame.total"
  | "frame.full"
  | "frame.partial"
  | "frame.splitFooter"
  | "frame.source.request"
  | "frame.source.requestPartial"
  | "frame.source.live"
  | "frame.source.timer"
  | "frame.native.rendered"
  | "frame.native.retryable-skip"
  | "frame.native.failed"
  | "frame.native.blocked"
  | "frame.native.backpressured"
  | "frame.followup.immediateRerender"

export type TelemetryHistogramLabel = "frame.type.full" | "frame.type.partial" | "frame.type.splitFooter"

export interface TelemetryMark {
  name: string
  /** performance.now() milliseconds when the mark was recorded. */
  atMs: number
}

export interface TelemetrySpan {
  name: string
  startMs: number
  endMs: number
}

export interface TelemetrySnapshot {
  enabled: boolean
  counters: Partial<Record<TelemetryCounterName, number>>
  histogram: Partial<Record<TelemetryHistogramLabel, number>>
  marks: TelemetryMark[]
  spans: TelemetrySpan[]
}

/** Upper bound on recorded marks/spans so a buggy consumer cannot unboundedly grow memory. */
const EVENT_CAP = 10_000

let enabled = false
const counters = new Map<TelemetryCounterName, number>()
const histogram = new Map<TelemetryHistogramLabel, number>()
const marks: TelemetryMark[] = []
const spans: TelemetrySpan[] = []

export function setTelemetryEnabled(value: boolean): void {
  if (enabled === value) return
  enabled = value
  if (!value) resetTelemetry()
}

export function isTelemetryEnabled(): boolean {
  return enabled
}

export function resetTelemetry(): void {
  counters.clear()
  histogram.clear()
  marks.length = 0
  spans.length = 0
}

export function increment(name: TelemetryCounterName): void {
  if (!enabled) return
  counters.set(name, (counters.get(name) ?? 0) + 1)
}

export function add(name: TelemetryCounterName, delta: number): void {
  if (!enabled || delta <= 0) return
  counters.set(name, (counters.get(name) ?? 0) + delta)
}

export function recordHistogramLabel(label: TelemetryHistogramLabel): void {
  if (!enabled) return
  histogram.set(label, (histogram.get(label) ?? 0) + 1)
}

export function mark(name: string, atMs?: number): void {
  if (!enabled || marks.length >= EVENT_CAP) return
  marks.push({ name, atMs: atMs ?? performance.now() })
}

export function recordSpan(name: string, startMs: number, endMs: number): void {
  if (!enabled || endMs < startMs || spans.length >= EVENT_CAP) return
  spans.push({ name, startMs, endMs })
}

export function getTelemetrySnapshot(): TelemetrySnapshot {
  return {
    enabled,
    counters: Object.fromEntries(counters) as TelemetrySnapshot["counters"],
    histogram: Object.fromEntries(histogram) as TelemetrySnapshot["histogram"],
    marks: marks.slice(),
    spans: spans.map((span) => ({ ...span })),
  }
}
