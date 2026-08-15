import { describe, it, expect, beforeEach } from "bun:test"
import {
  setTelemetryEnabled,
  isTelemetryEnabled,
  increment,
  add,
  recordHistogramLabel,
  mark,
  recordSpan,
  resetTelemetry,
  getTelemetrySnapshot,
  type TelemetrySnapshot,
} from "./telemetry.js"

describe("telemetry opt-in module", () => {
  beforeEach(() => {
    setTelemetryEnabled(false)
    resetTelemetry()
  })

  it("is disabled by default and disabled state is a no-op", () => {
    expect(isTelemetryEnabled()).toBe(false)
    increment("frame.total")
    recordHistogramLabel("frame.type.full")
    mark("firstNativeCommit")
    recordSpan("span", 10, 20)
    const snap = getTelemetrySnapshot()
    expect(snap.enabled).toBe(false)
    expect(snap.counters).toEqual({})
    expect(snap.histogram).toEqual({})
    expect(snap.marks).toEqual([])
    expect(snap.spans).toEqual([])
  })

  it("records counters, histogram, marks and spans when enabled", () => {
    setTelemetryEnabled(true)
    increment("frame.total")
    increment("frame.total")
    add("frame.full", 3)
    recordHistogramLabel("frame.type.full")
    recordHistogramLabel("frame.type.partial")
    mark("firstNativeCommit")
    recordSpan("firstNativeCommit", 100, 250)

    const home = Math.floor(performance.now())
    const snap = getTelemetrySnapshot()
    expect(snap.enabled).toBe(true)
    expect(snap.counters["frame.total"]).toBe(2)
    expect(snap.counters["frame.full"]).toBe(3)
    expect(snap.histogram["frame.type.full"]).toBe(1)
    expect(snap.histogram["frame.type.partial"]).toBe(1)
    expect(snap.marks[0]!.name).toBe("firstNativeCommit")
    expect(snap.marks[0]!.atMs).toBeGreaterThanOrEqual(home - 1)
    expect(snap.spans[0]).toEqual({ name: "firstNativeCommit", startMs: 100, endMs: 250 })
  })

  it("snapshot is a copy, mutation of snapshot does not affect live state", () => {
    setTelemetryEnabled(true)
    increment("frame.total")
    const snap = getTelemetrySnapshot()
    snap.counters["frame.total"] = 999
    expect(getTelemetrySnapshot().counters["frame.total"]).toBe(1)
  })

  it("disabling clears accumulated telemetry", () => {
    setTelemetryEnabled(true)
    increment("frame.total")
    mark("m")
    setTelemetryEnabled(false)
    expect(isTelemetryEnabled()).toBe(false)
    const snap = getTelemetrySnapshot()
    expect(snap.counters).toEqual({})
    expect(snap.marks).toEqual([])
  })

  it("rejects invalid spans when enabled", () => {
    setTelemetryEnabled(true)
    recordSpan("bad", 200, 100)
    expect(getTelemetrySnapshot().spans).toEqual([])
  })

  it("sums counters are consistent after mixed increments (explainable frames)", () => {
    setTelemetryEnabled(true)
    increment("frame.total")
    increment("frame.total")
    increment("frame.total")
    recordHistogramLabel("frame.type.full")
    recordHistogramLabel("frame.type.partial")
    add("frame.source.request", 2)
    add("frame.native.rendered", 3)
    const snap = getTelemetrySnapshot() as TelemetrySnapshot & { counters: Record<string, number> }
    const explained = snap.histogram["frame.type.full"]! + snap.histogram["frame.type.partial"]!
    expect(snap.counters["frame.total"]).toBe(3)
    expect(explained).toBe(2)
  })
})
