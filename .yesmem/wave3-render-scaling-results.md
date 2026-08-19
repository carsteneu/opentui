# Wave 3 — Loop D: Layout-/Partial-Render-Skalierungs-Messung

- Stand: 2026-08-19
- Branch: `yesloop/wave3-render-scaling`
- Worktree: `home/user/projects/opentui/.worktrees/wave3-render-scaling`
- Basis-Commit (ab2b9ebc): `yesloop/wave3-render-scaling@ab2b9ebcdc7bb56cbfe7e00f871351d1aa4de325` (`v0.5.3-112`)
- Native-Candidate (unverändert, C9-fähig): `deacf8067c0078664c30931020172bfcf2f601549816fe4a849e5d042da73804`
- Tooling: Bun 1.3.14, Node v26.4.0 (nvm-seam), Zig 0.16.0

## Scope-Abgrenzung

Loop D **misst und attribuiert** die Skalierung des Layout- und des Partial-Rende-Rouths für große
Renderbäume; es **implementiert keine E-/F-Optimierung** (diese ist Wave 4). Die Produktionspolitik für
Layout, Render-List, Culling und Partial-Composition bleibt unverändert. Loop D fügt ausschließlich
additive, opt-in Zähler/Spans in `renderer.ts` und `Renderable.ts` hinzu, die im Off-Zustand (nicht
angehängt) einen Null-Guard mit Null-Allokation sind.

## Ergebnis-Kurzfassung

Loop D ist funktional. Die Skalierungs- und Sicherheits-Oracles sind eingerichtet und grün, die
Attributions-Counter liefern ein aussagekräftiges, reproduzierbares Skalierungsprofil für Layout und
Partial-Render.

**Wichtigster Attributions-Befund (R-08-Kandidat):** Beim Viewport-Culling hält der Render-List-Build
die besuchten Nodes und Render-Commands konstant (unabhängig von der Gesamtzahl der Scrollbox-Kinder),
aber `updateFromLayout` (die FFI-Roundtrips auf `getComputedLayout`) und die gemessene Layoutzeit
`layoutMs` skalieren linear mit **allen** Scrollbox-Kindern — nicht nur mit den sichtbaren. Das ist ein
belastbares, counter-belegtes Signal für potenziell vermeidbare Arbeit bei sehr großen culled Bäumen.
Genaue Prozentwerte und ein Regressions-Gate hierfür folgen im gemessenen Wave-4-Fenster; Loop D
dokumentiert den Befund und den Messpfad, es setzt keinen neuen Regressions-Gate-Prozentsatz fest.

**R-09 (Partial-Sicherheit):** bestätigt. Isolierte, teilnahmeberechtigte Edits werden als begrenzte
Region akzeptiert (`partialAccepted>0`, `regionArea>0`, kein Full-Frame); transitive (transluzente
Vorfahren, überlappende spätere Painter) Fälle werden korrekt zu einem Full-Frame gezwungen
(`frameCounts.full>0`, `regionArea=0`, `partialRejectedBy`-Gründe gesetzt). Keine Abweichung gegen die
bestehenden Oracles (`renderer.partial-render.test.ts` unverändert grün).

## Warum kein Wanduhr-A/B im Report

Das serielle Messfenster (Plan §2/§5) wird zum Laufzeitpunkt dieses Reports von Loop B genutzt
(`wave3-cpu-probe` aktiv, hosts Load ~8–10). Loop D führt deshalb in diesem Fenster **keine** formalen
n=30-Wanduhr-A/B-Läufe gegen die eingefrorene Baseline durch; es erzeugt stattdessen die
Attributions-Samples + Provenance. Ein formaler Wanduhr-A/B (Baseline fccae215 vs. Candidate ab2b9ebc)
gehört in das serielle Messfenster und wird dort durch den Runner erzeugt (`--frames N`).

## Messfähigkeit (hinzugefügt, additiv)

### Instrumentierung — `renderer.ts`
- `scalingCounters: Wave3ScalingCounters | null` (Feld; Off-Zustand = `null`).
- `attachWave3ScalingCounters(counters | null)` und `resetWave3ScalingCounters(counters)`.
- Zähler: `frameCounts.{full,partial,followup}`, `partialAccepted`, `partialToFullPromotions`,
  `partialRegionAreas` (bounded Region), `commitMs` (native `render`/`renderPartial`).
- Attribute Sicherheits-Oracles auf Basis der bestehenden Guard-Logik (keine Produktionslogik geändert).

### Instrumentierung — `Renderable.ts`
- `Wave3ScalingCounters`-Interface + `createWave3ScalingCounters()`-Factory + `ScalingCounterHost`-Cast
  (Renderer ist der `RenderContext`, daher ohne types.ts-/RenderContext-Änderung).
- `scalingCounters()`-protected-Accessor, Null-Guard an jedem Messpunkt.
- Zähler: `visitedStableNodes`, `updateFromLayoutFfiCalls`, `layoutGenerations`, `dirtySubtreeLayouts`,
  `renderListRebuilds`, `renderListReuses`, `renderCommands`, `hasSafePartialCompositionCalls`,
  `scannedLaterPainters`, `boundsWalks`, `partialRejectedBy{reason}`, `layoutMs`, `jsRenderMs`.
- `performance.now()` ist global verfügbar (kein Import nötig).

### Benchmarks & Runner (neu)
- `src/benchmark/wave3-layout-matrix.ts` + `.test.ts` — Layout-Matrix (§10.3) mit zwei
  Attributions-Buckets: Initial-Build (Render-List-Rebuild) vs. Steady-Serie.
- `src/benchmark/wave3-partial-matrix.ts` + `.test.ts` — Partial-Matrix (§10.4) mit accepted/rejected/
  region-Attribution und Policy-Oracles.
- `scripts/wave3-render-scaling.ts` — Runner mit Provenance-Gate (sourceCommit; native SHA aus der tatsächlich geladenen
  Paket-Native bevorzugt, dann staged, sonst klar markierte Pinned-Candidate-Konstante), schreibt JSON nach
  `.yesmem/bench/wave3-render-scaling/` und druckt Zusammenfassung.
- package.json: `bench:wave3:render-scaling` ergänzt.

## Attributions-Tabelle (Layout, width=160, height=44)

Die Werte sind **Diagnose-/Attributions-Werte** aus dem Runner (`--frames 1`), nicht abgesicherte
Wanduhr-Benchmarks. `initialV` = besuchte Nodes im Initial-Build, `steadyV`/`ffi` = pro Steady-Serie,
`cmds` = renderCommands, `jsMs`/`layoutMs` = gemessene Zeiten in Millisekunden.

| Szenario                      | Nodes | initialV | steadyV | FFI  | cmds | layoutGen | dirty | jsMs  | layoutMs |
| ----------------------------- | ----- | -------- | ------- | ---- | ---- | --------- | ----- | ----- | -------- |
| stable-siblings-10            | 21    | 22       | 22      | 22   | 22   | 1         | 1     | 0.14  | 0.04     |
| stable-siblings-1000          | 2001  | 2002     | 2002    | 2002 | 2002 | 1         | 1     | 3.21  | 1.41     |
| stable-siblings-10000         | 20001 | 20002    | 20002   | 20002| 20002| 1         | 1     | 33.34 | 16.22    |
| streaming-child-1000-fixed    | 1001  | 1002     | 1002    | 1002 | 1004 | 1         | 1     | 0.26  | 0.50     |
| streaming-child-1000-autoheight| 1001 | 1002     | 1002    | 1002 | 1004 | 1         | 1     | 0.43  | 0.73     |
| culling-100                   | 101   | 51       | 51      | 107  | 53   | 1         | 1     | 0.06  | 0.12     |
| culling-1000                  | 1001  | 51       | 51      | 1007 | 53   | 1         | 1     | 0.12  | 1.08     |
| culling-5000                  | 5001  | 51       | 51      | 5007 | 53   | 1         | 1     | 0.16  | 5.11     |
| culling-10000                 | 10001 | 51       | 51      | 10007| 53   | 1         | 1     | 0.15  | 11.74    |
| dirty-leaf-100-depth-1        | 102   | 103      | 103     | 103  | 103  | 1         | 1     | 0.02  | 0.04     |
| dirty-leaf-100-depth-50       | 151   | 152      | 152     | 152  | 152  | 1         | 1     | 0.12  | 0.06     |
| interactions-100              | 201   | 202      | 202     | 202  | 202  | 1         | 1     | 0.06  | 0.15     |

**Lesart der Culling-Zeilen:** mit aktivem `viewportCulling` bleibt `steadyV` (51) und `cmds` (53)
konstant, während `FFI` von 107 (100 Kinder) auf 10007 (10000 Kinder) wächst und `layoutMs` von 0.12
auf 11.74 ms skaliert. `updateFromLayout` läuft über alle Kinder des Scrollbox als Teil des
Layout-Durchgangs, nicht nur über die im Viewport. Das ist der präzise Ansatzpunkt für Wave-4-E-
Optimierung (FFI-Roundtrip-Reduktion im culled Layout).

## Attributions-Tabelle (Partial, width=160, height=44)

| Szenario                          | accepted | regionArea | rejectedBy                   | full | partial |
| --------------------------------- | -------- | ---------- | ---------------------------- | ---- | ------- |
| partial-10rows-opaque-isolated    | true     | 8          | {}                           | 0    | 1       |
| partial-2000rows-opaque-isolated  | true     | 8          | {}                           | 0    | 1       |
| partial-10000rows-opaque-isolated | true     | 8          | {}                           | 0    | 1       |
| partial-100rows-translucent       | false    | 0          | {"translucent-ancestor":1}   | 1    | 0       |
| partial-100rows-opaque-overlap    | false    | 0          | {"overlap-later-painter":1}  | 1    | 0       |
| partial-100rows-opaque-deep       | true     | 8          | {}                           | 0    | 1       |

**Lesart:** Die Partials kalibrieren korrekt — isolierte Edits bleiben begrenzt (Regionfläche 8 Zellen,
unabhängig von der Hintergrundzeilenzahl), Politikerzwingende Fälle (transluzenter Vorfahr,
Überlappung) werden zu Full-Frames mit gesetztem Rejection-Grund. `partialToFullPromotions` bleibt 0 in
diesen Mustern (die Promotion zählt nur den seltenen Fall eines während des Partial ausgelösten
Full-Rerenders — korrekt, da die Rejections hier bereits am Frame-Guard `canPartialRender` abgefangen
werden). `regionArea` ist fix 8 (5+6×1-Zielbox), wie erwartet.

## Verifikation

Ausgeführt in `packages/core`:

- `bun test src/benchmark/wave3-layout-matrix.test.ts src/benchmark/wave3-partial-matrix.test.ts`
  → **9 pass, 0 fail** (Attributions-/Oracles-Tests).
- `bun test src/tests/renderer.partial-render.test.ts src/tests/renderable.test.ts src/testing/test-renderer.wait.test.ts`
  → **106 pass, 0 fail** (bestehende Sicherheits-Oracles unverändert grün).
- `bun run build:lib` → grün (dist gebaut, keine TS-Fehler).
- `bun run bench:render-traversal` → grün, unabhängig konsistent mit dem Loop-D-Culling-Befund
  (`scrollbox_culling_scaling`: layoutOnlyBoxes bleibt 2, Gesamtzeit wächst mit allen Kindern).
- `bun run test:js` → **5630 pass, 0 fail, 23 skip** (voller JS-Testlauf; nach package.json-Typofix).
- `bun scripts/wave3-render-scaling.ts --frames 1` → schreibt Attributions-Samples (JSON) mit
  Provenance (sourceCommit ab2b9ebc, native deacf806).

Noch offen (folgt in diesem Loop bzw. im seriellen Fenster):
- Formaler Wanduhr-A/B (n=30, Bootstrap-Gate) gegen Baseline fccae215. Dieser wird wie dokumentiert im
  seriellen Messfenster erzeugt, NICHT während der aktiven Loop-B-Messung (§2/§5).

## Rohdaten

- `.yesmem/bench/wave3-render-scaling/wave3-render-scaling-*.json` (Provenance + Layout-/Partial-Samples).
