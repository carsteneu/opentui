import { CliRenderEvents, type CliRenderer } from "./renderer.js"

/**
 * Defined failure for a readiness waiter when the renderer hits an early render
 * error before its first frame is committed. Carries the underlying error.
 */
export class RendererReadyError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = "RendererReadyError"
  }
}

/**
 * Defined failure for a readiness waiter when the renderer is destroyed before
 * its first frame is committed.
 */
export class RendererReadyDestroyedError extends RendererReadyError {
  constructor() {
    super("renderer destroyed before first frame committed")
    this.name = "RendererReadyDestroyedError"
  }
}

export type RendererReadyEnhancedStage = "pending" | "ok" | "failed"

export interface RendererReadyEnhancedOutcome {
  ok: boolean
  error?: unknown
}

export interface RendererReadyState {
  /** Runtime/modules usable (the renderer was constructed). */
  core: boolean
  /** The first successful native commit happened. */
  firstFrameCommitted: boolean
  /** Consumer-driven: optional extensions finished or controlled-failed. */
  enhanced: RendererReadyEnhancedStage
  /** Consumer declared the whole startup sequence complete. */
  applicationReady: boolean
  destroyed: boolean
}

export interface RendererReadyHandle {
  /** Resolves immediately: core modules/runtime are usable. */
  readonly coreReady: Promise<void>
  /** Resolves once the first successful native commit happened. */
  readonly firstFrameCommitted: Promise<void>
  /** Consumer marks its defined-optional extensions complete. */
  markEnhancedReady(): void
  /** Consumer marks its defined-optional extensions as controlled-failed. */
  markEnhancedFailed(error?: unknown): void
  /** Resolves when enhanced work settled; rejected on early error/destroy. */
  readonly enhancedSettled: Promise<RendererReadyEnhancedOutcome>
  /** Consumer declares its entire startup sequence complete. */
  markApplicationReady(): void
  /** Resolves once the consumer declared application ready (gated on base frame). */
  readonly applicationReady: Promise<void>
  readonly state: RendererReadyState
  readonly destroyed: boolean
  /** Idempotent: ends all outstanding waiters and detaches all listeners. */
  destroy(): void
}

interface Deferred<T> {
  promise: Promise<T>
  readonly settled: boolean
  settle: (kind: "resolve" | "reject", value: T, reason: unknown) => boolean
}

function deferred<T>(): Deferred<T> {
  let settled = false
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  // A consumer may only await a subset of the milestones (e.g. only
  // firstFrame). Without this, rejecting an unwatched milestone on destroy or
  // an early render error would surface as an unhandled rejection. Consumers
  // that explicitly await a rejected milestone still observe it via .then's
  // rejection handler.
  promise.catch(() => {})
  return {
    promise,
    get settled() {
      return settled
    },
    settle(kind, value, reason) {
      if (settled) return false
      settled = true
      if (kind === "resolve") resolve(value)
      else reject(reason)
      return true
    },
  }
}

/**
 * Small additive readiness contract layered on the existing renderer seams
 * (`FRAME`, `RENDER_ERROR`, `DESTROY`). It does not add a second lifecycle
 * state machine: it only lets a consumer observe the first native commit and
 * mark the two consumer-owned milestones (enhanced / application ready).
 *
 * - `firstFrameCommitted` resolves on the first real successful commit and is
 *   unaffected by enhanced/application state.
 * - `enhanced` / `application` are gated on the base frame and marked by the
 *   consumer; OpenTUI never guesses which tools an app has.
 * - Every milestone resolves at most once; waiters always settle (success,
 *   defined error, or destroy) so nothing hangs open.
 */
export function createRendererReady(renderer: CliRenderer): RendererReadyHandle {
  const firstFrame = deferred<void>()
  const enhanced = deferred<RendererReadyEnhancedOutcome>()
  const application = deferred<void>()

  const state: RendererReadyState = {
    core: true,
    firstFrameCommitted: false,
    enhanced: "pending",
    applicationReady: false,
    destroyed: false,
  }

  let markedEnhanced = false
  let enhancedStage: RendererReadyEnhancedStage = "pending"
  let enhancedError: unknown
  let markedApplication = false

  function detach(): void {
    renderer.off(CliRenderEvents.FRAME, onFrame)
    renderer.off(CliRenderEvents.RENDER_ERROR, onRenderError)
    renderer.off(CliRenderEvents.DESTROY, onDestroy)
  }

  // Enhanced/application may only settle after the base frame is committed.
  function releaseGated(): void {
    if (!firstFrame.settled) return
    if (markedEnhanced) {
      if (enhanced.settle("resolve", { ok: enhancedStage === "ok", error: enhancedError }, undefined)) {
        state.enhanced = enhancedStage
      }
    }
    if (markedApplication) {
      if (application.settle("resolve", undefined, undefined)) {
        state.applicationReady = true
      }
    }
  }

  // A first-frame failure (early render error or destroy) settles every waiter
  // that is still open; no promise is left hanging.
  function failStartup(reason: unknown): void {
    detach()
    firstFrame.settle("reject", undefined, reason)
    enhanced.settle("reject", undefined, reason)
    application.settle("reject", undefined, reason)
  }

  function onFrame(): void {
    if (state.destroyed) return
    state.firstFrameCommitted = true
    // Only the first commit is awaited; stop observing further frames.
    renderer.off(CliRenderEvents.FRAME, onFrame)
    firstFrame.settle("resolve", undefined, undefined)
    releaseGated()
  }

  function onRenderError(event: { error: Error }): void {
    const reason = new RendererReadyError(event.error.message, { cause: event.error })
    failStartup(reason)
  }

  function onDestroy(): void {
    state.destroyed = true
    failStartup(new RendererReadyDestroyedError())
  }

  renderer.on(CliRenderEvents.FRAME, onFrame)
  renderer.on(CliRenderEvents.RENDER_ERROR, onRenderError)
  renderer.on(CliRenderEvents.DESTROY, onDestroy)

  return {
    coreReady: Promise.resolve(),
    firstFrameCommitted: firstFrame.promise,
    markEnhancedReady() {
      if (state.destroyed || enhancedStage !== "pending") return
      enhancedStage = "ok"
      markedEnhanced = true
      releaseGated()
    },
    markEnhancedFailed(error?: unknown) {
      if (state.destroyed || enhancedStage !== "pending") return
      enhancedStage = "failed"
      enhancedError = error
      markedEnhanced = true
      releaseGated()
    },
    enhancedSettled: enhanced.promise,
    markApplicationReady() {
      if (state.destroyed || markedApplication) return
      markedApplication = true
      releaseGated()
    },
    applicationReady: application.promise,
    state,
    get destroyed() {
      return state.destroyed
    },
    destroy() {
      if (state.destroyed) return
      state.destroyed = true
      failStartup(new RendererReadyDestroyedError())
    },
  }
}
