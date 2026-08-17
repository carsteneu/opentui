import { spawnSync, type SpawnSyncReturns } from "node:child_process"
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve } from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

import { requireNode26 } from "../../../scripts/node26.mjs"

interface PackageJson {
  name: string
  version: string
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const rootDir = resolve(__dirname, "..")
const distDir = join(rootDir, "dist")
const args = new Set(process.argv.slice(2))
const keepTemp = args.has("--keep-temp")
const skipBuild = args.has("--skip-build")
const nodePath = requireNode26()

const packageJson = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8")) as PackageJson
const nativePackageName = `${packageJson.name}-${process.platform}-${process.arch}`
const nativePackageDir = join(rootDir, "node_modules", nativePackageName)

const declarationPaths = [
  "index.d.ts",
  "node-assets.d.ts",
  "testing.d.ts",
  "renderer-entry.d.ts",
  "renderable-entry.d.ts",
  "audio-entry.d.ts",
  "image-entry.d.ts",
  "markdown-tree-sitter-entry.d.ts",
  "console-entry.d.ts",
  "lib/tree-sitter/parser.worker.d.ts",
]

function runCommand(
  command: string,
  commandArgs: string[],
  cwd: string,
  errorMessage: string,
  options: { stdio?: "inherit" | "pipe"; timeout?: number } = {},
): SpawnSyncReturns<Buffer> {
  const result = spawnSync(command, commandArgs, {
    cwd,
    stdio: options.stdio ?? "inherit",
    timeout: options.timeout,
  })

  if (result.error) {
    throw new Error(`${errorMessage}: ${result.error.message}`)
  }

  if (result.status !== 0) {
    throw new Error(errorMessage)
  }

  return result
}

function runCommandExpectFailure(
  command: string,
  commandArgs: string[],
  cwd: string,
  errorMessage: string,
): SpawnSyncReturns<Buffer> {
  const result = spawnSync(command, commandArgs, {
    cwd,
    stdio: "pipe",
  })

  if (result.error) {
    throw new Error(`${errorMessage}: ${result.error.message}`)
  }

  if (result.status === 0) {
    throw new Error(errorMessage)
  }

  return result
}

function ensureBuildArtifacts(): void {
  if (!skipBuild) {
    runCommand("bun", ["run", "build"], rootDir, "Dist test build failed")
  }

  if (!existsSync(distDir)) {
    throw new Error(`Missing dist directory at ${distDir}. Run bun run build first.`)
  }

  if (!existsSync(nativePackageDir)) {
    throw new Error(`Missing native package directory at ${nativePackageDir}. Run bun run build first.`)
  }
  if (!existsSync(join(nativePackageDir, "LICENSE-GHOSTTY"))) {
    throw new Error("Native package is missing the Ghostty and Unicode license notices")
  }
  const leakedGhosttyFiles = readdirSync(nativePackageDir).filter(
    (name) => name.includes("ghostty-vt") || name.endsWith(".a") || name.endsWith(".lib"),
  )
  if (leakedGhosttyFiles.length > 0) {
    throw new Error(`Native package contains unbundled Ghostty artifacts: ${leakedGhosttyFiles.join(", ")}`)
  }
}

function assertPortableDeclarations(): void {
  for (const declarationPath of declarationPaths) {
    const fullPath = join(distDir, declarationPath)
    const contents = readFileSync(fullPath, "utf8")
    if (contents.includes("bun:ffi")) {
      throw new Error(`Portable declaration ${declarationPath} still references bun:ffi`)
    }
  }
}

function assertRuntimeOutputs(): void {
  const nodeSource = readRuntimeGraph(
    [
      "index.node.js",
      "testing.js",
      "yoga.js",
      "renderer-entry.js",
      "renderable-entry.js",
      "audio-entry.js",
      "image-entry.js",
      "markdown-tree-sitter-entry.js",
      "console-entry.js",
    ],
    "chunk-node-",
  )
  const bunSource = readRuntimeGraph(
    [
      "index.bun.js",
      "testing.bun.js",
      "yoga.bun.js",
      "renderer-entry.bun.js",
      "renderable-entry.bun.js",
      "audio-entry.bun.js",
      "image-entry.bun.js",
      "markdown-tree-sitter-entry.bun.js",
      "console-entry.bun.js",
    ],
    "chunk-bun-",
  )
  const workerSource = readFileSync(join(distDir, "parser.worker.js"), "utf8")
  const distPackage = JSON.parse(readFileSync(join(distDir, "package.json"), "utf8")) as {
    exports: Record<string, Record<string, string>>
  }

  for (const [name, source] of [
    ["Node root", nodeSource],
    ["Node parser worker", workerSource],
  ] as const) {
    if (/with:\s*\{\s*type:\s*["'](?:file|wasm)["']/.test(source)) {
      throw new Error(`${name} contains a Bun file import attribute`)
    }
  }
  if (/import\(["']@opentui\/core-(?:darwin|linux|win32)-/.test(nodeSource)) {
    throw new Error("Node root contains a statically resolved OpenTUI native package import")
  }
  if (!/with:\s*\{\s*type:\s*["']file["']/.test(bunSource)) {
    throw new Error("Bun root does not retain literal file imports")
  }
  if (/\b(?:from|import\()\s*["']web-tree-sitter["']/.test(workerSource)) {
    throw new Error("Node parser worker still imports web-tree-sitter at runtime")
  }
  if (!workerSource.includes('"web-tree-sitter/tree-sitter.wasm"')) {
    throw new Error("Node parser worker does not reference the stable tree-sitter WASM key")
  }

  const rootExport = distPackage.exports["."]
  if (
    rootExport?.bun !== "./index.bun.js" ||
    rootExport?.node !== "./index.node.js" ||
    rootExport?.import !== "./index.node.js"
  ) {
    throw new Error("Root package export does not select separate Bun and Node runtime outputs")
  }
  if (distPackage.exports["./node-assets"]?.import !== "./node-assets.js") {
    throw new Error("Missing @opentui/core/node-assets package export")
  }
  for (const [subpath, file] of [
    ["./renderer", "renderer-entry"],
    ["./renderable", "renderable-entry"],
    ["./audio", "audio-entry"],
    ["./image", "image-entry"],
    ["./markdown-tree-sitter", "markdown-tree-sitter-entry"],
    ["./console", "console-entry"],
  ] as const) {
    const entryExport = distPackage.exports[subpath]
    if (entryExport?.bun !== `./${file}.bun.js` || entryExport?.import !== `./${file}.js`) {
      throw new Error(`Missing or malformed ${packageJson.name}${subpath} package export`)
    }
  }
  const workerExport = distPackage.exports["./parser.worker"]
  if (
    workerExport?.bun !== "./parser.worker.js" ||
    workerExport?.node !== "./parser.worker.js" ||
    workerExport?.import !== "./parser.worker.js"
  ) {
    throw new Error("Parser worker package export does not select the shared worker output")
  }

  for (const sourceMap of ["index.node.js.map", "index.bun.js.map", "parser.worker.js.map"]) {
    if (!existsSync(join(distDir, sourceMap))) {
      throw new Error(`Missing source map ${sourceMap}`)
    }
  }
  const workerSourceMap = JSON.parse(readFileSync(join(distDir, "parser.worker.js.map"), "utf8")) as {
    sources?: string[]
  }
  const workerSourcePath = workerSourceMap.sources?.find((source) => source.endsWith("/parser.worker.ts"))
  if (!workerSourcePath || !existsSync(resolve(distDir, workerSourcePath))) {
    throw new Error("Parser worker source map does not resolve to parser.worker.ts")
  }
  if (existsSync(join(distDir, "parser.worker.bun.js"))) {
    throw new Error("Found obsolete Bun-specific parser worker")
  }
}

function readRuntimeGraph(entryPaths: string[], chunkPrefix: string): string {
  const chunkPaths = readdirSync(distDir)
    .filter((name) => name.startsWith(chunkPrefix) && name.endsWith(".js"))
    .sort()
  return [...entryPaths, ...chunkPaths].map((path) => readFileSync(join(distDir, path), "utf8")).join("\n")
}

// Follows an entry's static imports through its chunk graph so assertions
// cover exactly the modules a consumer of that entry loads at runtime.
function readEntryClosure(entryPath: string): string {
  const seen = new Set<string>()
  const queue = [entryPath]
  const parts: string[] = []
  while (queue.length > 0) {
    const current = queue.pop() as string
    if (seen.has(current)) continue
    seen.add(current)
    const source = readFileSync(join(distDir, current), "utf8")
    parts.push(source)
    for (const match of source.matchAll(/from\s*"(\.\/[^"]+\.js)"/g)) {
      if (!seen.has(match[1])) queue.push(match[1])
    }
    for (const match of source.matchAll(/import\s*"(\.\/[^"]+\.js)"/g)) {
      if (!seen.has(match[1])) queue.push(match[1])
    }
  }
  return parts.join("\n")
}

function assertClosureExcludes(entryPath: string, forbidden: string[]): void {
  const closure = readEntryClosure(entryPath)
  for (const marker of forbidden) {
    if (closure.includes(marker)) {
      throw new Error(`${entryPath} runtime graph contains excluded implementation marker: ${marker}`)
    }
  }
}

function assertLeanEntryClosures(): void {
  assertClosureExcludes("renderable-entry.js", [
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
  ])
  assertClosureExcludes("renderable-entry.bun.js", [
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
  ])
  // renderer-entry keeps the renderer's zwingende Basis (console overlay,
  // tree-sitter teardown) but must not load the optional subsystems.
  for (const entry of ["renderer-entry.js", "renderer-entry.bun.js"]) {
    assertClosureExcludes(entry, [
      "class AudioCaptureStream extends",
      "class AudioRecorder extends",
      "class AudioStream extends",
      "createIcyStreamDemuxer",
      "class ImageRenderable extends",
      "class MarkdownRenderable extends",
      "createMarkdownCodeBlockRenderer",
    ])
  }
}

function packArtifact(packageDir: string, packDir: string): string {
  const result = runCommand(
    "npm",
    ["pack", "--pack-destination", packDir],
    packageDir,
    `Failed to pack ${packageDir}`,
    {
      stdio: "pipe",
    },
  )

  const tarballName = result.stdout.toString("utf8").trim().split(/\r?\n/).at(-1)

  if (!tarballName) {
    throw new Error(`Failed to determine tarball name for ${packageDir}`)
  }

  return join(packDir, tarballName)
}

function writeConsumerPackage(consumerDir: string, coreTarball: string, nativeTarball: string, name: string): void {
  const coreDependency = `file:${relative(consumerDir, coreTarball).replaceAll("\\", "/")}`
  const nativeDependency = `file:${relative(consumerDir, nativeTarball).replaceAll("\\", "/")}`

  writeFileSync(
    join(consumerDir, "package.json"),
    JSON.stringify(
      {
        name,
        private: true,
        type: "module",
        dependencies: {
          [packageJson.name]: coreDependency,
          [nativePackageName]: nativeDependency,
        },
        overrides: {
          [nativePackageName]: nativeDependency,
        },
      },
      null,
      2,
    ),
  )
}

function writeNodeTest(nodeDir: string): void {
  writeFileSync(
    join(nodeDir, "index.mjs"),
    `import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const nativePackageName = ${JSON.stringify(nativePackageName)}

const core = await import(${JSON.stringify(packageJson.name)})
const nodeAssets = await import(${JSON.stringify(`${packageJson.name}/node-assets`)})
const testing = await import(${JSON.stringify(`${packageJson.name}/testing`)})
const yoga = await import(${JSON.stringify(`${packageJson.name}/yoga`)})
const rendererEntry = await import(${JSON.stringify(`${packageJson.name}/renderer`)})
const renderableEntry = await import(${JSON.stringify(`${packageJson.name}/renderable`)})
const audioEntry = await import(${JSON.stringify(`${packageJson.name}/audio`)})
const imageEntry = await import(${JSON.stringify(`${packageJson.name}/image`)})
const markdownEntry = await import(${JSON.stringify(`${packageJson.name}/markdown-tree-sitter`)})
const consoleEntry = await import(${JSON.stringify(`${packageJson.name}/console`)})
const parserWorker = await import(${JSON.stringify(`${packageJson.name}/parser.worker`)})
const nativePackage = await import(nativePackageName)

assert.equal(typeof core.createCliRenderer, "function")
assert.equal(typeof core.Audio, "function")
assert.equal(typeof core.AudioCaptureStream, "function")
assert.equal(typeof core.AudioCaptureStreamError, "function")
assert.equal(typeof core.AudioRecorder, "function")
assert.equal(typeof core.AudioRecorderError, "function")
assert.equal(typeof core.AudioStreamError, "function")
assert.equal(typeof core.NativeImage, "function")
assert.equal(typeof core.ImageRenderable, "function")
assert.equal(typeof core.Audio.prototype.openCapture, "function")
assert.equal(typeof core.Audio.prototype.recordToFile, "function")
assert.equal(typeof core.createIcyStreamDemuxer, "function")
assert.equal(core.NativeAudioStreamCloseReason.TransportError, 1)
assert.equal(core.NativeAudioStreamFormat.Mp3, 1)
assert.equal(core.NativeAudioStreamFormat.Flac, 2)
assert.equal(typeof testing.createTestRenderer, "function")
assert.equal(core.Yoga.Node, yoga.Node)
assert.equal(Object.getPrototypeOf(testing.MockTreeSitterClient.prototype), core.TreeSitterClient.prototype)
  assert.equal(typeof parserWorker, "object")
  assert.equal(typeof rendererEntry.createCliRenderer, "function")
  assert.equal(typeof rendererEntry.CliRenderer, "function")
  assert.equal(typeof rendererEntry.createRendererReady, "function")
  assert.equal(typeof rendererEntry.RendererReadyError, "function")
  assert.equal(typeof rendererEntry.RendererReadyDestroyedError, "function")
  assert.equal(typeof rendererEntry.Audio, "undefined")
  assert.equal(typeof renderableEntry.TextRenderable, "function")
  assert.equal(typeof renderableEntry.BoxRenderable, "function")
  assert.equal(typeof renderableEntry.ImageRenderable, "undefined")
  assert.equal(typeof renderableEntry.Audio, "undefined")
  assert.equal(typeof audioEntry.Audio, "function")
  assert.equal(typeof audioEntry.createIcyStreamDemuxer, "function")
  assert.equal(typeof imageEntry.NativeImage, "function")
  assert.equal(typeof imageEntry.ImageRenderable, "function")
  assert.equal(typeof markdownEntry.MarkdownRenderable, "function")
  assert.equal(typeof consoleEntry.TerminalConsole, "function")
assert.equal(typeof nativePackage.default, "string")

const manifest = nodeAssets.getNodeAssets({
  platform: process.platform,
  arch: process.arch,
  ...(process.platform === "linux" ? { libc: "glibc" } : {}),
})
assert.equal(manifest.length, 14)
assert.deepEqual(
  manifest.map((asset) => asset.key),
  manifest.map((asset) => asset.key).toSorted(),
)

const buffer = core.OptimizedBuffer.create(2, 1, "unicode")
assert.equal(buffer.width, 2)
buffer.destroy()

const image = core.NativeImage.fromRgba(Uint8Array.of(1, 2, 3, 255), 1, 1)
const raw = image.takeRaw()
try {
  assert.deepEqual([...raw.data], [1, 2, 3, 255])
  assert.throws(() => image.info(), /disposed/)
} finally {
  raw.dispose()
}

const dataPath = mkdtempSync(join(tmpdir(), "opentui-node-dist-tree-sitter-"))
const client = new core.TreeSitterClient({ dataPath })
try {
  const result = await client.highlightOnce(${JSON.stringify("# Title\n\n```js\nconst answer = 42\n```\n")}, "markdown")
  assert.equal(result.error, undefined)
  assert.ok(result.highlights?.length)
} finally {
  await client.destroy()
  rmSync(dataPath, { recursive: true, force: true })
}

const expectBunOnlyFailure = async (specifier, expectedMessage) => {
  await assert.rejects(import(specifier), (error) => {
    return error instanceof Error && error.message.includes(expectedMessage)
  })
}

await expectBunOnlyFailure(${JSON.stringify(`${packageJson.name}/runtime-plugin`)}, ${JSON.stringify(`${packageJson.name}/runtime-plugin is Bun-only`)})
await expectBunOnlyFailure(
  ${JSON.stringify(`${packageJson.name}/runtime-plugin-support`)},
  ${JSON.stringify(`${packageJson.name}/runtime-plugin-support is Bun-only`)},
)
await expectBunOnlyFailure(
  ${JSON.stringify(`${packageJson.name}/runtime-plugin-support/configure`)},
  ${JSON.stringify(`${packageJson.name}/runtime-plugin-support/configure is Bun-only`)},
)

console.log("Node dist smoke test passed")
`,
  )

  writeFileSync(
    join(nodeDir, "require.cjs"),
    `const assert = require("node:assert/strict")

assert.throws(
  () => require(${JSON.stringify(packageJson.name)}),
  (error) => error?.code === "ERR_REQUIRE_ASYNC_MODULE",
  ${JSON.stringify(`Expected ${packageJson.name} CommonJS require to reject its async ESM graph`)},
)

const importOnlySpecifiers = ${JSON.stringify([
      `${packageJson.name}/testing`,
      `${packageJson.name}/tree-sitter/update-assets`,
      `${packageJson.name}/renderer`,
      `${packageJson.name}/renderable`,
      `${packageJson.name}/audio`,
      `${packageJson.name}/image`,
      `${packageJson.name}/markdown-tree-sitter`,
      `${packageJson.name}/console`,
    ])}

for (const specifier of importOnlySpecifiers) {
  assert.throws(
    () => require(specifier),
    (error) => error?.code === "ERR_PACKAGE_PATH_NOT_EXPORTED",
    \`Expected \${specifier} to remain import-only in Node\`,
  )
}

const workerPath = require.resolve(${JSON.stringify(`${packageJson.name}/parser.worker`)})
assert.match(workerPath, /parser\\.worker\\.js$/)

console.log("Node CommonJS export smoke test passed")
`,
  )
}

function writeBunTest(bunDir: string): void {
  writeFileSync(
    join(bunDir, "index.test.ts"),
    `import { describe, expect, test } from "bun:test"

describe("${packageJson.name} dist smoke test", () => {
  test("imports portable and Bun-only entrypoints", async () => {
    const core = await import(${JSON.stringify(packageJson.name)})
    const testing = await import(${JSON.stringify(`${packageJson.name}/testing`)})
      const yoga = await import(${JSON.stringify(`${packageJson.name}/yoga`)})
      const rendererEntry = await import(${JSON.stringify(`${packageJson.name}/renderer`)})
      const renderableEntry = await import(${JSON.stringify(`${packageJson.name}/renderable`)})
      const audioEntry = await import(${JSON.stringify(`${packageJson.name}/audio`)})
      const imageEntry = await import(${JSON.stringify(`${packageJson.name}/image`)})
      const markdownEntry = await import(${JSON.stringify(`${packageJson.name}/markdown-tree-sitter`)})
      const consoleEntry = await import(${JSON.stringify(`${packageJson.name}/console`)})
    const parserWorker = await import(${JSON.stringify(`${packageJson.name}/parser.worker`)})
    const runtimePlugin = await import(${JSON.stringify(`${packageJson.name}/runtime-plugin`)})
    const nativePackage = await import(${JSON.stringify(nativePackageName)})

    expect(typeof core.createCliRenderer).toBe("function")
    expect(typeof core.Audio).toBe("function")
    expect(typeof core.AudioCaptureStream).toBe("function")
    expect(typeof core.AudioCaptureStreamError).toBe("function")
    expect(typeof core.AudioRecorder).toBe("function")
    expect(typeof core.AudioRecorderError).toBe("function")
    expect(typeof core.AudioStreamError).toBe("function")
    expect(typeof core.NativeImage).toBe("function")
    expect(typeof core.ImageRenderable).toBe("function")
    expect(typeof core.Audio.prototype.openCapture).toBe("function")
    expect(typeof core.Audio.prototype.recordToFile).toBe("function")
    expect(core.NativeAudioStreamCloseReason.TransportError).toBe(1)
    expect(core.NativeAudioStreamFormat.Flac).toBe(2)
    expect(typeof testing.createTestRenderer).toBe("function")
    expect(core.Yoga.Node).toBe(yoga.Node)
    expect(Object.getPrototypeOf(testing.MockTreeSitterClient.prototype)).toBe(core.TreeSitterClient.prototype)
      expect(typeof parserWorker).toBe("object")
      expect(typeof rendererEntry.createCliRenderer).toBe("function")
      expect(typeof rendererEntry.CliRenderer).toBe("function")
      expect(typeof rendererEntry.createRendererReady).toBe("function")
      expect(typeof rendererEntry.RendererReadyError).toBe("function")
      expect(typeof rendererEntry.RendererReadyDestroyedError).toBe("function")
      expect(typeof rendererEntry.Audio).toBe("undefined")
      expect(typeof renderableEntry.TextRenderable).toBe("function")
      expect(typeof renderableEntry.BoxRenderable).toBe("function")
      expect(typeof renderableEntry.ImageRenderable).toBe("undefined")
      expect(typeof renderableEntry.Audio).toBe("undefined")
      expect(typeof audioEntry.Audio).toBe("function")
      expect(typeof audioEntry.createIcyStreamDemuxer).toBe("function")
      expect(typeof imageEntry.NativeImage).toBe("function")
      expect(typeof imageEntry.ImageRenderable).toBe("function")
      expect(typeof markdownEntry.MarkdownRenderable).toBe("function")
      expect(typeof consoleEntry.TerminalConsole).toBe("function")
    expect(typeof runtimePlugin.createRuntimePlugin).toBe("function")
    expect(typeof nativePackage.default).toBe("string")
    const image = core.NativeImage.fromRgba(Uint8Array.of(1, 2, 3, 255), 1, 1)
    const raw = image.takeRaw()
    try {
      expect([...raw.data]).toEqual([1, 2, 3, 255])
      expect(() => image.info()).toThrow(/disposed/)
    } finally {
      raw.dispose()
    }
  })
})
`,
  )
}

function assertNodeStaticImportFailure(
  nodeDir: string,
  importedName: string,
  specifier: string,
  expectedMessage: string,
): void {
  const result = runCommandExpectFailure(
    nodePath,
    ["--input-type=module", "-e", `import { ${importedName} } from ${JSON.stringify(specifier)}`],
    nodeDir,
    `Expected static Node import of ${specifier} to fail`,
  )

  const output = `${result.stdout.toString("utf8")}\n${result.stderr.toString("utf8")}`

  if (output.includes("does not provide an export named")) {
    throw new Error(`Static Node import of ${specifier} failed before the Bun-only stub could run`)
  }

  if (!output.includes(expectedMessage)) {
    throw new Error(`Static Node import of ${specifier} did not report the expected Bun-only error`)
  }
}

function installAndTest(nodeDir: string, bunDir: string): void {
  runCommand("npm", ["install", "--ignore-scripts", "--no-package-lock"], nodeDir, "Node dist test install failed")
  runCommand(nodePath, ["-e", `import(${JSON.stringify(packageJson.name)})`], nodeDir, "Node import smoke check failed")
  runCommand(nodePath, ["--experimental-ffi", "--no-warnings", "index.mjs"], nodeDir, "Node dist smoke tests failed", {
    timeout: 60_000,
  })
  runCommand(nodePath, ["require.cjs"], nodeDir, "Node CommonJS export smoke tests failed")

  assertNodeStaticImportFailure(
    nodeDir,
    "createRuntimePlugin",
    `${packageJson.name}/runtime-plugin`,
    `${packageJson.name}/runtime-plugin is Bun-only`,
  )
  assertNodeStaticImportFailure(
    nodeDir,
    "ensureRuntimePluginSupport",
    `${packageJson.name}/runtime-plugin-support`,
    `${packageJson.name}/runtime-plugin-support is Bun-only`,
  )
  assertNodeStaticImportFailure(
    nodeDir,
    "ensureRuntimePluginSupport",
    `${packageJson.name}/runtime-plugin-support/configure`,
    `${packageJson.name}/runtime-plugin-support/configure is Bun-only`,
  )

  runCommand("bun", ["install", "--ignore-scripts"], bunDir, "Bun dist test install failed")
  runCommand("bun", ["test", "index.test.ts"], bunDir, "Bun dist smoke tests failed")
}

let tempRoot: string | undefined

try {
  ensureBuildArtifacts()
  assertPortableDeclarations()
  assertRuntimeOutputs()
  assertLeanEntryClosures()

  tempRoot = mkdtempSync(join(tmpdir(), "opentui-core-dist-test-"))
  const packDir = join(tempRoot, "packs")
  const nodeDir = join(tempRoot, "node")
  const bunDir = join(tempRoot, "bun")

  mkdirSync(packDir, { recursive: true })
  mkdirSync(nodeDir, { recursive: true })
  mkdirSync(bunDir, { recursive: true })

  const coreTarball = packArtifact(distDir, packDir)
  const nativeTarball = packArtifact(nativePackageDir, packDir)

  writeConsumerPackage(nodeDir, coreTarball, nativeTarball, "opentui-core-dist-test-node")
  writeConsumerPackage(bunDir, coreTarball, nativeTarball, "opentui-core-dist-test-bun")
  writeNodeTest(nodeDir)
  writeBunTest(bunDir)

  installAndTest(nodeDir, bunDir)

  if (!keepTemp) {
    rmSync(tempRoot, { recursive: true, force: true })
    tempRoot = undefined
  }

  console.log("Packed dist smoke tests passed")
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  if (tempRoot) {
    console.error(`Dist test workspace kept at ${tempRoot}`)
  }
  process.exit(1)
}
