import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { join } from "node:path"

// Lazy FFI-load tests (Wave 2 Loop A, checkpoint A1/B3). Each case runs in a
// fresh child process so module-level FFIRenderLib singleton state stays
// isolated — importing zig.ts must construct no native library, and the first
// real resolveRenderLib() constructs exactly one.
const PKG = join(import.meta.dir, "..", "..")
const ASSET_ROOT = join(PKG, ".yesmem", "native-assets")
const CHILD = join(import.meta.dir, "fixtures", "lazy-ffi-child.ts")
const REAL_LIB = join(ASSET_ROOT, "@opentui/core-linux-x64", "libopentui.so")

type ChildResult = Record<string, unknown>

function runChild(mode: string, env: Record<string, string> = {}, libPath?: string): ChildResult {
  const args = [CHILD, mode]
  if (libPath) args.push(libPath)
  const res = spawnSync(process.execPath, args, {
    cwd: PKG,
    env: { ...process.env, OTUI_ASSET_ROOT: ASSET_ROOT, ...env },
    encoding: "utf8",
    timeout: 30_000,
  })
  const stdout = (res.stdout ?? "") as string
  const line = stdout.split("\n").find((l) => l.startsWith("__RESULT__"))
  if (!line) {
    throw new Error(`child produced no result (code=${res.status}): ${res.stderr}`)
  }
  return JSON.parse(line.slice("__RESULT__".length)) as ChildResult
}

// Points OTUI_ASSET_ROOT at an empty dir so module-scope native path
// resolution fails and resolveRenderLib() throws before any FFIRenderLib is
// constructed.
function tempEmptyRoot(): string {
  const dir = join(Bun.env.TMPDIR ?? "/tmp", `opentui-lazy-empty-${process.pid}`)
  const { mkdirSync, rmSync } = require("node:fs") as typeof import("node:fs")
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  return dir
}

describe("zig eager FFI load removal", () => {
  test("importing zig.ts constructs no FFIRenderLib / no native load", () => {
    const r = runChild("import-only")
    const marks = (r.marks as string[]) ?? []
    expect(marks).not.toContain("opentui.nativeLoaded")
  })

  test("first resolve constructs the marker exactly once", () => {
    const r = runChild("resolve")
    expect(r.nativeLoaded).toBe(1)
  })

  test("consecutive resolves return the same object identity", () => {
    const r = runChild("resolve")
    expect(r.same).toBe(true)
  })

  test("setRenderLibPath works before resolve and throws after", () => {
    const r = runChild("path-order", {}, REAL_LIB)
    expect(r.beforeOk).toBe(true)
    expect(r.resolveOk).toBe(true)
    expect(String(r.afterThrew)).toContain("must be called before resolveRenderLib")
  })

  test("resolve error leaves no half-initialized singleton; follow-up is deterministic", () => {
    const empty = tempEmptyRoot()
    try {
      const r = runChild("resolve-error", { OTUI_ASSET_ROOT: empty })
      const first = String(r.firstError)
      const second = String(r.secondError)
      expect(first).not.toBe("")
      expect(second).toBe(first)
      expect(r.nativeLoaded).toBe(0)
    } finally {
      const { rmSync } = require("node:fs") as typeof import("node:fs")
      rmSync(empty, { recursive: true, force: true })
    }
  })

  test("disposal does not double-call native free / callback disposal", () => {
    const r = runChild("dispose-twice")
    expect(r.firstOk).toBe(true)
    expect(r.secondOk).toBe(true)
  })
})
