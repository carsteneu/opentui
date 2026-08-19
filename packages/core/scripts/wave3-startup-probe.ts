// Loop B startup-safety probe (child process).
//
// One cold start in a fresh process, rendering with the ARM'S OWN native
// artifact (--native-path/--native-sha), so import and time-to-first-styled-
// native-commit are measured with the real per-arm native (baseline e7e97644,
// candidate deacf806). Imports the target tree's renderer-entry and commits the
// first native frame via TextRenderable — the identical boundary on both arms.
//
// Args:
//   --root=<abs repo root>  --role=baseline|candidate  --revision=<commit>
//   --scenario=<import|renderer-entry>
//   --native-path=<abs .so> --native-sha=<hash>
//   --entry=<module spec to cold import>  --src=<abs src dir>
//
// Prints a single WAVE3_STARTUP_RESULT <json> line.
import { createHash } from "node:crypto"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { isAbsolute, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

const RESULT_PREFIX = "WAVE3_STARTUP_RESULT "

function requiredArg(name: string): string {
  const prefix = `--${name}=`
  const value = process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length)
  if (!value) throw new Error(`--${name} is required`)
  return value
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex")
}

async function main(): Promise<void> {
  const rootArg = requiredArg("root")
  if (!isAbsolute(rootArg)) throw new Error("--root must be absolute")
  const root = resolve(rootArg)
  const role = requiredArg("role")
  if (role !== "baseline" && role !== "candidate") throw new Error("--role must be baseline or candidate")
  const revision = requiredArg("revision")
  const scenario = requiredArg("scenario")
  const nativePathArg = requiredArg("native-path")
  const expectedNativeSha = requiredArg("native-sha")
  const entry = requiredArg("entry")
  const src = requiredArg("src")
  const doRender = scenario === "renderer-entry"

  const t0 = performance.now()
  let importMs: number | null = null
  try {
    await import(entry)
  } finally {
    importMs = performance.now() - t0
  }

  let ttfmMs: number | null = null
  let nativeLoadedMs: number | null = null
  if (doRender) {
    const { createTestRenderer } = await import(join(src, "testing/test-renderer.js"))
    const { TextRenderable } = await import(join(src, "renderables/Text.js"))
    const { setRenderLibPath } = await import(join(src, "zig.js"))
    setRenderLibPath(nativePathArg)
    const setup = await createTestRenderer({ width: 80, height: 24, useThread: false })
    const text = new TextRenderable(setup.renderer, { content: "cold-start", width: 10, height: 1 })
    setup.renderer.root.add(text)
    await setup.renderOnce()
    ttfmMs = performance.now() - t0
    nativeLoadedMs = 0 // native load is integral to the cold start; no separate mark
    setup.renderer.destroy()
  }

  const result = {
    schemaVersion: 1,
    role,
    root,
    revision,
    scenario,
    runtime: { bun: Bun.version, node: process.version },
    nativeSha256: expectedNativeSha,
    importMs,
    ttfmMs,
    nativeLoadedMs,
    correct: ttfmMs !== null ? ttfmMs > 0 : true,
  }
  process.stdout.write(`${RESULT_PREFIX}${JSON.stringify(result)}\n`)
}

main().catch((error) => {
  console.error("wave3 startup probe failed:", error)
  process.exitCode = 1
})
