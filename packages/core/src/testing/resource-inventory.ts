// Candidate-only Wave-3 memory-gate resource inventory.
//
// Reads the TreeSitterClient's LIVE owner state from internal fields via a typed
// cast. This is a test/benchmark-only seam: it makes no production change and is
// NOT a public API. It depends on the Wave-3 latest-wins queue shape
// (works: Map<number, {active?, pending?}>) and therefore must NOT be imported by
// any harness that also runs on the baseline fccae215 arm (which lacks it).

import type { TreeSitterClient } from "../lib/tree-sitter/client.js"

interface BufferWorksInternal {
  active?: unknown
  pending?: unknown
}

interface TreeSitterClientInternal {
  buffers: Map<number, unknown>
  works: Map<number, BufferWorksInternal>
  messageCallbacks: Map<string, unknown>
  destroyCallbacks: Set<() => void>
  worker: { terminate: () => void } | undefined
}

export interface ClientResourceSnapshot {
  buffers: number
  activeJobs: number
  pendingJobs: number
  messageCallbacks: number
  destroyCallbacks: number
  hasWorker: boolean
}

/** Live owner counts from the client's internal state. Candidate arm only. */
export function snapshotClientResources(client: TreeSitterClient): ClientResourceSnapshot {
  const internal = client as unknown as TreeSitterClientInternal
  let activeJobs = 0
  let pendingJobs = 0
  for (const works of internal.works.values()) {
    if (works.active) activeJobs += 1
    if (works.pending) pendingJobs += 1
  }
  return {
    buffers: internal.buffers.size,
    activeJobs,
    pendingJobs,
    messageCallbacks: internal.messageCallbacks.size,
    destroyCallbacks: internal.destroyCallbacks.size,
    hasWorker: internal.worker !== undefined,
  }
}
