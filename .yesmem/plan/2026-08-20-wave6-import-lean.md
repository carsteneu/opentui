# Wave-6: Import-Block-Entschlackung (Hebel 2)

Datum: 2026-08-20 · Status: GEPLANT · Basis: fastpatch HEAD c13f0b64 (post-Wave-5)

## 1. Ziel

Den Import-Block des Kaltstarts (gemessen ~43–50 ms p50 im Startup-Gate/Probe) reduzieren,
indem Module, die auf dem First-Frame-Pfad NICHT gebraucht werden, aus dem statischen
Entry-Graph von `renderer-entry` entfernt und lazy nachgeladen werden (dieselbe
Staged-Philosophie wie Wave-5, diesals für den JS-Modulgraph).

Primärziel (Startup-Gate, gepaart, n=16): Import p50 ≤ −25 % UND TTFMF p50 ≤ −10 %
(beides CI ohne 0; TTFMF-Probe ~131 → ≤ ~115 ms).
Hartes Floor-Gate: CPU-Gate cold/warm unverändert (kein Trap-/Lazy-Stall im
Streaming-Pfad — Lektion aus Wave-5 Runde 1!), test:js/test:dist grün.

## 2. Evidenzbasis (gemessen 2026-08-20 15:22, /tmp/opencode/import-breakdown.ts, je 3 Kaltprozesse)

| Modul (kalt, isoliert) | ms p50 |
|---|---|
| renderer-entry (Produktions-Entry) | ~52 |
| zig.ts allein | ~37 (streuend 31–55 unter Last) |
| renderable-entry / Text.js | ~41–43 |
| console-entry | ~44–54 |
| tree-sitter/client allein | ~22 |
| testing (nur Referenz) | ~55 |

Alle schweren Module überlappen im renderer-entry-Graph. Bekannte statische Sünden
(Wave-2-Loop-B-Erkenntnis, unverändert): `renderer.ts` importiert statisch
`TerminalConsole` (console-Entry-Graph) und `destroyTreeSitterClient`
(tree-sitter-Client-Graph, ~22 ms allein) — beides für den ersten Frame NICHT nötig.

## 3. Design

### 3.1 Analyse zuerst (M1)

- Statischer Import-Graph-Audit von `renderer-entry.ts` (und `renderable-entry`,
  `console-entry` als Sekundärziele): `bun build --target=bun` Bundle-Analyse oder
  manuelle Transitiv-Kontrolle; Ausgabe: geordnete Kostenliste pro Top-Level-Modul.
- Klassifikation jedes Moduls: FIRST-FRAME (Frame 1 braucht es), CTOR (Renderer-Ctor
  braucht es, Frame nicht), LAZY (erst bei Feature-Nutzung: consoleMode, tree-sitter/
  CodeRenderable, image, audio, markdown).
- Trace-Abgleich mit Wave-5-CORE-Symbol-Trace (packages/core/.yesmem/bench/
  wave5-symbol-access-trace.json): was JS-seitig zum ersten Commit führt.

### 3.2 Eingriffe (M2, nur Seams die existieren)

- `renderer.ts`: `TerminalConsole` + `destroyTreeSitterClient` von statisch auf
  dynamischen Import am Nutzungs-/Destroy-Pfad (async destroys sind im Lifecycle
  bereits etabliert — Wave-1-Oracles bewachen das).
- Entry-Lazyfizierung wo öffentlich vertretbar: re-exportierende Entries dürfen
  NICHT brechen (package-entrypoints-Snapshot!). Keine neuen Entry-Dateien ohne
  Snapshot-Update; keine neuen Root-Exports (Barrel-Leak-Invariante).
- zig.ts-Importkosten: PRÜFEN ob renderer.ts nur Typen + resolveRenderLib braucht
  (beide lazy-tauglich: resolveRenderLib ist eh lazy). Type-only-imports sind
  erased — falls value-imports existieren, auf Typen + lazy-Funktion reduzieren.
- KEINE Verrenkungen: was nach Analyse FIRST-FRAME/CTOR ist, bleibt statisch.

### 3.3 Nicht-Ändern

- Kein RenderLib-Interface-Change, kein Zig-Change, keine neuen Dependencies.
- Kein Umbau der Entry-Datei-Struktur aus Wave 2 ohne Snapshot-Konsistenz
  (package-entrypoints.test.ts + root-export-surface).
- Kein lazy dlopen-Thema (Wave 5 erledigt) — hier geht es NUR um JS-Modulgraph.

## 4. Meilensteine

### M1 — Graph-Audit + Kostenliste (Evidenz, committed)
- `packages/core/.yesmem/bench/wave6-import-graph.md`: geordnete Modulkosten +
  FIRST-FRAME/CTOR/LAZY-Klassifikation + Transitivliste der Sünden.
- RED-Test #1 (neu `src/tests/renderer-entry-lean.test.ts`): renderer-entry
  transitiv-NICHT-importiert console-Implementierung/tree-sitter-client
  (via bun modulgraph-introspection oder Fixture-Kind wie Wave-5-#1).

### M2 — Implementierung + Tests
- GRÜN #1; zusätzlich:
  - #2 destroyTreeSitterClient-Lazy-Pfad bleibt lifecycle-oracle-konform
    (existierende Lifecycle-Suiten decken das).
  - #3 consoleMode-Aktivierung funktioniert mit lazy TerminalConsole
    (renderer.console-startup.test.ts erweitern falls nötig — CI-gated analog R-07).
- Gates: fokussierte Suiten + `bun run test:js` voll + tsc-noEmit (node-test).

### M3 — Messung & Abnahme
- Startup-Gate A/B n=16: Import p50 ≤ −25 %, TTFMF p50 ≤ −10 %, beide CI ohne 0.
- CPU-Gate n=10: alle Budgets gehalten (Update: Wave-5-Lektion — LAZY-Module, die
  der Streaming-Pfad beim ERSTEN Job triggert, müssen entweder CORE der Welle sein
  oder nach erstem Commit nachgeladen werden; workerWaitMs-Rawkontrolle).
- Startup-Probe 5 Kaltprozesse dokumentieren (wave5-startup-breakdown läuft weiter,
  importMs-Feld ist die Zielmetrik).
- Report `.yesmem/wave6-import-lean-results.md` + Ledger §11.5.

## 5. Abnahme / Gates

| Gate | Kriterium |
|---|---|
| Startup-Gate Import p50 (paired) | ≤ −25 %, CI ohne 0 |
| Startup-Gate TTFMF p50 (paired) | ≤ −10 %, CI ohne 0 |
| CPU-Gate cold/warm | innerhalb Budgets; workerWaitMs-Delta < +40 ms |
| Entry-/Export-Oberfläche | Snapshots grün (package-entrypoints, root-export-surface) |
| test:js / test:dist / fmt / lint | grün |

## 6. Risiken & Gegenmaßnahmen

- **Lazy-Stall im Streaming-Pfad** (Wave-5-Runde-1-Muster): jedes LAZY-Modul gegen
  den cold-1000-Pfad prüfen; CPU-Gate + workerWaitMs-Rawanalyse ist Abnahmekriterium.
- **Zirkuläre Abhängigkeiten** bei dynamischen Imports: Analyse in M1; dynamischer
  Import bricht Zyklen nicht, verschiebt sie — wenn renderer↔console-Zyklus existiert,
  das Seam-Modul (platform/console-seam) nutzen statt Hebeln.
- **Entry-Oberflächen-Breakage**: jede Entry-Änderung läuft gegen beide Snapshots;
  bei Rot: Snapshot-Update ist OK NUR wenn die öffentliche API gleich bleibt
  (Re-Export-Form darf ändern).
- **Node-Distanz**: node-side entries weiter statisch lassen falls node-Import
  anders auflöst (portability-Invariante).

## 7. Loop-Topologie & Worktree

- Ein Loop: Worktree `.worktrees/wave6-import-lean`, Branch `yesloop/wave6-import-lean`,
  ab fastpatch c13f0b64 (exaktes SHA beim Abspalten fixieren).
- Merge & Ledger & formale Verifikation: Koordinator (Wave-4/5-Muster).

## 8. Evidenz-Vertrag

Artefakte unter `packages/core/.yesmem/bench/wave6-*` mit Provenanz; Messungen bei
Last-Peak >6 als UNCLEAR markieren; Kaltmessungen 1 Prozess pro Lauf.

## 9. Eskalation an Koordinator

- Import p50 sinkt < 15 % trotz korrekt klassifizierter Sünden (dann dominiert
  Bun-Runtime/Transpiler-Parsing, nicht der Graph — Hebel endet dort).
- renderer↔console-Zyklus ohne Seam-lösbaren Pfad.
- Entry-Snapshot kann nur mit öffentlichem API-Bruch grün werden (dann STOPP).
