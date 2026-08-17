import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

import { calculateStats } from "./measure-parser-worker"

const scriptPath = fileURLToPath(new URL("./measure-parser-worker.ts", import.meta.url))

describe("parser-worker execution probe", () => {
  test("calculates the conventional median for an even sample count", () => {
    expect(calculateStats([4, 1, 3, 2])).toEqual({ median: 2.5, p95: 4, min: 1, max: 4 })
  })

  test("fails when the probe child cannot run", () => {
    const result = spawnSync(process.execPath, [scriptPath, "--verify-executed"], {
      encoding: "utf8",
      env: { ...process.env, BUN_PATH: "/bin/false" },
    })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("probe child failed")
  })
})
