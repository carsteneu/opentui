// Wave-5 staged FFI binding tests.
//
// #1  CORE-set completeness: the exported `opentuiCoreSymbols` must cover
//     every symbol the ctor + first native frame touch, as traced by the
//     committed M1 instrumented startup run. RED while CORE is empty.
// #2  Deferred trap-miss must bind a symbol lazily with a stable identity and
//     an observable call result identical to an eager bind (child process).
// #3  After the first native commit the background full-bind must complete so
//     never-accessed deferred symbols resolve without a trap, while already
//     trapped symbols keep their identity (child process).
// #4  dispose/destroy stays idempotent with the staged proxy: one close, one
//     event-sink destroy, no lazy dlopen after close (child process).
import { describe, expect, test } from "bun:test"
import { readFileSync, readdirSync, existsSync } from "node:fs"
import { join } from "node:path"
import { opentuiCoreSymbols } from "../zig-symbol-stage.js"

const PACKAGE_ROOT = join(import.meta.dir, "..", "..")
const BENCH_DIR = join(PACKAGE_ROOT, ".yesmem", "bench")
const FIXTURES_DIR = join(import.meta.dir, "fixtures")

describe("wave5 staged binding", () => {
  test("#1 CORE set covers the committed first-frame + streaming access traces", () => {
    const readTrace = (file: string, preCommitOnly = false) =>
      JSON.parse(readFileSync(join(BENCH_DIR, file), "utf8")) as {
        firstNativeCommitAtMs?: number
        accesses: Array<{ name: string; atMs: number }>
      }
    // TextRenderable start: only the pre-first-native-commit accesses.
    const textTrace = readTrace("wave5-symbol-access-trace.json")
    // CodeRenderable cold-1000 + warm-1000-append100: the full cold scenario
    // through the measured styled commit. Symbols the primary workload uses
    // between the first native commit and the background full-bind pay a
    // per-access trap-miss dlopen (wave5-cpu-gate finding), so the whole
    // streaming working set must be eager CORE, not just the pre-commit slice.
    const streamTrace = readTrace("wave5-symbol-access-trace-stream.json")
    const streamWarmTrace = readTrace("wave5-symbol-access-trace-stream-warm.json")

    const tracedNeeded = new Set<string>([
      ...textTrace.accesses.filter((a) => a.atMs <= (textTrace.firstNativeCommitAtMs ?? Infinity)).map((a) => a.name),
      ...streamTrace.accesses.map((a) => a.name),
      ...streamWarmTrace.accesses.map((a) => a.name),
    ])

    expect(opentuiCoreSymbols.length).toBeGreaterThan(0)
    const missing = [...tracedNeeded].filter((name) => !opentuiCoreSymbols.includes(name as never))
    expect(missing).toEqual([])
    // Escalation threshold from the plan: CORE must stay bounded so the eager
    // dlopen does not reintroduce the pre-split startup cost.
    expect(opentuiCoreSymbols.length).toBeLessThanOrEqual(120)
  }, 20_000)

  const nativeLib = findNativeLibrary()
  const requiresNative = {
    skip: !nativeLib,
    reason: "no SRC-native libopentui.so found under packages/core/src/zig/lib",
  }

  test(
    "#2 deferred trap-miss binds lazily with eager-equivalent results",
    { skip: requiresNative },
    async () => {
      const out = await runChild("trap", nativeLib!)
      expect(out.trappedType).toBe("function")
      expect(out.cachedIdentity).toBe(true)
      expect(out.trappedThrew).toBe("")
      expect(out.eagerThrew).toBe("")
      expect(out.resultEqual).toBe(true)
      expect(out.deferredMarked).toBe(true)
    },
    30_000,
  )

  test(
    "#3 background full-bind completes and keeps trapped identity",
    { skip: requiresNative },
    async () => {
      const out = await runChild("fullbind", nativeLib!)
      expect(out.boundViaTrap).toBe(true)
      expect(out.fullBoundMarked).toBe(true)
      expect(out.sameIdentityAfterFullBind).toBe(true)
      expect(out.neverAccessedIsFunction).toBe(true)
      expect(out.neverAccessedTrapped).toBe(false)
      expect(out.fullyBoundStillFunctional).toBe(true)
      expect(out.trappedCallableAfterFullBind).toBe(true)
      expect(out.trappedCallThrew).toBe("")
    },
    30_000,
  )

  test(
    "#5 post-full-bind proxy is pass-through (no per-call overhead)",
    { skip: requiresNative },
    async () => {
      const out = await runChild("perf", nativeLib!)
      expect(out.overheadNsPerCall as number).toBeGreaterThan(-5)
      expect(out.overheadNsPerCall as number).toBeLessThan(500)
    },
    30_000,
  )

  test(
    "#4 dispose/destroy is idempotent and close blocks further lazy bind",
    { skip: requiresNative },
    async () => {
      const out = await runChild("dispose", nativeLib!)
      expect(out.firstOk).toBe(true)
      expect(out.secondOk).toBe(true)
      expect(out.libraryCloseCalls).toBe(1)
      expect(out.eventSinkDestroyCalls).toBe(1)
      expect(out.preDisposeDeferred).toBe(true)
      expect(out.alreadyBoundAfterClose).toBe(true)
      expect(out.afterCloseUnbound).toBe("undefined")
      expect(out.noPostCloseTrap).toBe(true)
    },
    30_000,
  )
})

function findNativeLibrary(): string | null {
  const libRoot = join(PACKAGE_ROOT, "src", "zig", "lib")
  if (!existsSync(libRoot)) return null
  for (const entry of readdirSync(libRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.includes("darwin") || entry.name.includes("win32")) continue
    const candidate = join(libRoot, entry.name, "libopentui.so")
    if (existsSync(candidate)) return candidate
  }
  return null
}

async function runChild(mode: string, libPath: string): Promise<Record<string, unknown>> {
  const { spawn } = await import("node:child_process")
  const fixture = join(FIXTURES_DIR, "zig-symbol-binding-child.ts")
  const outcome = await new Promise<{ code: number | null; stdout: string; stderr: string }>((done) => {
    const executed = spawn(process.execPath, ["run", fixture, mode, libPath], {
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    executed.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()))
    executed.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()))
    executed.on("error", (error: Error) => done({ code: -1, stdout, stderr: String(error) }))
    executed.on("exit", (code: number | null) => done({ code, stdout, stderr }))
  })
  if (outcome.code !== 0) {
    throw new Error(`wave5 child (mode=${mode}) exited ${outcome.code}: ${outcome.stderr.slice(-500)}`)
  }
  const line = outcome.stdout.split("\n").find((l) => l.startsWith("__RESULT__"))
  if (!line) {
    throw new Error(
      `wave5 child (mode=${mode}) produced no result line: ${outcome.stdout.slice(-500)} ${outcome.stderr.slice(-500)}`,
    )
  }
  return JSON.parse(line.slice("__RESULT__".length)) as Record<string, unknown>
}
