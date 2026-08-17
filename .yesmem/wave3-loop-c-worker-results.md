# Wave 3 Loop C — Worker-ACK, Latest-wins, Queue-/Bytegrenzen — Ergebnis

Stand: 2026-08-18

## 1. Provenienz
- Branch: `yesloop/wave3-worker-backpressure`
- Worktree: `home/user/projects/opentui/.worktrees/wave3-worker-backpressure`
- Basis-Commit (vor Änderung): `fccae2158d5c98949fc050913b918621af918111` (bestätigt)
- Finaler HEAD: `48f2fa19` (Loop-C-Runtime-Commit) — Mess-Doc-Kommit folgt
- Status: sauber außer untracked `packages/core/.yesmem/` (bereitgestellte Native-Assets, nie committed)
- OpenTUI: `@opentui/core@0.5.3`; Bun `1.3.14`; Node-Parität `v26.4.0` (via nvm, `requireNode26`-Seam geprüft)
- Native-SHA: `e7e9764462…` (nicht geändert; keine Native-/Zig-Änderung)

## 2. Commitfolge
1. `48f2fa19` perf(core): latest-wins tree-sitter buffer backpressure with versioned worker-ACK
2. Mess-Daten/-Report-Kommit (dieser) — separat nachgezogen

## 3. Geänderte Dateien (Ownership §7.2, nur eigene)
- `packages/core/src/lib/tree-sitter/client.ts` — Latest-wins-Controller (active+pending), ACK-Settlement, immer-on Metriken, Settle auf Failure/Destroy/Remove
- `packages/core/src/lib/tree-sitter/parser.worker.ts` — HIGHLIGHT_RESPONSE (versioned ACK) immer, auch ohne Captures (HANDLE_EDITS/RESET_BUFFER)
- `packages/core/src/lib/tree-sitter/types.ts` — `UpdateOutcome`, `UpdateQueueStats`
- `packages/core/src/lib/tree-sitter/client.test.ts` — 6 neue deterministische Held-Worker-Tests + Oracle-Test (RED/GREEN), Reset-/Lifecycle-Tests bleiben grün
- `packages/core/src/benchmark/wave3-worker-queue-benchmark.ts` — neue Worker-/Queue-Burst-Benchmark
- Rohdaten `.yesmem/bench/wave3-loop-c/`; Report `.yesmem/wave3-loop-c-worker-results.md`
Nicht angefasst (Ownership Dritter): `Code.ts`/`Code.test.ts`, `tree-sitter-styled-text.ts`, Loop-A-Telemetrie, TextBuffer/Native/Zig.

## 4. RED-Beleg
Neue Tests gegen unveränderten Code: `bun test -t backpressure` → **6 fail** (FIFO posted unbounded, kein `getUpdateQueueStats`, `updateBuffer`-Outcome undefined). Danach GREEN.

## 5. GREEN-Tests (echte Counts/Exitcodes)
- `bun test src/lib/tree-sitter/client.test.ts` → **65 pass, 0 fail** (59 Bestand + 6 neue; 436 expect)
- `bun run test:js` (gesamte JS-Suite) → **5544 pass, 23 skip, 0 fail** (198 Dateien)
- `bun run build:lib` → **OK**, Typdeklarationen generiert, `parser.worker.js` gebündelt, dist erzeugt
- `bun run test:js:node` → Typcheck: **nur 2 vorbestehende Fehler** in `src/renderables/Code.test.ts` (`requestPartialRender` nicht in `keyof CodeRenderable`). Diese Fehler sind **im fccae215-Baseline vorhanden** (Baseline-Worktree `wave3-baseline` enthält dieselbe Nutzung, Zeilen 1429/1457/1479) und liegen im Loop-B-Ownership (`Code.ts`/`Code.test.ts`), das Loop C nicht anfassen darf. Loop-C-Änderungen typechecken sauber (ein eigener Test-Typfehler wurde gefixt; verbleibend nur die Loop-B-Fehler).
- `bun run test:dist --skip-build` → vom selben vorbestehenden Loop-B-Typfehler blockiert (Abhängigkeit von Code.test.ts typecheck).

## 6. Messung (Queue-Hard-Gates §7.3/§7.4/§13.2)
Burst 100 same-turn Updates auf echtern Worker, Sample `runId 1787003877532` (Rohdaten in `.yesmem/bench/wave3-loop-c/wave3-loop-c-worker-queue.json`):

| Metrik | Wert | Gate §13.2 | Status |
|---|---|---|---|
| posted (Burst-Fenster) | 2 | ≤2 | PASS |
| superseded | 98 | ≥98 | PASS |
| completed | 2 | — | PASS |
| active HWM | 1 | ≤1 | PASS |
| pending Jobs HWM | 1 | ≤1 (1 active+1 pending) | PASS |
| pendingByteHighWater | 129 B | = neuester Payload, nicht Summe | PASS (neueste Einzelversion) |
| end-to-end (erste→letzte ACK) | 12.36 ms | — | Datenpunkt |

Latest-Version-Latenz-Burst `12.36 ms` (100 Updates, 2 Workerjobs). Der **≥30-%-Latenzvergleich gegen Baseline** sowie single-update-p95-Regressionsgrenze (absolute p50/p95 hier `0.81/7.28 ms`) werden durch den **Loop-A gepaarten Harness bei Integration** (balanceierte 30 Paare, Bootstrap-CI, frischer Prozess pro Arm) validiert; die strukturellen Queue-Gates sind hier deterministisch belegt.

## 7. Correctness-/Ownership-Belege
- Reduzierte 100-Burst auf 2 posted / 98 superseded belegt (Held-Worker-Test deterministisch).
- ACK einer älteren Version überschreibt keine neuere (Test).
- Zwei Buffer blockieren einander nicht (globale Latest-wins-Policy existiert nicht; state ist per-Buffer).
- Destroy/Worker-Exit settlen active+pending genau einmal, `works` geleert (Tests).
- Inkrementelle `tree.edit`+`parse(content, oldTree)`-Semantik erhalten (`edits` akkumuliert, neuester Content; Real-Worker-Oracle-Test grün).
- Output inkl. Injection/Conceal/Links: unveränderte Worker-Highlight-Berechnung; `HIGHLIGHT_RESPONSE` wird jetzt immer (auch leer) als versionierter ACK geliefert → volle Highlightsemantik pro Version.

## 8. PASS/FAIL/UNCLEAR
- Queue-/Byte-Gates (posted ≤2, superseded ≥98, HWM 1+1, pendingBytes=neueste Version): **PASS** (deterministisch)
- Correctness (Settlement einmalig, no-overwrite, Multi-Buffer, Output-Oracle): **PASS**
- `test:js:node`/`test:dist`-Typcheck: **FAIL nur durch vorbestehenden Loop-B-Typfehler in `Code.test.ts`** (nicht Loop-C, nicht durch Loop C verursacht; im `fccae215`-Baseline nachgewiesen) — für Loop C als Blockade dokumentiert
- Latenz-Gate ≥30%: **UNCLEAR bis Integration** (Loop-A paired harness; einzelne Datenpunkte geliefert, keine frischen-Prozess-Paarung in diesem Loop)

## 9. Grenzen / nicht erledigt
- C5 (kompakte Spans/Transferables) **bewusst NICHT** in diesem Commit (§7.5): erst nach D-Reintegration-Profil; Transferlisten nur über portablen Seam — `PlatformWorkerHandle.postMessage(value)` hat keine Transferliste, kein Bun-only-Transfer.
- `test:js:node`/`test:dist` sind durch den vorbestehenden Loop-B-Typfehler (Code.test.ts `requestPartialRender`) blockiert; wird nach Loop-B-Umbau/Integration grün.
- Absolute p95-Single-Update und Latenz-Claim sind Datenpunkte, kein A/B-Gate (Integration durch Loop A).

## 10. Kein zurückgebliebener Bun-Prozess
Testläufe via `timeout` mit TERM/KILL; kein verwaister Bun-Worker dokumentiert. (Stichprobe `ps -C bun` bei Abschluss.)

## 11. Bestätigung
- Ownership eingehalten; nur Loop-C-Dateien + loop-eigene Belege committed.
- Kein `.so`/Heapdump/privater absoluter Assetpfad.
- Branch endet clean (bis auf bereitgestellte, nicht committede Native-Assets); kein Merge nach main (Integration durch Koordinator).
