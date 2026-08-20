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
    __opentuiWave5StagedControl?: { scheduleFullBind(): void }
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

// A symbol that stays DEFERRED under the current CORE set (not in
// opentuiCoreSymbols): no args, void return, so both the trapped wrapper and a
// direct eager dlopen can be invoked safely with an identical observable
// result.
const DEFERRED_TRAP = "imageTestFailIccProfileCopyAllocationOnce"
const DEFERRED_TRAP_DEF = { args: [] as string[], returns: "void" }

async function main(): Promise<void> {
  setTelemetryEnabled(true)
  const mode = process.argv[2]
  const libPath = process.argv[3]
  const { setRenderLibPath, resolveRenderLib } = await import("../../zig.js")
  setRenderLibPath(libPath)

  if (mode === "trap") {
    const symbols = (resolveRenderLib() as unknown as LibWithSymbols).opentui.symbols
    const trapped = symbols[DEFERRED_TRAP]
    const cached = symbols[DEFERRED_TRAP]
    // Eager reference: direct single-symbol dlopen of the same native; both
    // must produce the same observable call result.
    const eager = dlopen(libPath, { [DEFERRED_TRAP]: DEFERRED_TRAP_DEF }).symbols[DEFERRED_TRAP]
    let trappedResult: unknown = "no-call"
    let eagerResult: unknown = "no-call"
    let trappedThrew = ""
    let eagerThrew = ""
    try {
      trappedResult = (trapped as (...args: any[]) => unknown)()
    } catch (error) {
      trappedThrew = error instanceof Error ? error.message : String(error)
    }
    try {
      eagerResult = (eager as (...args: any[]) => unknown)()
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
      deferredMarked: marks.includes(`opentui.deferredBound.${DEFERRED_TRAP}`),
    })
    return
  }

  if (mode === "fullbind") {
    const lib = resolveRenderLib() as unknown as LibWithSymbols
    const symbols = lib.opentui.symbols
    const control = lib.opentui.__opentuiWave5StagedControl
    const f1 = symbols[DEFERRED_TRAP]
    control?.scheduleFullBind()
    await new Promise<void>((resolveCallback) => setTimeout(resolveCallback, 200))
    const marks = markNames()
    // The trap-bound wrapper must stay CALLABLE after the full-bind ran (its
    // dlopen handle is kept open until library close; closing it would SIGILL).
    let trappedCallThrew = ""
    let trappedCallResult: unknown = "no-call"
    try {
      trappedCallResult = (f1 as (...args: any[]) => unknown)()
    } catch (error) {
      trappedCallThrew = error instanceof Error ? error.message : String(error)
    }
    result({
      boundViaTrap: typeof f1 === "function" && markNames().some((n) => n === `opentui.deferredBound.${DEFERRED_TRAP}`),
      fullBoundMarked: marks.includes("opentui.fullBound"),
      sameIdentityAfterFullBind: symbols[DEFERRED_TRAP] === f1,
      neverAccessedIsFunction: typeof symbols.setDebugOverlay === "function",
      neverAccessedTrapped: marks.some((n) => n === "opentui.deferredBound.setDebugOverlay"),
      fullyBoundStillFunctional: typeof symbols.yogaSetDirtiedCallback === "function",
      trappedCallableAfterFullBind: trappedCallThrew === "" && typeof trappedCallResult === "undefined",
      trappedCallThrew,
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
    const preDispose = symbols[DEFERRED_TRAP]
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
    const alreadyBoundAfterClose = symbols[DEFERRED_TRAP] === preDispose
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

  if (mode === "perf") {
    // Post-full-bind hot-path overhead: the proxy degenerate to a plain
    // property lookup, measured PER ACCESS by resolving the symbol inside the
    // timed loop, so the proxy's get trap participates in every iteration.
    const lib = resolveRenderLib() as unknown as LibWithSymbols
    const symbols = lib.opentui.symbols
    lib.opentui.__opentuiWave5StagedControl?.scheduleFullBind()
    await new Promise<void>((resolveCallback) => setTimeout(resolveCallback, 200))
    if (!markNames().includes("opentui.fullBound")) throw new Error("fullBind did not complete in perf mode")
    const n = 200_000
    const eager = dlopen(libPath, { yogaSetMeasureCallback: { args: ["ptr"], returns: "void" } }).symbols
      .yogaSetMeasureCallback as (...args: any[]) => unknown
    // warm (proxy per-access path + direct baseline)
    for (let k = 0; k < 1_000; k++) (symbols.yogaSetMeasureCallback as (...args: any[]) => unknown)(null)
    for (let k = 0; k < 1_000; k++) eager(null)
    const t0 = performance.now()
    for (let k = 0; k < n; k++) (symbols.yogaSetMeasureCallback as (...args: any[]) => unknown)(null)
    const t1 = performance.now()
    for (let k = 0; k < n; k++) eager(null)
    const t2 = performance.now()
    result({
      proxyNsPerCall: ((t1 - t0) / n) * 1e6,
      directNsPerCall: ((t2 - t1) / n) * 1e6,
      overheadNsPerCall: ((t1 - t0 - (t2 - t1)) / n) * 1e6,
    })
    return
  }

  throw new Error(`unknown mode ${mode}`)
}

main().catch((error) => {
  console.error("wave5 staged-binding child failed:", error)
  process.exitCode = 1
})
