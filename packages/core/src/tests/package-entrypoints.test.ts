import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const packageJson = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")) as {
  exports: Record<string, Record<string, string> | undefined>
}

// Granular subpaths per the wave-2 entry-point plan. Each maps every runtime
// condition to the same additive source entry file.
const GRANULAR_SUBPATHS = [
  { subpath: "./renderer", entry: "./src/renderer-entry.ts" },
  { subpath: "./renderable", entry: "./src/renderable-entry.ts" },
  { subpath: "./audio", entry: "./src/audio-entry.ts" },
  { subpath: "./image", entry: "./src/image-entry.ts" },
  { subpath: "./markdown-tree-sitter", entry: "./src/markdown-tree-sitter-entry.ts" },
  { subpath: "./console", entry: "./src/console-entry.ts" },
] as const

describe("@opentui/core package entrypoints", () => {
  test("exports map declares the granular subpaths", () => {
    for (const { subpath } of GRANULAR_SUBPATHS) {
      expect(packageJson.exports[subpath], `${subpath} must be exported`).toBeDefined()
    }
  })

  test("each granular subpath maps every condition to its source entry file", () => {
    for (const { subpath, entry } of GRANULAR_SUBPATHS) {
      const conditions = packageJson.exports[subpath]
      for (const condition of ["types", "bun", "node", "import"]) {
        expect(conditions?.[condition], `${subpath} ${condition} condition`).toBe(entry)
      }
      expect(existsSync(join(packageDir, entry)), `${entry} must exist`).toBe(true)
    }
  })

  test("granular subpaths resolve at runtime", () => {
    for (const { subpath } of GRANULAR_SUBPATHS) {
      const specifier = `@opentui/core${subpath.slice(1)}`
      expect(() => import.meta.resolve(specifier), `${specifier} must resolve`).not.toThrow()
    }
  })

  test("root export surface is unchanged by the granular entries", async () => {
    const expected = JSON.parse(
      readFileSync(join(packageDir, "src/tests/__snapshots__/root-export-surface.json"), "utf8"),
    ) as string[]
    const root = await import("../index.js")
    expect(Object.keys(root).sort()).toEqual(expected)
  })
})
