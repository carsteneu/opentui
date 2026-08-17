import { afterEach, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

interface ProbeResult {
  scenario: string
  runtime: "bun" | "node"
  importMs: number
  ttfmMs: number | null
  firstCommitAt: number | null
  destroyMs: number | null
  marks: Array<{ name: string; atMs: number }>
}

const temporaryDirectories: string[] = []
const probe = join(import.meta.dir, "cold-import-probe.ts")
const coreRoot = resolve(import.meta.dir, "..")
const sourceRoot = join(coreRoot, "src")

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { force: true, recursive: true })
})

function runProbe(overrides: Record<string, string>): ProbeResult {
  const result = spawnSync(process.execPath, ["run", probe], {
    cwd: import.meta.dir,
    encoding: "utf8",
    env: {
      ...process.env,
      OPENTUI_BENCH_SRC: sourceRoot,
      OPENTUI_BENCH_TELEMETRY: "0",
      OPENTUI_BENCH_LIFECYCLE: "0",
      ...overrides,
    },
    timeout: 60_000,
  })
  if (result.status !== 0) throw new Error(result.stderr || result.stdout)
  const json = result.stdout.split("\n").findLast((line) => line.trimStart().startsWith("{"))
  if (!json) throw new Error(`probe returned no JSON: ${result.stdout}`)
  return JSON.parse(json) as ProbeResult
}

describe("cold-import probe boundaries", () => {
  test("does not report an empty import as TTFMF", () => {
    const directory = mkdtempSync(join(tmpdir(), "opentui-empty-import-"))
    temporaryDirectories.push(directory)
    const entry = join(directory, "empty.mjs")
    writeFileSync(entry, "export {}\n")

    const result = runProbe({
      OPENTUI_BENCH_ENTRY: pathToFileURL(entry).href,
      OPENTUI_BENCH_SCENARIO: "renderable-entry",
      OPENTUI_BENCH_RENDER: "0",
    })

    expect(result.importMs).toBeGreaterThanOrEqual(0)
    expect(result.ttfmMs).toBeNull()
    expect(result.firstCommitAt).toBeNull()
    expect(result.destroyMs).toBeNull()
  })

  test("Bun renderer entry measures through a real Text frame and successful native commit", () => {
    const result = runProbe({
      OPENTUI_BENCH_ENTRY: pathToFileURL(join(sourceRoot, "renderer-entry.ts")).href,
      OPENTUI_BENCH_SCENARIO: "renderer-entry",
      OPENTUI_BENCH_RENDER: "1",
      OPENTUI_BENCH_TELEMETRY: "1",
      OTUI_ASSET_ROOT: join(coreRoot, "node_modules"),
    })

    expect(result.runtime).toBe("bun")
    expect(result.scenario).toBe("renderer-entry")
    expect(result.ttfmMs).toBeNumber()
    expect(result.ttfmMs!).toBeGreaterThan(result.importMs)
    expect(result.destroyMs).toBeNumber()
    expect(result.firstCommitAt).toBeNumber()
    expect(result.marks.map((mark) => mark.name)).toContain("opentui.firstNativeCommit")
  }, 60_000)
})
