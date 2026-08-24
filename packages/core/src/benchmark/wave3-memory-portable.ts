// Portable Wave-3 memory/eventloop measurement helpers.
//
// These helpers are intentionally OFF the TreeSitterClient internal type surface:
// they rely only on seams that exist on BOTH arms (candidate ab2b9ebc and baseline
// fccae215) so a single source file can measure heap/eventloop on either worktree.
// The candidate-only queue/resource gates live in ../testing/resource-inventory.ts
// and are NOT imported here.

import { resolveRenderLib } from "../zig.js"

export interface HeapSnapshot {
  heapUsed: number
  heapTotal: number
  arrayBuffers: number
  rss: number
}

/** RSS heap/array-buffer snapshot. arrayBuffers is only present on some runtimes. */
export function snapshotHeap(): HeapSnapshot {
  const memory = process.memoryUsage()
  return {
    heapUsed: memory.heapUsed,
    heapTotal: memory.heapTotal,
    arrayBuffers: (memory as { arrayBuffers?: number }).arrayBuffers ?? 0,
    rss: memory.rss,
  }
}

export interface NativeStats {
  totalRequestedBytes: number
  activeAllocations: number
  smallAllocations: number
  largeAllocations: number
  arenaAllocatedBytes: number
}

export interface NativeSnapshot {
  allocator: Omit<NativeStats, "arenaAllocatedBytes">
  arenaAllocatedBytes: number
}

/** Live native allocator + arena snapshot (provenance-agnostic). */
export function snapshotNative(): NativeSnapshot {
  const lib = resolveRenderLib()
  const stats = lib.getAllocatorStats()
  return {
    allocator: {
      totalRequestedBytes: stats.totalRequestedBytes,
      activeAllocations: stats.activeAllocations,
      smallAllocations: stats.smallAllocations,
      largeAllocations: stats.largeAllocations,
    },
    arenaAllocatedBytes: lib.getArenaAllocatedBytes(),
  }
}

/** Force a full GC when a runtime exposes it. Best-effort and provenance-neutral. */
export function forceGC(): void {
  try {
    const globalGc = (globalThis as { gc?: () => void }).gc
    if (typeof globalGc === "function") {
      globalGc()
      return
    }
    const bunGc = (globalThis as { Bun?: { gc: (force: boolean) => void } }).Bun?.gc
    if (typeof bunGc === "function") {
      bunGc(true)
      return
    }
  } catch {
    // No GC seam in this runtime; measurements fall back to unforced windows.
  }
}

/** Return the p-th percentile of an ascending-sorted sample. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0
  if (sorted.length === 1) return sorted[0]!
  const rank = (p / 100) * (sorted.length - 1)
  const lower = Math.floor(rank)
  const upper = Math.ceil(rank)
  if (lower === upper) return sorted[lower]!
  const weight = rank - lower
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight
}

export function median(sorted: readonly number[]): number {
  return percentile(sorted, 50)
}

export interface EventLoopLagStats {
  p50: number
  p95: number
  p99: number
  max: number
  samples: number
}

/**
 * Measure event-loop lag for `durationMs` by scheduling self-rescheduling
 * timers every `intervalMs` and recording how far each tick overshoots.
 * Pure setTimeout/performance.now — portable across runtimes and arms.
 */
export function runEventLoopLagCollector(opts: {
  intervalMs?: number
  durationMs: number
}): Promise<EventLoopLagStats> {
  const intervalMs = opts.intervalMs ?? 10
  const deadline = performance.now() + opts.durationMs
  const lags: number[] = []
  let previous = performance.now()
  return new Promise<EventLoopLagStats>((resolve) => {
    const tick = (): void => {
      const now = performance.now()
      lags.push(Math.max(0, now - previous - intervalMs))
      previous = now
      if (now >= deadline) {
        const sorted = [...lags].sort((a, b) => a - b)
        resolve({
          p50: percentile(sorted, 50),
          p95: percentile(sorted, 95),
          p99: percentile(sorted, 99),
          max: sorted.length > 0 ? sorted[sorted.length - 1]! : 0,
          samples: sorted.length,
        })
        return
      }
      setTimeout(tick, intervalMs)
    }
    setTimeout(tick, intervalMs)
  })
}

/**
 * Run the event-loop lag collector on a fixed background cadence and return a
 * stop() that yields the accumulated stats. Used to sample lag *during* a
 * rolling workload so p99 reflects real main-thread contention.
 */
export function startEventLoopLagSampler(opts: { intervalMs?: number }): {
  stop: () => EventLoopLagStats
} {
  const intervalMs = opts.intervalMs ?? 10
  const lags: number[] = []
  let previous = performance.now()
  let stopped = false
  const tick = (): void => {
    if (stopped) return
    const now = performance.now()
    lags.push(Math.max(0, now - previous - intervalMs))
    previous = now
    setTimeout(tick, intervalMs)
  }
  setTimeout(tick, intervalMs)
  return {
    stop: () => {
      stopped = true
      const sorted = [...lags].sort((a, b) => a - b)
      return {
        p50: percentile(sorted, 50),
        p95: percentile(sorted, 95),
        p99: percentile(sorted, 99),
        max: sorted.length > 0 ? sorted[sorted.length - 1]! : 0,
        samples: sorted.length,
      }
    },
  }
}
