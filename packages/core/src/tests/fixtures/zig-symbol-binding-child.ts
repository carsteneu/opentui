// Wave-5 staged-binding child fixture (tests #2-#4). Each mode runs in a fresh
// process so the module-level render-library singleton stays isolated. Uses
// the SRC-native passed as --native-path (the sandbox has no resolvable
// @opentui/core-linux-x64 link, so the node_modules default path is unusable).
import { dlopen } from "bun:ffi"
import { getTelemetrySnapshot, setTelemetryEnabled } from "../../telemetry.js"

type LibWithSymbols = {
  opentui: {
    symbols: Record<string, (...args: any[]) => any>
    close(): void
    __opentuiWave5StagedControl?: { scheduleFullBind(): void; markClosed(): void }
  }
  dispose(): void
}

type Result = Record<string, unknown>

function result(payload: Result): void {
  console.log(`__RESULT__${JSON.stringify(payload)}`)
}

function markNames(): string[] {
  return getTelemetrySnapshot().marks.map((m) => m.name)
}

async function main(): Promise<void> {
  setTelemetryEnabled(true)
  const mode = process.argv[2]
  const libPath = process.argv[3]
  const { setRenderLibPath, resolveRenderLib } = await import("../../zig.js")
  setRenderLibPath(libPath)

  if (mode === "trap") {
    const symbols = (resolveRenderLib() as unknown as LibWithSymbols).opentui.symbols
    const trapped = symbols.yogaSetMeasureCallback
    const cached = symbols.yogaSetMeasureCallback
    // Eager reference: direct single-symbol dlopen of the same native; both
    // must produce the same observable call result.
    const eager = dlopen(libPath, { yogaSetMeasureCallback: { args: ["ptr"], returns: "void" } }).symbols
      .yogaSetMeasureCallback
    let trappedResult: unknown = "no-call"
    let eagerResult: unknown = "no-call"
    let trappedThrew = ""
    let eagerThrew = ""
    try {
      trappedResult = (trapped as (...args: any[]) => unknown)(null)
    } catch (error) {
      trappedThrew = error instanceof Error ? error.message : String(error)
    }
    try {
      eagerResult = (eager as (...args: any[]) => unknown)(null)
    } catch (error) {
      eagerThrew = error instanceof Error ? error.message : String(error)
    }
    const marks = markNames()
    result({
      trappedType: typeof trapped,
      cachedIdentity: trapped === cached,
      trappedResult: typeof trappedResult,
      eagerResult: typeof eagerResult,
      trappedThrew,
      eagerThrew,
      resultEqual: typeof trappedResult === typeof eagerResult,
      deferredMarked: marks.includes("opentui.deferredBound.yogaSetMeasureCallback"),
    })
    return
  }

  if (mode === "fullbind") {
    const lib = resolveRenderLib() as unknown as LibWithSymbols
    const symbols = lib.opentui.symbols
    const control = lib.opentui.__opentuiWave5StagedControl
    const f1 = symbols.yogaSetMeasureCallback
    control?.scheduleFullBind()
    await new Promise<void>((resolveCallback) => setTimeout(resolveCallback, 200))
    const marks = markNames()
    result({
      boundViaTrap:
        typeof f1 === "function" && markNames().some((n) => n === "opentui.deferredBound.yogaSetMeasureCallback"),
      fullBoundMarked: marks.includes("opentui.fullBound"),
      sameIdentityAfterFullBind: symbols.yogaSetMeasureCallback === f1,
      neverAccessedIsFunction: typeof symbols.setDebugOverlay === "function",
      neverAccessedTrapped: marks.some((n) => n === "opentui.deferredBound.setDebugOverlay"),
      fullyBoundStillFunctional: typeof symbols.yogaSetDirtiedCallback === "function",
    })
    return
  }

  if (mode === "dispose") {
    const lib = resolveRenderLib() as unknown as LibWithSymbols
    const symbols = lib.opentui.symbols
    let libraryCloseCalls = 0
    const originalClose = lib.opentui.close
    lib.opentui.close = () => {
      libraryCloseCalls++
      originalClose()
    }
    let eventSinkDestroyCalls = 0
    const originalDestroyEventSink = symbols.destroyEventSink
    symbols.destroyEventSink = (...args) => {
      eventSinkDestroyCalls++
      originalDestroyEventSink(...args)
    }
    // Pre-dispose deferred access must resolve lazily.
    const preDispose = symbols.yogaSetDirtiedCallback
    let firstOk = true
    let secondOk = true
    try {
      lib.dispose()
    } catch {
      firstOk = false
    }
    try {
      lib.dispose()
    } catch {
      secondOk = false
    }
    const alreadyBoundAfterClose = symbols.yogaSetDirtiedCallback === preDispose
    // A never-bound deferred key after close must NOT trigger a new dlopen.
    const afterCloseUnbound = symbols.setDebugOverlay
    const marks = markNames()
    result({
      firstOk,
      secondOk,
      libraryCloseCalls,
      eventSinkDestroyCalls,
      preDisposeDeferred: typeof preDispose === "function",
      alreadyBoundAfterClose,
      afterCloseUnbound: typeof afterCloseUnbound,
      noPostCloseTrap: !marks.some((n) => n === "opentui.deferredBound.setDebugOverlay"),
    })
    return
  }

  throw new Error(`unknown mode ${mode}`)
}

main().catch((error) => {
  console.error("wave5 staged-binding child failed:", error)
  process.exitCode = 1
})
