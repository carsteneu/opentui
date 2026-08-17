// Child-process fixture for zig lazy-FFI tests. Each mode runs in a fresh
// process so module-level FFIRenderLib state never leaks between test cases.
import { getTelemetrySnapshot, setTelemetryEnabled } from "../../telemetry.js"
import type { RenderLib } from "../../zig.js"

const MARK = "opentui.nativeLoaded"

function result(payload: Record<string, unknown>): void {
  console.log(`__RESULT__${JSON.stringify(payload)}`)
}

async function main(): Promise<void> {
  // Enable telemetry before zig.ts evaluates so module-scope FFIRenderLib
  // construction would record opentui.nativeLoaded.
  setTelemetryEnabled(true)
  const mode = process.argv[2] ?? "import-only"

  const { resolveRenderLib, setRenderLibPath } = await import("../../zig.js")

  if (mode === "import-only") {
    const marks = getTelemetrySnapshot().marks.map((m) => m.name)
    result({ marks })
    return
  }

  if (mode === "resolve") {
    const first = resolveRenderLib()
    const second = resolveRenderLib()
    const marks = getTelemetrySnapshot().marks.filter((m) => m.name === MARK)
    result({ same: first === second, nativeLoaded: marks.length })
    return
  }

  if (mode === "path-order") {
    const libPath = process.argv[3]
    let beforeOk = false
    let resolveOk = false
    let afterThrew: string | null = null
    try {
      setRenderLibPath(libPath)
      beforeOk = true
    } catch (err) {
      afterThrew = err instanceof Error ? err.message : String(err)
    }
    if (beforeOk) {
      try {
        resolveRenderLib()
        resolveOk = true
      } catch (err) {
        afterThrew = err instanceof Error ? err.message : String(err)
      }
    }
    if (resolveOk) {
      // Must throw after the first resolve, even for a different path.
      try {
        setRenderLibPath(`${libPath}.other`)
      } catch (err) {
        afterThrew = err instanceof Error ? err.message : String(err)
      }
    }
    result({ beforeOk, resolveOk, afterThrew })
    return
  }

  if (mode === "resolve-error") {
    const first = tryResolve(resolveRenderLib)
    const second = tryResolve(resolveRenderLib)
    const marks = getTelemetrySnapshot().marks.filter((m) => m.name === MARK)
    result({ firstError: first, secondError: second, nativeLoaded: marks.length })
    return
  }

  if (mode === "dispose-twice") {
    let firstOk = false
    let secondOk = false
    // RenderLib's public surface does not expose dispose(); the concrete
    // FFIRenderLib does. Cast to match existing test usage.
    const lib = resolveRenderLib() as RenderLib & { dispose(): void }
    try {
      lib.dispose()
      firstOk = true
    } catch (err) {
      result({ firstOk, secondOk, error: err instanceof Error ? err.message : String(err) })
      return
    }
    try {
      lib.dispose()
      secondOk = true
    } catch (err) {
      result({ firstOk, secondOk, error: err instanceof Error ? err.message : String(err) })
      return
    }
    result({ firstOk, secondOk })
    return
  }

  result({ error: `unknown mode ${mode}` })
}

function tryResolve(resolve: typeof import("../../zig.js").resolveRenderLib): string {
  try {
    resolve()
    return ""
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

main().catch((err) => {
  result({ error: `CHILD_FATAL ${err instanceof Error ? err.message : String(err)}` })
  process.exit(1)
})
