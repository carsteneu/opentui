import { basename, isAbsolute, resolve } from "node:path"

export type Runtime = "bun" | "node"
export type Scenario = "minimal" | "root" | "zig" | "dist" | "renderer-entry" | "renderable-entry"

export const scenarios: readonly Scenario[] = ["minimal", "root", "zig", "dist", "renderer-entry", "renderable-entry"]

export interface BaselineSelection {
  root: string
  label: string
  explicit: boolean
}

export function resolveBaselineSelection(args: Record<string, string>, repoRoot: string): BaselineSelection {
  const configuredRoot = args["baseline-root"]
  if (configuredRoot !== undefined && !isAbsolute(configuredRoot)) {
    throw new Error("--baseline-root must be absolute")
  }
  const root = configuredRoot === undefined ? resolve(repoRoot, "..", "fastpatch") : resolve(configuredRoot)
  return {
    root,
    label: args["baseline-label"] || basename(root),
    explicit: configuredRoot !== undefined,
  }
}

export function scenarioUsesCommittedFrame(scenario: Scenario, runtime: Runtime): boolean {
  return runtime === "bun" && (scenario === "root" || scenario === "zig" || scenario === "renderer-entry")
}

export function scenarioTarget(treeRoot: string, scenario: Scenario, runtime: Runtime) {
  const core = resolve(treeRoot, "packages", "core")
  const src = resolve(core, "src")
  return {
    src,
    entry: scenario === "dist" ? distEntry(core, runtime) : sourceEntry(src, scenario),
    render: scenarioUsesCommittedFrame(scenario, runtime),
  }
}

function sourceEntry(srcRoot: string, scenario: Scenario): string {
  if (scenario === "minimal") return resolve(srcRoot, "Renderable.ts")
  if (scenario === "renderer-entry") return resolve(srcRoot, "renderer-entry.ts")
  if (scenario === "renderable-entry") return resolve(srcRoot, "renderable-entry.ts")
  return resolve(srcRoot, scenario === "root" ? "index.ts" : "zig.ts")
}

function distEntry(core: string, runtime: Runtime): string {
  return resolve(core, "dist", runtime === "node" ? "index.node.js" : "index.bun.js")
}
