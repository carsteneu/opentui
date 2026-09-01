# OpenTUI Agent Guide

## Engineering

- Reuse existing seams; do not duplicate policy, ownership, or state across TypeScript, Zig, and framework layers.
- For bug fixes, first add a focused regression test of observable behavior or invariants. If automation is impossible,
  record the evidence and remaining manual verification; do not substitute contract sketches or guesses.
- Make native ownership explicit; clean up handles, callbacks, buffers, and listeners on every exit path. Bound
  input-driven work and test lifecycle failures.
- Do not interchange byte lengths, code points, graphemes, and terminal display-cell widths.
- `oxfmt` is the formatting source of truth (`semi: false`, `printWidth: 120`); avoid unrelated formatting churn.

## Tooling And Runtimes

- Use Bun for dependency management and development commands: `bun install`, `bun run <script>`, `bun test`, and `bun <file>`.
- Run package scripts from the package directory unless the script is defined at the repository root.
- Shared runtime code must preserve the supported Bun and Node paths. Keep runtime-specific behavior behind existing
  platform/runtime/build seams; do not introduce Bun-only APIs into shared modules. Node checks use the minimum
  version enforced by `scripts/node26.mjs`.

## Verification

- Run the narrowest relevant test first, then the affected package suite.
- Ordinary TypeScript source changes do not require the root build. Use the affected package's `test`, `typecheck`,
  `build`, or validation scripts as applicable.
- Run `bun run build` from the repository root after native or cross-package build/output changes, or when tests report
  a missing/stale native artifact. It does not build web or examples; use their package scripts.
- For native changes, run `bun run test:native` from `packages/core`. Filter with `bun run test:native -Dtest-filter="test name"` while iterating.
- For runtime, FFI, build, or export changes, run the relevant Node and packed-distribution scripts from that package
  (such as `test:js:node` or `test:dist`) when present.
- Use root `bun run fmt:check` and `bun run lint` for final static checks when relevant.

Prefer tests and `TestRenderer` for automated debugging. For interactive behavior, load the `terminal-control` skill and
use its terminal tool to run, drive, and inspect the app; repository examples bind backtick to
`renderer.console.toggle()` for captured `console.log` output. Ask for a user-run reproduction only when the required
terminal or platform is unavailable locally.

## Portable FFI

- Portable symbol signatures must stay within the `node:ffi`/`bun:ffi` intersection. Use explicit widths such as
  `u32`/`u64`, not backend-only ABI names such as `usize`, `napi_env`, or `napi_value`; represent `i64`/`u64` as `bigint`,
  native booleans as `0`/`1`, and shared pointers as `number | bigint`.
- Default to `buffer` for transient, non-null `TypedArray` parameters and pass the view directly. Do not call `ptr()`.
- Use `ptr` only when a parameter can be null, accepts a numeric native address, is a callback, or receives a raw
  `ArrayBuffer`. Pass transient owner objects directly to `ptr` parameters; do not pre-resolve them.
- On Bun 1.3.14, `DataView` is not accepted by `buffer` or `ptr`. You MUST pass an equivalent typed array such as
  `new Uint8Array(view.buffer, view.byteOffset, view.byteLength)`.
- On Bun 1.4+, a non-null `DataView` MUST use `buffer` and be passed directly.
- Use `ptr(view)` only when native code stores the address beyond the call. Before resolving it, access `view.buffer` to
  move any inline typed-array storage into a stable `ArrayBuffer`, then keep the view alive for the complete native
  lifetime. The order is required: `const owner = view.buffer; const address = ptr(view)`. Calling `ptr(view)` first and
  accessing `view.buffer` later can move the storage and invalidate `address`.
- Model C-string inputs as pointer parameters and pass owned, NUL-terminated byte buffers directly; string returns are
  not portable. Create callbacks through the loaded library/platform facade, not `new JSCallback(...)`, and assume only
  same-thread callbacks.

## Releases on this fork (fastpatchv2)

Releases ship exclusively through the GitHub pipeline (`.github/workflows/release.yml`), triggered by pushing a tag
`v<version>` on `fastpatchv2`. Do not build or publish releases locally; the pipeline is the single source.
Detailed procedure and history: `.yesmem/bench/v059-merge/README.md` and the release section of this guide.

- Bump the version in every `packages/*/package.json` plus `README.md` and `PERFORMANCE.md`
  (`chore: perf release bumps 0.5.6-perf.N → 0.5.6-perf.N+1`), push the branch, then push the tag.
- Workflow edits must be part of the tagged commit — Actions reads the workflow from the tag. Delete and re-push the
  tag to pick them up.
- `build-native` runs on macOS 15 (`build:native --all` needs the macOS SDK for Darwin cross-builds) and packs the four
  pin-relevant npm tarballs: `core`, `core-linux-x64`, `keymap`, `solid`.
- npm publishing and Windows DLL signing are opt-in via repo variables (`NPM_PUBLISH`, `WINDOWS_SIGNING`); both are off
  on this fork. Releases are consumed from the GitHub release assets, never from npm.
- Verify after the run: all four tarball assets (`opentui-core-…`, `opentui-core-linux-x64-…`,
  `opentui-keymap-…`, `opentui-solid-…`) return HTTP 200, then run the consumer startup smoke before re-pinning
  consumers such as OpenCode.
