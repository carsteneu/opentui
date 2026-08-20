// Wave-3 memory gate (Loop C): rolling steady state, lifecycle, fault matrix.
//
// Measures the candidate's memory behaviour through public + test seams and
// evaluates the §9.5 gates. Phase A/B drive a real CodeRenderable + real
// tree-sitter worker (bounded document window => steady state). Resource-owner
// counts come from testing/resource-inventory is candidate-only; heap/eventloop
// helpers come from wave3-memory-portable and are arm-agnostic.

import { CodeRenderable } from "../renderables/Code.js"
import { SyntaxStyle } from "../syntax-style.js"
import { RGBA } from "../lib/RGBA.js"
import { createTestRenderer, type TestRendererSetup } from "../testing/test-renderer.js"
import { snapshotClientResources } from "../testing/resource-inventory.js"
import type { TreeSitterClient } from "../lib/tree-sitter/index.js"
import type { Edit } from "../lib/tree-sitter/types.js"
import {
  forceGC,
  median,
  snapshotHeap,
  snapshotNative,
  startEventLoopLagSampler,
  type EventLoopLagStats,
  type HeapSnapshot,
} from "./wave3-memory-portable.js"

export interface MemoryWindow extends HeapSnapshot {
  nativeActiveAllocations: number
}

export interface RollingSteadySample {
  phase: "A"
  mutations: number
  windowContentBytes: number
  /** One cleaned (post-GC) heap/native window per settle point. */
  windows: MemoryWindow[]
  queue: {
    posted: number
    started: number
    completed: number
    superseded: number
    postedBytes: number
    activeHighWater: number
    pendingJobsHighWater: number
    pendingBytes: number
    pendingByteHighWater: number
  }
  eventLoop: EventLoopLagStats
  finalResources: {
    buffers: number
    activeJobs: number
    pendingJobs: number
    messageCallbacks: number
    destroyCallbacks: number
    hasWorker: boolean
  }
}

export interface LifecycleSample {
  phase: "B"
  cycles: number
  warmNativeActiveAllocations: number
  finalNativeActiveAllocations: number
  maxNativeActiveAllocations: number
  warmHeapUsedMedian: number
  finalHeapUsedMedian: number
  lastClientResources: {
    buffers: number
    activeJobs: number
    pendingJobs: number
    messageCallbacks: number
    destroyCallbacks: number
    hasWorker: boolean
  }
}

export interface FaultScenarioResult {
  name: string
  afterSettle: {
    buffers: number
    activeJobs: number
    pendingJobs: number
    messageCallbacks: number
    destroyCallbacks: number
    hasWorker: boolean
  }
  queue: {
    activeHighWater: number
    pendingJobsHighWater: number
  }
  finalContentVersion?: number
}

export interface FaultMatrixSample {
  phase: "C"
  scenarios: FaultScenarioResult[]
}

export interface MemorySamplesByPhase {
  steady: RollingSteadySample
  lifecycle: LifecycleSample
  faults: FaultMatrixSample
}

// ---------------------------------------------------------------------------
// small content + edit helpers
// ---------------------------------------------------------------------------

function endPositionOf(s: string): { row: number; column: number } {
  const lastNewline = s.lastIndexOf("\n")
  if (lastNewline === -1) return { row: 0, column: s.length }
  let row = 0
  for (let i = 0; i < s.length; i++) if (s[i] === "\n") row++
  return { row, column: s.length - lastNewline - 1 }
}

function fullReplaceEdit(oldContent: string, newContent: string): Edit {
  return {
    startIndex: 0,
    oldEndIndex: oldContent.length,
    newEndIndex: newContent.length,
    startPosition: { row: 0, column: 0 },
    oldEndPosition: endPositionOf(oldContent),
    newEndPosition: endPositionOf(newContent),
  }
}

/** Deterministic, parseable TypeScript source with n lines (bounded window). */
function makeTsContent(lines: number): string {
  const out: string[] = []
  for (let i = 0; i < lines; i++) {
    const variant = i % 3
    if (variant === 0) {
      out.push(`const item${i} = { id: ${i}, name: "item_${i % 7}", qty: ${i * 2} }`)
    } else if (variant === 1) {
      out.push(`function process_${i}(${i % 5 > 0 ? "entry" : "value"}: number): boolean {`)
      out.push(`  return entry${i % 5 > 0 ? ` + ${i}` : ""} > ${i};`)
      out.push(`}`)
    } else {
      out.push(`// handle id ${i} case for rolling steady state`)
    }
  }
  return out.join("\n")
}

// ---------------------------------------------------------------------------
// CodeRenderable driver helpers (mirrors wave3-harness streaming semantics)
// ---------------------------------------------------------------------------

interface CodeRig {
  code: CodeRenderable
  setup: TestRendererSetup
  syntaxStyle: SyntaxStyle
}

function newCodeRig(client: TreeSitterClient, width: number, height: number, filetype: string): Promise<CodeRig> {
  const setupPromise = createTestRenderer({ width, height })
  const syntaxStyle = SyntaxStyle.fromStyles({
    keyword: { fg: "#ff0000" },
    number: { fg: "#00ffff" },
    string: { fg: "#ffcc00" },
  })
  return setupPromise.then((setup) => {
    const code = new CodeRenderable(setup.renderer, {
      content: "",
      filetype,
      syntaxStyle,
      treeSitterClient: client,
      streaming: true,
      drawUnstyledText: false,
      width: "100%",
      height: "100%",
      fg: RGBA.fromValues(255, 255, 255, 255),
    })
    setup.renderer.root.add(code)
    return { code, setup, syntaxStyle }
  })
}

async function settleStreaming(rig: CodeRig, maxMs: number): Promise<void> {
  await rig.setup.renderOnce()
  const deadline = performance.now() + maxMs
  while (performance.now() < deadline) {
    await rig.setup.renderOnce()
    if (!rig.code.isHighlighting) {
      await rig.code.highlightingDone.catch(() => undefined)
      // One extra flush so a content change queued for the next render is not
      // measured mid-flight in the following GC-window snapshot.
      await rig.setup.renderOnce()
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  throw new Error(`wave3-memory: streaming did not settle within ${maxMs} ms`)
}

function destroyRig(rig: CodeRig): void {
  rig.setup.renderer.destroy()
  rig.syntaxStyle.destroy()
}

// ---------------------------------------------------------------------------
// Phase A — rolling steady state (bounded doc window, 10k mutations by default)
// ---------------------------------------------------------------------------

export interface PhaseAOptions {
  width?: number
  height?: number
  windowLines?: number
  mutations?: number
  settleEvery?: number
  fullReplacementEvery?: number
  gcPerWindow?: boolean
  eventLoopDurationMs?: number
  filetype?: string
}

export async function runPhaseASteady(
  client: TreeSitterClient,
  opts: PhaseAOptions = {},
): Promise<RollingSteadySample> {
  const width = opts.width ?? 250
  const height = opts.height ?? 60
  const windowLines = opts.windowLines ?? 1000
  const mutations = opts.mutations ?? 10_000
  const settleEvery = opts.settleEvery ?? 32
  const fullReplacementEvery = opts.fullReplacementEvery ?? 256
  const gcPerWindow = opts.gcPerWindow ?? true
  const filetype = opts.filetype ?? "typescript"

  const rig = await newCodeRig(client, width, height, filetype)
  try {
    const fullContent = makeTsContent(windowLines)
    const windowContentBytes = Buffer.byteLength(fullContent, "utf8")

    // Warmup: accept the working window and settle.
    rig.code.content = fullContent
    await settleStreaming(rig, 20_000)
    if (gcPerWindow) forceGC()
    const baselineHeap = snapshotHeap()

    const eventLoopSampler = startEventLoopLagSampler({})
    const windows: MemoryWindow[] = []

    let version = 2
    for (let mutation = 1; mutation <= mutations; mutation++) {
      // Bounded rolling edit: shift one line in, keep the window size fixed.
      const nextContent =
        mutation % fullReplacementEvery === 0
          ? makeTsContent(windowLines) // full replacement exercises reset/fallback path
          : rollingShift(fullContent, (mutation * 7) % windowLines)
      rig.code.content = nextContent
      version++

      if (mutation % settleEvery === 0) {
        await settleStreaming(rig, 10_000)
        if (gcPerWindow) forceGC()
        const heap = snapshotHeap()
        windows.push({ ...heap, nativeActiveAllocations: snapshotNative().allocator.activeAllocations })
      }
    }

    // Final settle so the queue drains and owners can be observed idle.
    await settleStreaming(rig, 15_000)
    if (gcPerWindow) forceGC()
    const eventLoop = eventLoopSampler.stop()
    // getUpdateQueueStats() returns a cumulative snapshot; fetch AFTER the loop
    // so A2/A3 see the true high-water marks over the whole run.
    const queue = client.getUpdateQueueStats()
    const resources = snapshotClientResources(client)

    return {
      phase: "A",
      mutations,
      windowContentBytes,
      windows,
      queue: {
        posted: queue.posted,
        started: queue.started,
        completed: queue.completed,
        superseded: queue.superseded,
        postedBytes: queue.postedBytes,
        activeHighWater: queue.activeHighWater,
        pendingJobsHighWater: queue.pendingJobsHighWater,
        pendingBytes: queue.pendingBytes,
        pendingByteHighWater: queue.pendingByteHighWater,
      },
      eventLoop,
      finalResources: {
        buffers: resources.buffers,
        activeJobs: resources.activeJobs,
        pendingJobs: resources.pendingJobs,
        messageCallbacks: resources.messageCallbacks,
        destroyCallbacks: resources.destroyCallbacks,
        hasWorker: resources.hasWorker,
      },
    }
  } finally {
    destroyRig(rig)
  }
}

/** Shift one window line: drop the first and append a new one at the end. */
function rollingShift(content: string, offset: number): string {
  const lines = content.split("\n")
  lines.shift()
  const variant = offset % 3
  const tail =
    variant === 0
      ? `const r${offset} = { id: ${offset}, name: "roll", qty: ${offset + 1} }`
      : variant === 1
        ? `function roll_${offset}(x: number): number { return x + ${offset}; }`
        : `// rolling offset ${offset}`
  lines.push(tail)
  return lines.join("\n")
}

// ---------------------------------------------------------------------------
// Phase B — lifecycle (create/use/destroy a full client+buffer+renderer rig)
// ---------------------------------------------------------------------------

export interface PhaseBOptions {
  cycles?: number
  width?: number
  height?: number
  windowLines?: number
  filetype?: string
}

export async function runPhaseBLifecycle(
  makeClient: () => TreeSitterClient,
  opts: PhaseBOptions = {},
): Promise<LifecycleSample> {
  const cycles = opts.cycles ?? 100
  const width = opts.width ?? 250
  const height = opts.height ?? 60
  const windowLines = opts.windowLines ?? 300
  const filetype = opts.filetype ?? "typescript"
  const content = makeTsContent(windowLines)

  let warmNativeActiveAllocations = 0
  let finalNativeActiveAllocations = 0
  let maxNativeActiveAllocations = 0
  const heapUsedPerCycle: number[] = []
  let lastClientResources: LifecycleSample["lastClientResources"] | undefined

  for (let cycle = 0; cycle < cycles; cycle++) {
    const client = makeClient()
    let rig: CodeRig | undefined
    try {
      rig = await newCodeRig(client, width, height, filetype)
      rig.code.content = content
      await settleStreaming(rig, 20_000)
    } finally {
      if (rig) destroyRig(rig)
      await client.destroy()
      forceGC()
    }
    const native = snapshotNative().allocator.activeAllocations
    const heap = snapshotHeap()
    heapUsedPerCycle.push(heap.heapUsed)
    maxNativeActiveAllocations = Math.max(maxNativeActiveAllocations, native)
    if (cycle === 0) warmNativeActiveAllocations = native
    if (cycle === cycles - 1) {
      finalNativeActiveAllocations = native
      const r = snapshotClientResources(client)
      lastClientResources = {
        buffers: r.buffers,
        activeJobs: r.activeJobs,
        pendingJobs: r.pendingJobs,
        messageCallbacks: r.messageCallbacks,
        destroyCallbacks: r.destroyCallbacks,
        hasWorker: r.hasWorker,
      }
    }
  }

  if (!lastClientResources) throw new Error("wave3-memory: lifecycle produced no terminal client resources")

  return {
    phase: "B",
    cycles,
    warmNativeActiveAllocations,
    finalNativeActiveAllocations,
    maxNativeActiveAllocations,
    warmHeapUsedMedian: median(
      [...heapUsedPerCycle].slice(0, Math.max(1, Math.floor(heapUsedPerCycle.length / 3))).sort((a, b) => a - b),
    ),
    finalHeapUsedMedian: median(
      [...heapUsedPerCycle].slice(-Math.max(1, Math.floor(heapUsedPerCycle.length / 3))).sort((a, b) => a - b),
    ),
    lastClientResources,
  }
}

// ---------------------------------------------------------------------------
// Phase C — fault / bound matrix
// ---------------------------------------------------------------------------

export interface PhaseCOptions {
  supersedeBurst?: number
}

async function freshClientResources(
  client: TreeSitterClient,
  waitMs: number,
): Promise<FaultScenarioResult["afterSettle"]> {
  await new Promise((resolve) => setTimeout(resolve, waitMs))
  const r = snapshotClientResources(client)
  return {
    buffers: r.buffers,
    activeJobs: r.activeJobs,
    pendingJobs: r.pendingJobs,
    messageCallbacks: r.messageCallbacks,
    destroyCallbacks: r.destroyCallbacks,
    hasWorker: r.hasWorker,
  }
}

async function clientQueue(client: TreeSitterClient): Promise<FaultScenarioResult["queue"]> {
  const q = client.getUpdateQueueStats()
  return { activeHighWater: q.activeHighWater, pendingJobsHighWater: q.pendingJobsHighWater }
}

export async function runPhaseCFaults(
  makeClient: () => TreeSitterClient,
  opts: PhaseCOptions = {},
): Promise<FaultMatrixSample> {
  const supersedeBurst = opts.supersedeBurst ?? 200
  const scenarios: FaultScenarioResult[] = []

  // C1: update burst on a single buffer must be bounded (latest-wins <= 1+1) and drain.
  {
    const client = makeClient()
    try {
      const bufferId = client.allocateBufferId()
      await createBuffer(client, bufferId)
      const updates: Array<Promise<unknown>> = []
      for (let i = 0; i < supersedeBurst; i++) {
        const content = `const v${i} = ${i}\nlet base = ${i}`
        updates.push(updateContent(client, bufferId, content, i + 2).catch(() => undefined))
      }
      await Promise.all(updates)
      await waitForIdle(client, 5000)
      scenarios.push({
        name: "C1-update-burst-bound",
        afterSettle: await freshClientResources(client, 50),
        queue: await clientQueue(client),
        finalContentVersion: supersedeBurst + 1,
      })
    } finally {
      await client.destroy()
    }
  }

  // C2: removeBuffer while an update is in flight must leave no active/pending job.
  {
    const client = makeClient()
    try {
      const bufferId = client.allocateBufferId()
      await createBuffer(client, bufferId)
      const pending = updateContent(client, bufferId, "let late = 1", 2).catch(() => undefined)
      await client.removeBuffer(bufferId)
      await pending
      await waitForIdle(client, 5000)
      scenarios.push({
        name: "C2-remove-in-flight",
        afterSettle: await freshClientResources(client, 50),
        queue: await clientQueue(client),
      })
    } finally {
      await client.destroy()
    }
  }

  // C3: destroy while updates are pending must terminate the worker and clear owners.
  {
    const client = makeClient()
    const bufferId = client.allocateBufferId()
    await createBuffer(client, bufferId)
    const pending: Array<Promise<unknown>> = []
    for (let i = 0; i < 5; i++) {
      pending.push(updateContent(client, bufferId, `let d${i} = ${i}`, i + 2).catch(() => undefined))
    }
    await client.destroy()
    await Promise.all(pending)
    const r = snapshotClientResources(client)
    scenarios.push({
      name: "C3-destroy-in-flight",
      afterSettle: {
        buffers: r.buffers,
        activeJobs: r.activeJobs,
        pendingJobs: r.pendingJobs,
        messageCallbacks: r.messageCallbacks,
        destroyCallbacks: r.destroyCallbacks,
        hasWorker: r.hasWorker,
      },
      queue: await clientQueue(client),
    })
  }

  // C4: same-version coalescing — active/pending HWMs stay at the bound.
  {
    const client = makeClient()
    try {
      const bufferId = client.allocateBufferId()
      await createBuffer(client, bufferId)
      const first = updateContent(client, bufferId, "let same = 1", 2)
      await first
      const bursts = [
        updateContent(client, bufferId, "let same = 2", 3),
        updateContent(client, bufferId, "let same = 3", 4),
      ]
      await Promise.all(bursts.map((p) => p.catch(() => undefined)))
      await waitForIdle(client, 5000)
      scenarios.push({
        name: "C4-coalesce-same-buffer",
        afterSettle: await freshClientResources(client, 50),
        queue: await clientQueue(client),
      })
    } finally {
      await client.destroy()
    }
  }

  return { phase: "C", scenarios }
}

async function createBuffer(client: TreeSitterClient, bufferId: number): Promise<void> {
  await client.createBufferWithHighlights(bufferId, "let base = 0", "typescript", 1, true, false)
}

function updateContent(
  client: TreeSitterClient,
  bufferId: number,
  newContent: string,
  version: number,
): Promise<unknown> {
  const old = currentBufferContent(client, bufferId)
  const edits = [fullReplaceEdit(old, newContent)]
  return client.updateBuffer(bufferId, edits, newContent, version)
}

function currentBufferContent(client: TreeSitterClient, bufferId: number): string {
  const buffers = client.getAllBuffers()
  const found = buffers.find((buffer) => buffer.id === bufferId)
  return found?.content ?? ""
}

async function waitForIdle(client: TreeSitterClient, maxMs: number): Promise<void> {
  const deadline = performance.now() + maxMs
  while (performance.now() < deadline) {
    const r = snapshotClientResources(client)
    if (r.activeJobs === 0 && r.pendingJobs === 0) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

// ---------------------------------------------------------------------------
// gate evaluation (single-arm invariants)
// ---------------------------------------------------------------------------

export interface GateResult {
  id: string
  phase: "A" | "B" | "C"
  pass: boolean
  value: string
  limit: string
  detail: string
}

const MB = 1024 * 1024

export function evaluateMemoryGates(samples: MemorySamplesByPhase): GateResult[] {
  const gates: GateResult[] = []

  // A1: heap-window drift across steady state.
  {
    const windows = samples.steady.windows
    const third = Math.max(1, Math.floor(windows.length / 3))
    const first = windows
      .slice(0, third)
      .map((w) => w.heapUsed)
      .sort((a, b) => a - b)
    const last = windows
      .slice(-third)
      .map((w) => w.heapUsed)
      .sort((a, b) => a - b)
    const medFirst = median(first)
    const medLast = median(last)
    const limit = medFirst + Math.max(0.05 * medFirst, 4 * MB)
    gates.push({
      id: "A1-heap-window-drift",
      phase: "A",
      pass: medLast <= limit,
      value: `lastThirdMedian=${medLast} B`,
      limit: `<= ${Math.round(limit)} B (firstThirdMedian=${Math.round(medFirst)} + max(5%,4MiB))`,
      detail: `windows=${windows.length}`,
    })
  }

  // A2: queue high-water marks bounded <= 1 active + 1 pending per buffer.
  {
    const q = samples.steady.queue
    const pass = q.activeHighWater <= 1 && q.pendingJobsHighWater <= 1
    gates.push({
      id: "A2-queue-HWM-1-1",
      phase: "A",
      pass,
      value: `activeHWM=${q.activeHighWater}, pendingHWM=${q.pendingJobsHighWater}`,
      limit: "active<=1 && pending<=1",
      detail: `posted=${q.posted}, completed=${q.completed}, superseded=${q.superseded}`,
    })
  }

  // A3: pending payload bytes bounded by the document window, not the update count.
  {
    const q = samples.steady.queue
    const limit = samples.steady.windowContentBytes + 128 * 1024
    gates.push({
      id: "A3-pending-bytes-bounded",
      phase: "A",
      pass: q.pendingByteHighWater <= limit,
      value: `pendingByteHWM=${q.pendingByteHighWater} B`,
      limit: `<= ${limit} B (window ${samples.steady.windowContentBytes} B + 128KiB)`,
      detail: `pendingBytes(cuml peak)=${q.pendingByteHighWater}`,
    })
  }

  // A4: queue drains to zero owners after the final settle.
  {
    const r = samples.steady.finalResources
    const pass = r.activeJobs === 0 && r.pendingJobs === 0
    gates.push({
      id: "A4-steady-drains-idle",
      phase: "A",
      pass,
      value: `active=${r.activeJobs}, pending=${r.pendingJobs}`,
      limit: "active=0 && pending=0",
      detail: `buffers=${r.buffers}, callbacks=${r.messageCallbacks}, worker=${r.hasWorker}`,
    })
  }

  // B1: native allocator returns to the warm baseline after N destroy cycles.
  {
    const s = samples.lifecycle
    const tolerance = Math.max(64, s.warmNativeActiveAllocations * 0.1)
    const limit = s.warmNativeActiveAllocations + tolerance
    gates.push({
      id: "B1-native-returns-to-warm-baseline",
      phase: "B",
      pass: s.finalNativeActiveAllocations <= limit,
      value: `final=${s.finalNativeActiveAllocations}`,
      limit: `<= ${Math.round(limit)} (warm=${s.warmNativeActiveAllocations} + max(64,10%))`,
      detail: `max=${s.maxNativeActiveAllocations}, cycles=${s.cycles}`,
    })
  }

  // B2: heap window does not grow across lifecycle cycles.
  {
    const s = samples.lifecycle
    const limit = s.warmHeapUsedMedian + Math.max(0.05 * s.warmHeapUsedMedian, 4 * MB)
    gates.push({
      id: "B2-lifecycle-heap-window",
      phase: "B",
      pass: s.finalHeapUsedMedian <= limit,
      value: `finalMedian=${Math.round(s.finalHeapUsedMedian)} B`,
      limit: `<= ${Math.round(limit)} B (warm=${Math.round(s.warmHeapUsedMedian)})`,
      detail: `cycles=${s.cycles}`,
    })
  }

  // B3: after full destroy all owned resources are released.
  {
    const r = samples.lifecycle.lastClientResources
    const pass =
      r.activeJobs === 0 && r.pendingJobs === 0 && r.buffers === 0 && r.messageCallbacks === 0 && !r.hasWorker
    gates.push({
      id: "B3-lifecycle-owners-released",
      phase: "B",
      pass,
      value: `active=${r.activeJobs}, pending=${r.pendingJobs}, buffers=${r.buffers}, callbacks=${r.messageCallbacks}, worker=${r.hasWorker}`,
      limit: "active=0 && pending=0 && buffers=0 && callbacks=0 && !worker",
      detail: "terminal client after destroy()",
    })
  }

  // C-gates: every fault scenario must drain to zero active/pending and respect the HWM bound.
  {
    for (const scenario of samples.faults.scenarios) {
      const drained = scenario.afterSettle.activeJobs === 0 && scenario.afterSettle.pendingJobs === 0
      const bounded = scenario.queue.activeHighWater <= 1 && scenario.queue.pendingJobsHighWater <= 1
      gates.push({
        id: `C-${scenario.name}`,
        phase: "C",
        pass: drained && bounded,
        value: `active=${scenario.afterSettle.activeJobs}, pending=${scenario.afterSettle.pendingJobs}, hwm=${scenario.queue.activeHighWater}/${scenario.queue.pendingJobsHighWater}`,
        limit: "active=0 && pending=0 && activeHWM<=1 && pendingHWM<=1",
        detail: `callbacks=${scenario.afterSettle.messageCallbacks}, worker=${scenario.afterSettle.hasWorker}`,
      })
    }
  }

  return gates
}

export function overallVerdict(gates: GateResult[]): "PASS" | "FAIL" | "UNCLEAR" {
  if (gates.length === 0) return "UNCLEAR"
  return gates.every((gate) => gate.pass) ? "PASS" : "FAIL"
}
