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
import { opentuiCoreSymbols } from "../zig.js"

const PACKAGE_ROOT = join(import.meta.dir, "..", "..")
const BENCH_DIR = join(PACKAGE_ROOT, ".yesmem", "bench")
const FIXTURES_DIR = join(import.meta.dir, "fixtures")

describe("wave5 staged binding", () => {
  test("#1 CORE set covers the committed first-frame access trace", () => {
    const trace = JSON.parse(readFileSync(join(BENCH_DIR, "wave5-symbol-access-trace.json"), "utf8")) as {
      firstNativeCommitAtMs: number
      accesses: Array<{ name: string; atMs: number }>
    }
    const tracedBeforeCommit = new Set(
      trace.accesses.filter((a) => a.atMs <= trace.firstNativeCommitAtMs).map((a) => a.name),
    )

    expect(opentuiCoreSymbols.length).toBeGreaterThan(0)
    const missing = [...tracedBeforeCommit].filter((name) => !opentuiCoreSymbols.includes(name as never))
    expect(missing).toEqual([])
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
