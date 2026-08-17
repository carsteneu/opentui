import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..")

// Bundle evidence (plan 5.4 explicitly allows build metadata): bundle the
// entry with the same bundler used for dist, then assert on value-level
// markers. Type-only imports are erased by the bundler, so a class/function
// declaration marker proves the implementation module is really loaded.
function bundleSourceGraph(entry: string): string {
  const outDir = mkdtempSync(join(tmpdir(), "opentui-entry-graph-"))
  try {
    const result = spawnSync(
      process.execPath,
      ["build", join(packageDir, entry), `--outdir=${outDir}`, "--target=node", "--external", "events"],
      { encoding: "utf8" },
    )
    if (result.status !== 0) {
      throw new Error(`bun build failed for ${entry}: ${result.stderr || result.stdout}`)
    }
    return readdirSync(outDir)
      .filter((name) => name.endsWith(".js"))
      .map((name) => readFileSync(join(outDir, name), "utf8"))
      .join("\n")
  } finally {
    rmSync(outDir, { recursive: true, force: true })
  }
}

function expectMarkers(bundle: string, markers: string[], presence: boolean) {
  for (const marker of markers) {
    expect(bundle.includes(marker), `${marker} ${presence ? "missing" : "leaked"}`).toBe(presence)
  }
}

describe("entrypoint import graphs", () => {
  test("lean renderable entry excludes optional subsystem implementations", () => {
    const bundle = bundleSourceGraph("src/renderable-entry.ts")

    expectMarkers(
      bundle,
      [
        "class Renderable extends",
        "class TextRenderable extends",
        "class BoxRenderable extends",
        "class TextNodeRenderable extends",
      ],
      true,
    )

    // Optional subsystems must not be value-loaded: audio, image, markdown,
    // console, tree-sitter machinery (client accessor, styled-text converter,
    // wasm runtime) and the worker-backed parser path.
    expectMarkers(
      bundle,
      [
        "class AudioCaptureStream extends",
        "class AudioRecorder extends",
        "class AudioStream extends",
        "class NativeImage {",
        "class ImageRenderable extends",
        "class MarkdownRenderable extends",
        "createMarkdownCodeBlockRenderer",
        "createIcyStreamDemuxer",
        "getTreeSitterClient",
        "treeSitterToTextChunks",
        "destroyTreeSitterClient",
        "class TerminalConsole extends",
      ],
      false,
    )
  })

  test("lean renderable entry evaluates and starts no worker at import", async () => {
    const entry = await import("../renderable-entry.js")
    expect(typeof entry.Renderable).toBe("function")
    expect(typeof entry.TextRenderable).toBe("function")

    // getTreeSitterClient is the only spawn call site for the parser worker;
    // the bundle proof above shows it is absent, so no worker can start from
    // this import. This evaluation proves the module graph is importable.
  })

  test("renderer entry keeps the renderer and drops optional renderables", () => {
    const bundle = bundleSourceGraph("src/renderer-entry.ts")

    expectMarkers(bundle, ["class CliRenderer extends", "function createCliRenderer"], true)
    expectMarkers(
      bundle,
      [
        "class AudioStream extends",
        "class AudioCaptureStream extends",
        "createIcyStreamDemuxer",
        "class ImageRenderable extends",
        "class MarkdownRenderable extends",
      ],
      false,
    )

    // Documented zwingende Basis of CliRenderer: the console overlay and the
    // tree-sitter client teardown are statically imported by renderer.ts.
    // Making these lazy is Loop C territory; this pins the current contract.
    expectMarkers(bundle, ["class TerminalConsole extends", "destroyTreeSitterClient"], true)
  })

  test("optional subsystem entries expose their own implementations", () => {
    const audioBundle = bundleSourceGraph("src/audio-entry.ts")
    expectMarkers(audioBundle, ["class AudioCaptureStream extends", "createIcyStreamDemuxer"], true)

    const imageBundle = bundleSourceGraph("src/image-entry.ts")
    expectMarkers(imageBundle, ["class NativeImage {", "class ImageRenderable extends"], true)

    const markdownBundle = bundleSourceGraph("src/markdown-tree-sitter-entry.ts")
    expectMarkers(markdownBundle, ["class MarkdownRenderable extends", "treeSitterToTextChunks"], true)

    const consoleBundle = bundleSourceGraph("src/console-entry.ts")
    expectMarkers(consoleBundle, ["class TerminalConsole extends"], true)
  })
})
