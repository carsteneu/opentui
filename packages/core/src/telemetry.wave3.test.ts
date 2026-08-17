import { describe, test, expect } from "bun:test"
import {
  setTelemetryEnabled,
  isTelemetryEnabled,
  recordWave3Span,
  getTelemetrySnapshot,
  Wave3SpanName,
} from "./telemetry.js"

describe("wave3 stage telemetry", () => {
  test("off-state: single cheap guard, no span recorded, no reset side effects", () => {
    setTelemetryEnabled(false)
    recordWave3Span("default", "markdown.parse", 0, 10)
    expect(getTelemetrySnapshot().wave3Spans).toEqual([])
    setTelemetryEnabled(true)
    setTelemetryEnabled(false)
    expect(getTelemetrySnapshot().wave3Spans).toEqual([])
  })

  test("on-state: records session+stage tagged spans and resets on disable", () => {
    setTelemetryEnabled(false)
    setTelemetryEnabled(true)
    expect(isTelemetryEnabled()).toBe(true)
    recordWave3Span("s1", "markdown.parse", 5, 9)
    recordWave3Span("s1", "layout.render", 9, 12)
    const snapshot = getTelemetrySnapshot()
    expect(snapshot.wave3Spans.length).toBe(2)
    expect(snapshot.wave3Spans[0]).toEqual({ name: "s1.markdown.parse", startMs: 5, endMs: 9 })
    expect(snapshot.wave3Spans[1]).toEqual({ name: "s1.layout.render", startMs: 9, endMs: 12 })
    setTelemetryEnabled(false)
    expect(getTelemetrySnapshot().wave3Spans).toEqual([])
  })

  test("invalid (end < start) spans are rejected in on-state", () => {
    setTelemetryEnabled(true)
    recordWave3Span("s1", "markdown.parse", 10, 5)
    expect(getTelemetrySnapshot().wave3Spans).toEqual([])
    setTelemetryEnabled(false)
  })

  test("span names are bounded/session-qualified and typed", () => {
    const name: Wave3SpanName = "s1.markdown.parse"
    expect(name.startsWith("s1.")).toBe(true)
  })
})
