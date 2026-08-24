// Wave-3 Loop D: opt-in scaling counter definitions (§10.3/§10.4).
//
// Kept OUT of the root export barrel (index.ts does `export * from
// Renderable.js`, so exporting these from Renderable would change the public
// root-export surface — an invariant other loops' tests assert). Loop D is
// attribution-only; these counters leave production policy untouched.

/**
 * Optional, opt-in scaling instrument (Wave-3 Loop D). Every field is an
 * event counter that production code only touches through a null-guard, so the
 * off-state is a cheap boolean check with zero clock/array/string allocation.
 * Attached by renderers/benchmarks that need layout/partial attribution.
 */
export interface Wave3ScalingCounters {
  // Layout traversal (§10.3)
  visitedStableNodes: number
  updateFromLayoutFfiCalls: number
  layoutGenerations: number
  dirtySubtreeLayouts: number
  renderListRebuilds: number
  renderListReuses: number
  renderCommands: number
  frameCounts: { full: number; partial: number; followup: number }
  // Partial composition (§10.4)
  hasSafePartialCompositionCalls: number
  scannedLaterPainters: number
  boundsWalks: number
  partialAccepted: number
  partialRejectedBy: Record<string, number>
  partialToFullPromotions: number
  partialRegionAreas: number
  // Disjoint timing spans (ms sums; recorded only when attached)
  layoutMs: number
  jsRenderMs: number
  commitMs: number
}

/** Renderer surfaces the counters as an optional field, read through this cast. */
export interface ScalingCounterHost {
  scalingCounters?: Wave3ScalingCounters | null
}

export function createWave3ScalingCounters(): Wave3ScalingCounters {
  return {
    visitedStableNodes: 0,
    updateFromLayoutFfiCalls: 0,
    layoutGenerations: 0,
    dirtySubtreeLayouts: 0,
    renderListRebuilds: 0,
    renderListReuses: 0,
    renderCommands: 0,
    frameCounts: { full: 0, partial: 0, followup: 0 },
    hasSafePartialCompositionCalls: 0,
    scannedLaterPainters: 0,
    boundsWalks: 0,
    partialAccepted: 0,
    partialRejectedBy: {},
    partialToFullPromotions: 0,
    partialRegionAreas: 0,
    layoutMs: 0,
    jsRenderMs: 0,
    commitMs: 0,
  }
}
