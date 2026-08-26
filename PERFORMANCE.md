# OpenTUI Performance Program — Results & Evidence

This branch (`fastpatchv2`, released here as **v0.5.6-perf.6**) is a performance-hardening line
maintained on top of upstream [anomalyco/opentui](https://github.com/anomalyco/opentui) v0.5.8.
It contains seven engineering waves, each gated by paired A/B measurements with confidence
intervals, full raw-data provenance, and a documented acceptance record.

## Headline results

| Area | Before | After | Delta | How |
|---|---|---|---|---|
| Cold start (time to first native frame) | ~518 ms | ~131 ms | **−75 %** | Wave 2 entry split + Wave 5 staged FFI binding |
| FFI symbol binding at startup | 395 symbols, ~110 ms | 78 core symbols, ~22 ms | −81 % | Staged CORE/DEFERRED binding with self-healing proxy |
| Code streaming, cold (main-thread) | baseline | — | **−83 %** | Wave 3 C9 native text tail |
| Code streaming, warm (main-thread) | baseline | — | **−93 %** | Wave 3 + Wave 5 (warm −18.6 % on top) |
| Scroll frames in culled lists (10k children) | 10,007 FFI reads/frame | **0** | −100 % | Wave 4 layout-epoch guard |
| Memory, tree-sitter leak | RSS 203 MiB, growing | 106 MiB, stable | fixed | Wave 3 tree-sitter client lifecycle |
| Full test suite | — | 5,725 pass / 0 fail | green | every wave |

## Wave by wave

| Wave | Focus | Verified outcome |
|---|---|---|
| 0 — Observability | Measurable baseline | Cold import quantified (~518 ms); opt-in telemetry proven ≈ zero-cost when disabled |
| 1 — Lifecycle | Renderable-tree ownership | Lifecycle oracles established; tree-free correctness at update/reset; deliberate trade-off: custom-feed p95 +11.3 % kept in exchange for ownership safety (R-01) |
| 2 — Startup/Import | Module graph | Entry splitting (`*-entry.ts`); paired TTFMF −16.4 % |
| 3 — Streaming | Main-thread relief for code streaming | C9 native styled-text tail; cold main-thread −83 %, warm −92.9 %; update-to-styled-commit −59.7 % / −88.1 %; end-to-end wall gate PASS; tree-sitter leak fixed |
| 4 — Scaling & robustness | Scroll-frame FFI storm, worker seam, console refcount | Layout-epoch guard: translate-only scroll frames perform zero `updateFromLayout` FFI reads (independently proven via test rotation: red without guard, green with); worker resolve moved behind platform seam (R-06); console capture reference-counted for two overlay renderers (R-07) |
| 5 — Staged FFI binding | The 110 ms dlopen block | Startup binds a 78-symbol CORE set (~22 ms); the remaining 333 symbols bind lazily via a self-healing proxy and a chunked background full-bind after the first native commit; paired TTFMF **−52.2 %** [CI −57.9 / −46.8], warm streaming −18.6 %, cold streaming +3.2 % (CI includes 0) |
| 6 — Import-lean audit | Remaining ~43 ms import block | Verified no-op: upstream commit `03c67c69` had already detached console/tree-sitter; everything left on the entry graph is constructor/first-frame required. Lever closed with evidence |
| 7 — Upstream sync | Merge upstream v0.5.4+v0.5.5 | Native sources moved to `packages/native`, vendored Zig deps, embedded-terminal feature, FFI `buffer` types — all merged with zero regression (paired TTFMF −1.5 %, CI includes 0); Wave 5 staging verified on the new native build |

## Known trade-offs (deliberate, documented)

- **R-01:** custom span feed at 25k lines p95 +11.3 % — accepted in Wave 1. A safety-related
  ownership fix must not be traded away for a microbenchmark.
- **Cold streaming, first job per process:** ~+17 ms one-time (background full-bind of
  deferred FFI symbols interleaves with the first worker job). After that, everything is
  pass-through. Traded against −143 ms TTFMF on every cold start and −18.6 % warm streaming.
- **R-03:** formal n=30 wall-clock certification is parked — the development host never
  reaches a sufficiently quiet load window (<4). No regression is evidenced; the E2E wall
  gate passed. Certification can be run on quieter hardware using the committed gates.

## Methodology

- **Paired A/B gates** (`bun scripts/wave3-startup-gate.ts`, `wave3-clean-gate-cpu.ts`,
  `wave5-startup-breakdown.ts`): baseline vs. candidate alternate in one process pair,
  bootstrap 95 % confidence intervals, familywise upper bounds; per-arm native SHA and
  host-load provenance recorded in every raw NDJSON.
- **Deterministic counters beat wall clocks** where possible (e.g., FFI read counts on
  scroll frames are asserted by unit tests, not just measured).
- **Evidence contract:** raw data committed under `packages/core/.yesmem/bench/`,
  invalid runs explicitly marked `UNCLEAR`/invalidated rather than discarded; acceptance
  records in `.yesmem/performance-regression-ledger.md` (§11.1–11.6, German working notes).
- Cold measurements are one process per run; agent-produced results are independently
  re-verified by the coordinator before any merge.

## Reproducing

```bash
cd packages/core
bun run build:native        # needs Zig 0.16 on PATH
bun run test:js             # full suite
bun run bench:wave3:startup-gate   # paired startup A/B gate
bun run bench:wave3:cpu-gate       # paired streaming CPU gate
bun scripts/wave5-startup-breakdown.ts --native-path=<abs path to libopentui.so>
```

## Status of the risk ledger

Closed: R-02 (startup), R-06, R-07, FFI half of R-08, lever-2 import work.
Open by choice: R-08 remainder (`hasSafePartialComposition` O(K·N)) and R-09
(sibling traversal) — no measurable pain at realistic tree sizes; both require a
scaling-gate proof before any refactor. R-03 certification parked (host constraint).
