// Core exports without 3D dependencies
export * from "./Renderable.js"
export * from "./types.js"
export * from "./utils.js"
export * from "./buffer.js"
export * from "./text-buffer.js"
export * from "./text-buffer-view.js"
export * from "./edit-buffer.js"
export * from "./editor-view.js"
export * from "./syntax-style.js"
export * from "./post/effects.js"
export * from "./post/filters.js"
export * from "./post/matrices.js"
export * from "./animation/Timeline.js"
export * from "./lib/index.js"
export * from "./renderer.js"
export * from "./plugins/types.js"
export * from "./plugins/registry.js"
export * from "./plugins/core-slot.js"
export * from "./NativeSpanFeed.js"
export * from "./audio.js"
export type { AudioStreamDemuxOutput, AudioStreamDemuxer, AudioStreamDemuxerFactory } from "./audio-stream/demuxer.js"
export { createIcyStreamDemuxer } from "./audio-stream/icy/demuxer.js"
export type { IcyStreamDemuxerOptions } from "./audio-stream/icy/demuxer.js"
export * from "./image.js"
export * from "./renderables/index.js"
export * from "./zig.js"
export * from "./console.js"
export { resolveBundledFilePath } from "./platform/runtime.js"
export * as Yoga from "./yoga.js"
// Opt-in performance telemetry API (module is already imported for the
// importReady mark, so this re-export adds no cold-import cost; all functions
// are no-ops when telemetry is disabled).
export {
  setTelemetryEnabled,
  isTelemetryEnabled,
  resetTelemetry,
  increment,
  add,
  recordHistogramLabel,
  recordSpan,
  mark,
  getTelemetrySnapshot,
} from "./telemetry.js"
export type { TelemetryCounterName, TelemetryHistogramLabel, TelemetrySnapshot } from "./telemetry.js"
import "./renderer-console.integration.js"
import "./renderer-tree-sitter.integration.js"
import { mark } from "./telemetry.js"

// Marked at the end of module evaluation: all heavy deps (zig native setup,
// renderables, tree-sitter, markdown) have finished importing by this point.
mark("opentui.importReady")
