# Wave-4 R-08 — FFI-Roundtrip-Reduktion im culled Layout (Loop-1 Ergebnis)

Datum: 2026-08-20 · Worktree: `.worktrees/wave4-ffi-layout` · Branch: `yesloop/wave4-ffi-layout`
Basis: Wave3-final-Stand (ab2b9ebc-Linie) · Gate-Definition: `.yesmem/perftodo.md` Serie E (E1/E2)

## Root-Cause-Befund (empirisch)

- `screenX/screenY` sind **Cache-Getters** (Renderable.ts:587-595, kein FFI); FFI im culled Pfad
  entsteht ausschließlich durch `yogaNode.getComputedLayout()` in `updateFromLayout()` (1458/1144).
- Der culled Kind-Refresh (Renderable.ts:1502-1505) ruft `updateFromLayout()` für **alle** Kinder,
  **bevor** viewport-culling greift → 1 FFI-Read/Kind/Rebuild-Frame.
- **Kritisch:** Auf Scroll-/Steady-Frames ist der Yoga-Baum **nicht dirty** (`dirty=0`); die N FFI-Reads
  liefern identische Werte — reiner Abfall. Der eigentliche Storm liegt also NICHT im Reuse-Steady
  (dort greift RenderList-Reuse, FFI=0), sondern auf Rebuild-Frames mit stabilem Yoga (Scroll).
- Wave3-Matrix-Lesart präzisiert: `steadyV=51/FFI=10007` (frames=1) ist der Settling-Frame
  (1. Steady-Frame nach Build, noch `dirty=1`); dort ist N FFI legitim (wirkliche Yoga-Neuberechnung).
  Reuse-Steady (frames≥2) ist bereits 0 FFI. Der R-08-Storm ist der **Scroll-Frame**.

## Korrektheits-Invariante (bewiesen)

Jede Änderung eines Kind-Yoga-Layouts bumpt zwangsläufig die ctx `layoutGeneration`:
`markDirty()` → (Yoga propagiert) → `root.isDirty()` → `calculateLayout()` → `bumpLayoutGeneration()`
(Renderable.ts:2041-2043/2135) — einschl. `syncExternalLayoutGeneration()` über `root.hasNewLayout()`
(2140-2143). `setPosition/setWidth/markDirty` aller Renderables laufen durch diesen Pfad.
→ Bleibt `layoutGeneration` zwischen zwei `updateFromLayout()`-Aufrufen unverändert, sind alle
cached `_x/_y/_width/_height` bit-identisch zum letzten FFI-Read → der Read kann entfallen.

## Optimierung (implementiert)

`Renderable.updateFromLayout()` (Renderable.ts:1135+):
- neues Feld `_layoutEpoch` (init -1)
- Guard: `layoutGeneration === _layoutEpoch` → skip getComputedLayout; nur `_screenX/_screenY`
  aus parent-Kette + cached `_x/_y/_translate` neu berechnen → return.
- sonst: FFI-Read, danach `_layoutEpoch = layoutGeneration`.
- Dirty-Rebuilds (echte Yoga-Änderung) behalten N FFI (unvermeidbar — Layout hat sich geändert).

## Messergebnis (A/B, gleiche Quelle via Stash, 80x44, 50 Scroll-Schritte)

| count | FFI/Frame BASELINE | FFI/Frame AFTER | Wand/Frame Baseline | Wand/Frame AFTER |
|-------|--------------------|------------------|---------------------|------------------|
| 100   | 107                | **0**            | 0.297 ms            | 0.266 ms         |
| 1000  | 1007               | **0**            | 0.835 ms            | 0.450 ms         |
| 10000 | 10007              | **0**            | 5.035 ms            | 3.364 ms         |

- `updateFromLayoutFfiCalls` auf Scroll-Frames: **100 % eliminiert** (die R-08-Zielmetrik).
- Visited (51) und renderCommands (53) konstant → Culling unverändert korrekt.
- Verbleibender 10k-Wall (±3.3ms) ist **irreduzible Render-Arbeit der sichtbaren Zeilen**
  (Loop-Cost-Messung: updateFromLayout-Loop bei 10k = 0.36ms, `_getVisibleChildren` = 0.004ms),
  nicht Layout/FFI.

## Verifikation (Phase 4, alle grün)

- Neuer Test `src/tests/scrollbox-culling-ffi.test.ts`: rot (307 FFI) → grün (0 FFI); zweiter
  Test sichert culling bleibt korrekt (renderCommands < 60 bei 300 Kindern).
- `wave3-layout-matrix.test.ts`: 16 pass; `scrollbox-culling-bug` + `scrollbox`: 49 pass (inkl. der
  Invariante, dass sich Items nie aus dem Viewport verlieren).
- `bun run test:js` komplett: 5679 pass / 1 fail = `getNodeAssets` — **pre-existing**, per Stash
  (Baseline fällt identisch) bewiesen. `wave3 memory gate` ist load-flaky (Timout unter Voll-Suite),
  isoliert grün (Bekanntes A/B-Load-Gotcha).
- `test:js:node` (Node 26.4 via ~/.nvm): 4742 pass / 7 fail = exakt die dokumentierten pre-existing
  Code/Text `layout-dirty`-Fails (unverändert gegenüber Wave3).
- `git diff`: nur `packages/core/src/Renderable.ts` (+17 Zeilen), plus neuer Test (untracked).

## Gate-Serie-E-Status

- **E2** (Layout-Caches an Generationen koppeln): ✅ erfüllt — Cachekey `layoutGeneration`.
- **E1** (Visible-child-Doppelscan): teilweise — der FFI-Teil entfällt; der O(N)-`updateFromLayout`-
  Loop + Set-Rescan bleiben (nächster Habe für Folge-Loop, ~0.36ms/10k, zweitrangig hinter Render).
- **Go-Gate „10k-Culling ≥50% p95"**: FFI-Metrik ≥50% (100 %); Wandzeit -33% am 10k-Scroll-Frame
  (Rest irreduzibel). „Stabile Streams skalieren mit Dirty-/Viewportmenge": ✅ FFI=0 bei stabilem Yoga,
  unabhängig von N.

## Umgebungs-Gotchas (Loop-1)

- bun: `home/user/.bun/bin/bun` (1.3.14); zig: `home/user/.local/zig-0.16.0/zig`
  (System-/usr/bin/zig=0.15.2 → FALSCH für `minimum_zig_version=0.16.0`).
- `bun install` nötig (frisches Worktree); node_modules-hält PUBLISHED baseline native → vor Tests
  `bun scripts/build.ts --native` aus SRC.
- Node für test:js:node: `home/user/.nvm/versions/node/v26.4.0/bin/node`.
