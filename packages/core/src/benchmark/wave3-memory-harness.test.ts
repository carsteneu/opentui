// Wave-3 memory gate (Loop C) — invariant tests.
//
// Drives all three phases at diagnostic scale over a REAL tree-sitter worker
// chain (bounded document window => steady state) and asserts every §9.5
// single-arm gate. This is the reproducibility anchor for the loop; the full-n
// raw-data pass lives in scripts/wave3-memory-gate.ts.

import { test, expect, beforeAll, afterAll } from "bun:test"
import { tmpdir } from "os"
import { join } from "path"
import { mkdir } from "fs/promises"
import { TreeSitterClient } from "../lib/tree-sitter/index.js"
import {
  evaluateMemoryGates,
  overallVerdict,
  runPhaseASteady,
  runPhaseBLifecycle,
  runPhaseCFaults,
} from "./wave3-memory-harness.js"

let dataPath: string

beforeAll(async () => {
  dataPath = join(tmpdir(), "tree-sitter-shared-test-data")
  await mkdir(dataPath, { recursive: true })
})

function makeClient(): TreeSitterClient {
  return new TreeSitterClient({ dataPath })
}

test("wave3 memory gate: rolling steady state (Phase A) is flat and bounded", async () => {
  const client = makeClient()
  try {
    const sample = await runPhaseASteady(client, {
      width: 100,
      height: 40,
      windowLines: 200,
      mutations: 256,
      settleEvery: 16,
      fullReplacementEvery: 64,
      gcPerWindow: true,
    })
    expect(sample.windows.length).toBeGreaterThanOrEqual(8)
    // Latest-wins backpressure bound: <= 1 active + 1 pending per buffer.
    expect(sample.queue.activeHighWater).toBeLessThanOrEqual(1)
    expect(sample.queue.pendingJobsHighWater).toBeLessThanOrEqual(1)
    // Rolled window must stay bounded to the document window (not grow with mutations).
    expect(sample.queue.pendingByteHighWater).toBeLessThanOrEqual(sample.windowContentBytes + 128 * 1024)
    // After the final settle the queue drains.
    expect(sample.finalResources.activeJobs).toBe(0)
    expect(sample.finalResources.pendingJobs).toBe(0)
  } finally {
    await client.destroy()
  }
})

test("wave3 memory gate: lifecycle (Phase B) releases owners and returns native to baseline", async () => {
  const sample = await runPhaseBLifecycle(makeClient, {
    cycles: 8,
    width: 80,
    height: 24,
    windowLines: 100,
  })
  // A fully destroyed client must hold no live owner state.
  expect(sample.lastClientResources.activeJobs).toBe(0)
  expect(sample.lastClientResources.pendingJobs).toBe(0)
  expect(sample.lastClientResources.buffers).toBe(0)
  expect(sample.lastClientResources.messageCallbacks).toBe(0)
  expect(sample.lastClientResources.hasWorker).toBe(false)
  // Native allocator must not drift upward across destroy cycles.
  const tolerance = Math.max(64, sample.warmNativeActiveAllocations * 0.1)
  expect(sample.finalNativeActiveAllocations).toBeLessThanOrEqual(sample.warmNativeActiveAllocations + tolerance)
})

test("wave3 memory gate: fault/bound matrix (Phase C) drains and respects the 1+1 bound", async () => {
  const sample = await runPhaseCFaults(makeClient, { supersedeBurst: 64 })
  expect(sample.scenarios.length).toBeGreaterThanOrEqual(4)
  for (const scenario of sample.scenarios) {
    expect(scenario.afterSettle.activeJobs, scenario.name).toBe(0)
    expect(scenario.afterSettle.pendingJobs, scenario.name).toBe(0)
    expect(scenario.queue.activeHighWater, scenario.name).toBeLessThanOrEqual(1)
    expect(scenario.queue.pendingJobsHighWater, scenario.name).toBeLessThanOrEqual(1)
  }
})

test("wave3 memory gate: full gate evaluation reports PASS", async () => {
  const steady = await runPhaseASteady(makeClient(), {
    width: 100,
    height: 40,
    windowLines: 200,
    mutations: 320,
    settleEvery: 16,
  })
  const lifecycle = await runPhaseBLifecycle(makeClient, {
    cycles: 8,
    width: 80,
    height: 24,
    windowLines: 100,
  })
  const faults = await runPhaseCFaults(makeClient, { supersedeBurst: 64 })

  const gates = evaluateMemoryGates({ steady, lifecycle, faults })
  for (const gate of gates) {
    expect({ id: gate.id, pass: gate.pass, value: gate.value, limit: gate.limit, detail: gate.detail }).toEqual(
      expect.objectContaining({ pass: true }),
    )
  }
  expect(overallVerdict(gates)).toBe("PASS")
})
