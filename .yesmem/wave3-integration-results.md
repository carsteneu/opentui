# Wave 3 — Integrationsergebnis (stabile Zwischenversion)

Stand: 2026-08-18 (coordinator review + integration)

## 1. Provenienz

- Branch: `yesloop/wave3-streaming-integration`
- Worktree: `home/user/projects/opentui/.worktrees/wave3-integration`
- Basis: `fccae2158d5c98949fc050913b918621af918111` (`@opentui/core@0.5.3`)
- Integrations-HEAD: `917ef5f7` (nach A→C→B→D-Cherry-Picks + Formatgate)
- Native SHA (gepinnt): `e7e9764462f2ee7f2c808856b60101ff659c6bda4a1df7cf235e418cf481a15c` (gestaged, Symbol vorhanden)
- Runtime: Bun 1.3.14; Node 26.4.0 (Repo-Seam)
- Reihenfolge gem. Plan §11.2: A → C → B → D (Schritt 4 B↔C bewusst ausgelassen, s. §7)

## 2. Einzelresultat der vier Loops

| Loop | Inhalt                                                        | Branch-HEAD (cherry-gepickt) | Verdict                |
| ---- | ------------------------------------------------------------- | ---------------------------- | ---------------------- |
| A    | D3–D5 Streaming-E2E-/Attributions-Harness + opt-in Telemetrie | `0f63c522` (5 Commits)       | PASS (Harness)         |
| C    | C2/C6 Worker-ACK, Latest-wins, Queue-/Bytegrenzen             | `9034ff74` (5 Commits)       | PASS (deterministisch) |
| B    | C1/C4 CodeBuffer-Consumer + Stale-Supersede                   | `ee2a1c1e` (2 Commits)       | PASS (Consumervertrag) |
| D    | C3 algorithmischer Chunk-Sweep (Sweep-Line)                   | `2c4ae562` (2 Commits)       | PASS (Differential)    |

## 3. Was gilt nach Integration (verifiziert durch echte Läufe)

### 3.1 Deterministische Teilgates — PASS

- **Queue/Backpressure (§13.2):** ≤1 active + 1 pending/Buffer; 100 same-turn Updates → 2 Jobs, ≥98 superseded; pendingBytes = neueste Version (129 B, nicht Summe). Versioned-ACK, once-Settle, no-overwrite. (Loop-C-Tests 66/66 in Integration)
- **Converter 1k (§13.2):** p95 5.5 ms < 8 ms. **Converter 5k:** inject-adversarial p50-Ratio 0.21–0.48 (≥50 % Ziel). (Loop-D — AX-Anker: `tree-sitter-styled-text.ts` in fastpatch/fccae215 byte-identisch, SHA verifiziert)
- **Stale correctness (§13.2):** Version-Check vor Convert UND vor Commit; genau eine finale sichtbare Generation. (Loop-B-Session/Consumer-Tests)
- **Output (§13.2):** Differential θ0-Mismatches (Loop-D Oracle: 28520/19600 Chunks byte-identisch); C-Output inkl. Injection/Conceal/Link (Worker-Berechnung unverändert).
- **Format/Lint:** `fmt:check` grün, `lint` 0/0, `git diff --check` grün.

### 3.2 Funktionstests in Integration

- Kombinierte A+B+C+D-Fokustests: **233 pass / 0 fail** (8 Dateien)
- Vollsuite `test:js`: **5592 pass / 23 skip / 0 fail** (203 Dateien) — keine durch die Integration eingeführte Regression
- `build:lib` (Typecheck+Deklarationen): **EXIT 0**
- `test:dist --skip-build` (Node 26, packed ESM+CJS+smoke): **grün**
- `test:js:node`: vorbestehender Code.test.ts-Typecheck-Fehler ist in der Integration **behoben**; darunter liegende Yoga-/TextBuffer-Runtime-Reds (`Promise pending`) sind **Wave-3-fremd** (TextBuffer/Yoga-Ownership), in der Baseline durch den früheren Typecheck-Abbruch maskiert.

## 4. Primärclaim §13.1 — UNCLEAR (kein synthetischer PASS)

- Upper bound des familywise 95-%-Bootstrap-CI der gepaarten Änderung (aufsummierte disjunkte Main-Thread-Stufen bzw. Update→styled Commit p95 ≤ −30 %) ist **aktuell nicht belastbar messbar**:
  - Host-Load zum Messfenster **9.4** (Ziel < ~4 für ruhige Endmessung, §2.5).
  - Die von Loop A eingefrorene Baseline-Rohdatei selbst lief bei **Load 23, n=2** — erfüllt nicht das §13.1-Protokoll (30+ balancierte Paare, frischer Prozess, Bootstrap-CI).
- **Folge:** Primärclaim auf den E2E-Renderpfad = **UNCLEAR**, kein GO auf Basis der aktuellen Werte.
- **Nicht betroffen:** alle deterministischen Teilgates oben (lastunabhängig) bleiben PASS.

## 5. C5-Profilentscheidung — Deferred

- C5 (kompakte Spans/Transferables) nicht umgesetzt (§7.5): erst nach Reintegrationsprofil, plus portabler Bun-/Node-Seam (current `postMessage(value)` hat keine Transferliste; Bun-only-Transfer verboten). Hier dokumentiert als Deferred, kein Commit.

## 6. Startup-Safety (§13.2 Startup/Cold Import)

- Nicht erneut als gepaartes Gate gemessen (gleiche Host-Regel wie §4, UNCLEAR). Wave-3-Runtimeänderungen (C+client+D+Code) berühren den Cold-Import-Pfad nicht direkt; Loop-A-Telemetrie ist off-state ein Guard. Kein Regression für die Length-Ausnahme gezeigt, aber als UNCLEAR geführt bis ruhige Messung.

## 7. Schritt 4 (B↔C-Verbindung) — bewusst ausgelassen, als Routing-Backlog dokumentiert

**Nutzer-Entscheidung (2026-08-18):** Schritt 4 nicht in diese stabile Version — erst gegen das funktionierende Integrations-Stand referenzieren.

- **Status:** Der versionierte Buffer-/ACK-Pfad von Loop C ist gebaut und korrekt, aber `CodeRenderable` treibt weiterhin `highlightOnce` (Code.ts:102) — der Bufferpfad ist event-basiert, kein Drop-in für die promise-basierte `highlight()`-Signatur.
- **Nicht-Wirksamkeit:** Ohne Umhängung im Renderpfad ist der Streaming-Latenzgewinn (Update→styled Commit) im Renderer **nicht aktiv**; die Queue-/ACK-/Backpressure-Absicherung gilt unabhängig davon.
- **Voraussetzungen für den Umbau (wenn gewünscht):** Adapter-Bridge (Buffer-Event→Promise-`CodeHighlightSource`), Oracle-Differentialtest (Injection/Conceal/Link vs `highlightOnce`), kein zweiter Queueowner (§11.3), schnellere Single-Update- und Burst-Zeit.

## 8. Entscheidung / Status

- **Stabile funktionale Zwischenversion: JA** — A+B+C+D integriert, Vollsuite grün, Format/Lint/Dist grün.
- **Wave-3-Gesamt: PARTIAL-GO / UNCLEAR** — Teilgates PASS (Safety-Achsen C+D sauber ausgeliefert); Primärclaim §13.1 UNCLEAR (Host-Load/n=2-Baseline) + Schritt-4-Renderpfad noch nicht aktiv.

## 9. Offen / nächste Schritte

1. Clean-Host-Endmessung der §13.1-Matrix (30+ Paare, Bootstrap) gegen `wave3-baseline@fccae215`.
2. Entscheidung über Schritt 4 (Consumer-Drainingspfad auf versionierten Buffer-/ACK-Vertrag) — Referenzbasis ist diese stabile Version.
3. Danach Wave-4-Zuschnitt.
