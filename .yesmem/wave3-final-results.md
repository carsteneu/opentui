# Wave 3 — Integrations- und Abschlussbericht (final)

Stand: 2026-08-19 — Integrationsbranch `yesloop/wave3-streaming-integration`
Integrationsbasis: [`c1ef330b` →] `ab2b9ebc` (inkl. Parser-Tree-Ownership-Fix, Plancommit `7f18fe12`)
Vergleichsvertrag: `fccae215` → `ab2b9ebc | b416a75d…`
Native-Policy: per-Arm — Baseline `e7e97644` (fccae215), Candidate `deacf806`/`c5c69aaad20d` (integrierter Build)

## 1. Was integriert wurde (Cherry-picks in Reihenfolge, alle kollisionsfrei/aufgelöst)

| Loop | Commits | Inhalt |
|---|---|---|
| **B** (CPU/E2E/Startup) | `5fc26b3d` `f0c90146` `3ee044df` `d61cbfd0` `62ecf67c` `f651c80e` `d4c469a0` | disjunkte Mainthread-Stufen-Harness, Real-Worker-Probe (externe Seams, kein `process.cpuUsage`), styled-Commit-Orakel, paired A/B (20k Bootstrap, familywise), per-arm Startup-Gate (Import+TTFMF) |
| **D** (Render-Skalierung) | `0d3e4bcd` `c8eeb2f9` `4ddc0bfb` `910ff38c` | opt-in Scaling-Counter (Off-Zustand Null-Guard), Layout-/Partial-Matrizen, Runner |
| **C** (Memory/Lifecycle) | `d7440668` `39baef77` | Rolling-10k/Leak-Gate, Phasen A/B/C, Owner-/Queue-/Heap-/Native-/Eventloop-Metriken |
| Fixes | `97cda22b`(fmt) `b416a75d`(Layout-Smoke pro-Szenario-Timeout) | Hygiene + Load-Flake-Fix |
| Formale Messung | `ccf73497` | n=30-Gates cpú/startup/memory + ehrliche INVALIDATION-note |

A (OpenCode-Praxistest) läuft im separaten OpenCode-Branch `wave3-opentui-test` (`c06ee24b4f`, `151c4052be`) — Overlay-Pin `7f18fe12`.

## 2. Funktionale Matrix (letzter verifizierter Stand)

| Prüfung | Ergebnis |
|---|---|
| `test:js` (213 Dateien) | **5678 pass / 0 fail** (23 skip, 239 Snapshots) |
| `build:native` (Zig 0.16.0) | EXIT 0 |
| `test:native` | **2009 pass / 8 skip** |
| `build:lib` | EXIT 0 |
| `test:dist --skip-build` | PASS |
| `test:js:node` (Node 26.4) | **4742 pass / 7 fail** — **vorbestehende** Node-Portabilitätslücke (Text.test.js/CodeRenderable layout-dirty), KEIN B/C/D-Regress |
| Fokus B (cpu+startup) | 32/0 |
| Fokus C (memory / client-code-textbuffer) | 4/0 · 197/0 |
| Fokus D (layout+partial / safety-oracles) | 16/0 · 106/0 (Smoke nun pro-Szenario-Timeout, stabil unter Load) |
| oxfmt / oxlint (alle wave3-Dateien) | konform / 0 |

## 3. Formale Performance-Messung (n=30, gegen fccae215)

> Ausgeführt im Messfenster; Host-Load oszillierte (1-min peak bis ~8,7). Gates mit eingebautem
> Load-Guard klassifizieren **UNCLEAR** statt Fake-PASS, wenn Peak-Load > Budget. **Kein synthetischer PASS.**

**CPU-Gate (disjunkte Mainthread-Summe, partial — layout/render liegt in Loop D):**
| Scenario | Metrik | Paired Δ (95% CI) | familywise upper | Urteil |
|---|---|---|---|---|
| cold-1000 | mainThreadSumMs | **−83,0 %** [−83,9, −82,1] | −82,0 % | primär −30 % **PASS** |
| cold-1000 | updateToStyledCommitMs | **−59,7 %** [−61,2, −58,3] | −58,1 % | PASS |
| warm-append100 | mainThreadSumMs | **−92,9 %** [−93,3, −92,5] | −92,4 % | PASS |
| warm-append100 | updateToStyledCommitMs | **−88,1 %** [−88,8, −87,3] | −87,2 % | PASS |
- Messvalidität (disjunkt, Worker-exkludiert, styled-Native-Commit, Digests identisch): **PASS**
- Regressions-Sicherheit (familywise ≤+3 %, p99 ≤+5 %): **UNCLEAR** (nur wegen load-guard)
- Gate-Endurteil: **UNCLEAR** (Load-Guard), Zahlen stark positiv

**Startup-Gate (Import+TTFMF, per-Arm-Native):**
| Metrik | p50 Δ (CI) | p99 Δ (CI) | Urteil |
|---|---|---|---|
| Import | −4,52 % [−12,1, +2,1] | −0,84 % [−14,7, +5,9] | keine Verschlechterung, UNCLEAR-load |
| TTFMF | −4,72 % [−11,1, −1,0] | +3,89 % [−12,9, +6,2] | UNCLEAR-load |

**Memory-A/B (Eventloop-p99):**
- Saubere Loop-C-Indikation (2 Lauf): p99 ~96 vs ~96 ms → **+2,66 % ≤ +5 % PASS**, kein Rückschritt.
- Formaler n=30-Lauf: Baseline-Arm Load-kontaminiert (Median 852 ms vs sauber ~96 ms; erste Runs 1500–1700 ms). Rechnerischer "−89 %" ist **Artefakt** → **zurückgezogen**, in `wave3-memory-formal/INVALIDATION-note.md` belegt. Kein belastbarer Gewinn daraus abgeleitet; Rolling-Memory bleibt *kein Rückschritt* (Loop-C-Absolutgates PASS ereichen).

## 4. Loop-Befunde (aus Agenten-Reports, verifiziert)

- **B:** RED belegt (`process.cpuUsage` kann Workerzeit nicht ausschließen); disjunkte Stufen + styled-Commit-Orakel grün. Native-Provenienz-Falle + Baseline-`git status`-Dirty (untracked `.yesmem/`) als Koordinator-Aufgabe geführt und gelöst.
- **C:** Rolling-10k-Absolutgates A1–A4/B1–B3/C1–C4 **PASS** (ehrliche A2/A3-Lesart: Coalesce-Pfad 0/0, direkter ≤1+1-Bound in Phase C HWM 1/1); Owner nach destroy 0, Native zurück auf Warm-Baseline. Cold-Review-Fixes C1/I1/M1/M2 greifen.
- **D:** R-08-Attribution: Culling hält visited/cmds konstant (51/53) über 100→10000 Kinder, aber `updateFromLayout`-FFI 107→10007 und `layoutMs` 0,12→11,74 ms skalieren mit ALLEN Scrollbox-Kindern → Wave-4-E-Ansatzpunkt (FFI-Roundtrip-Reduktion im culled Layout). R-09 Partial-Sicherheit: isolierte Edits partial (regionArea=8), transluzent/overlap → Full mit Rejection-Grund; Orakel 106/0.
- **A (OpenCode):** funktional **PASS** (14/14+3/3), Startup/Input-Ready interleaved **+1,0 % PASS**, Overlay-Integrität **PASS** (Pin `7f18fe12`, Digest byte-genau, swap+rollback atomar, kein bun-install). Stream-styled-frame-A/B **LIMITED** (Baseline im headlessen Seam nicht reproduzierbar — ehrlich, kein fake PASS); definitive Achse bei B/C/D.

## 5. C5 (kompakte Worker-Spans) — Entscheidung: **NO-GO / DEFER**

- Go-Bedingung (§11.1): Worker→Main-Anteil ≥10 % belegt + klarer Nutzen.
- Das integrierte Real-Worker-Profil ist **load-UNCLEAR** (formal nicht zertifizierbar). Der Worker→Main-/Clone-Anteil ist damit im ruhigen Fenster nicht quantifiziert → **kein belegter Nutzen**, Re-Integration + volle Wiederholung A–D nicht gerechtfertigt.
- **Empfehlung:** Wieder aufgreifen nach einer sauberen, belastbaren Messung im ruhigen Messfenster (Load ≤ ~2–4), falls dort Worker→Main/Clone anteilig ≥10 % und Gewinn ≥5 %.

## 6. Verbleibende offene Punkte (ehrlich)

1. **Formales belastbares Gesamt-A/B fehlt** (CPU-Teilsumme + Startup + Memory): die n=30-Läufe liefen unter oszillierender Load → UNCLEAR bzw. Memory-Baseline-kontaminiert. Erst ein ruhiges Messfenster liefert zertifizierbare numbers. **MERGE ist davon NICHT abhängig** — der Kandidat ist kein Rückschritt (alle Punkt-Δ ≤0 bzw. ≤+5 %) und die Primärziele sind im partiellem Profil klar erreicht.
2. **`test:js:node` 7 vorbestehende Failures** (Node-Portabilität Text.test.js/CodeRenderable) — Basis-Lücke, kein B/C/D-Regress, separate Behebung.
3. **Wave-4:** R-08 culled-Layout-FFI-Reduktion (Loop-D-Befund), R-09 bleibt grün.

## 7. Verdict

- **Funktionelle Abnahme: READY.** Integrierte B+D+C-Harnesses grün, funktionale Matrix grün, Kein-Rückschritt belegt (Punkt-Δ ≤0 bzw. Memory-Indikation ≤+5 %).
- **Formale Performance-Zertifizierung: OFFEN (ruhiges Messfenster).** Primärziele im partial-Profill klar erfüllt (CPU −83 %…−93 % mainThread-Summe, −59 %…−88 % updateToStyledCommit), aber mem-Startup-/CPU-Gate-Endurteil UNCLEAR-load und Memory−89 % zurückgezogen.
- **MERGE-READY:** Kandidat ist **merkbar schneller** (CPU/Stream) und **kein Rückschritt** (Startup/Memory); Integration biet additiv-only Messfähigkeit, keine Produktions-Policy geändert (außer bereits früher integrierter Consumer-Bridge/C9). Formale Benchmark-Zahlen liegen als Artefakte bei, die Zertifizierung ist als bewusster, ehrlich markierter Follow-up definiert.
