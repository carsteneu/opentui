# Wave 3 Abschluss — Loop B: CPU/E2E + Startup-Safety (Ergebnisse)

**Stand:** 2026-08-19 — **Branch:** `yesloop/wave3-final-cpu` — **Worktree:** `.worktrees/wave3-final-cpu`

## 1. Provenienz

| Feld | Wert |
| --- | --- |
| Repository | OpenTUI (`home/user/projects/opentui`) |
| Agenten-Basiscommit | `ab2b9ebcdc7bb56cbfe7e00f871351d1aa4de325` |
| finaler HEAD | `6fb4788e` |
| Commitfolge | `6d29077f` harness · `a6066625` probe+gate · `56097223` startup · `6fb4788e` style |
| Branch | `yesloop/wave3-final-cpu` (aus `ab2b9ebc`, keine Mergecommits) |
| Worktree-Status | sauber (nach Style-Commit) |
| Paket / Bun / Node / Zig | `@opentui/core@0.5.3` / Bun `1.3.14` / Node `26.4.0` (Seam `~/.nvm/versions/node/v26.4.0`) / Zig `0.16.0` |
| Native-Policy | `per-arm` — Baseline `e7e97644…15c` (fccae215), Candidate `deacf806…3804` (b4e6d8b1/11b1fdec) |

## 2. Was Loop B geliefert hat

Neue Mess-/Abnahmefähigkeit (rein additiv; KEINE Runtime-Policy geändert, §8.2 respektiert):

1. `src/benchmark/wave3-cpu-harness.ts` (+ Test) — disjunkte Mainthread-Stufen mit Validierung
   (Reihenfolge, Inversion, Overlap, vollständige Stufe); `mainThreadSumMs` schließt Workerwarte
   konstruktiv aus; PASS/FAIL/UNCLEAR getrennt.
2. `scripts/wave3-cpu-probe.ts` — echte Worker-Kette; misst die synchronen Mainthread-Stufen
   **ausschließlich über externe gemeinsame Seams** (onHighlight/onChunks, textBuffer-Write-Wrapper,
   `client.getPerformance`) — **nicht** `process.cpuUsage()`. Workerwarte separat, Worker-CPU separat.
3. `scripts/wave3-clean-gate-cpu.ts` (+ Test) — A/B-gate gegen `fccae215` mit `createPairedSchedule`
   + `analyzePairedObservations` (20k Bootstrap, familywise across 2 Primärmetriken):
   `mainThreadSumMs` und `updateToStyledCommitMs`. Wirft hart ab bei ungleichem Output-Digest,
   nicht-disjunkter Stufe, nicht-PASS-Verdict, identischen Native-Shas.
4. `scripts/wave3-startup-probe.ts` + `wave3-startup-gate.ts` (+ Test) — Import + TTFMF gegen
   `renderer-entry`, **per-arm Native**, paired p50/p95/p99 mit stratifiziertem Quantil-Bootstrap;
   Gate p50/p95 familywise upper ≤ +3 %, p99 ≤ +5 %.
5. `bench:wave3:cpu-gate`, `bench:wave3:startup-gate`, `test:wave3:cpu`, `test:wave3:startup` in `package.json`.
6. Rohdaten: `.yesmem/bench/wave3-final-cpu/` (cpu-*.ndjson/startup-*.ndjson + reports).

## 3. Messvertrag (RED/GREEN §8.3, §8.5)

- **RED belegt:** `process.cpuUsage()` kann Workerzeit nicht ausschließen; bisherige
  Diagnose-Callbacks überlappen/attribuieren Post-Chunk- und Layoutarbeit nicht sauber.
- **GREEN belegt (Tests):** Analyse lehnt invertierte/überlappende/fehlende/unordentliche Stufen ab;
  Workerwarte ist ein eigenes Feld und niemals Teil der Mainthreadsumme; Baseline/Candidate tragen
  denselben externen Messvertrag (Probe lädt Runtime je Arm, Mescloops identisch); falscher
  Commit/Native-Hash/Szenario/dirty/Unclean/Plaintext bricht hart ab; Styled-Digests plus Final-Output
  exakt; PASS/FAIL/UNCLEAR getrennt.

**Disjunkte Mainthread-Stufen (jede = synchrones Fenster in einer Generation):**
`contentUpdate` → `workerPost` → `converter` → `safeAppend` → `textbuffer`. Summe = `mainThreadSumMs`.
`workerWait` und `workerCpu` werden getrennt ausgewiesen und ausgeschlossen. `layout.render`/`native.commit`
liegen in **Loop D** (`renderer.ts`/`Renderable.ts`) → diese Stufe fehlt im isolierten B-Branch:
**partielle CPU-Summe** (§8.3, §14.2.2). Der finale −30-%-Gesamtclaim wird erst nach B+D-Integration
berechnet.

## 4. Verifikation (Exits/Tests real, §8.7)

| Kommando | Ergebnis |
| --- | --- |
| `bun test scripts/wave3-clean-gate.test.ts` | exit 0 — 5 pass |
| `bun test src/benchmark/wave3-harness.test.ts` | exit 0 — 5 pass |
| `bun test src/renderables/Code.test.ts src/lib/styled-text-append.test.ts src/text-buffer.test.ts` | exit 0 — 134 pass, 1 skip, 0 fail |
| `bun test src/benchmark/wave3-cpu-harness.test.ts scripts/wave3-clean-gate-cpu.test.ts scripts/wave3-startup-gate.test.ts` | exit 0 — 32 pass |
| `bun run test:js` | exit 0 — **5653 pass, 0 fail** |
| `bun run build:lib` | exit 0 — `dist/parser.worker.js` + `dist/` erzeugt |
| `bun run test:dist --skip-build` | exit 0 — 0 fail (packed dist smoke) |
| `bun run test:js:node` | exit 1 — **4742 pass / 7 fail** (siehe §6.1) |
| `oxfmt --check <8 neue Dateien>` | alle konform; `git diff --check` sauber |
| `oxlint <8 neue Dateien>` | 0 warnings, 0 errors |

## 5. Diagnose-/Provenzläufe (volatil, KEINE formalen n=30)

> Formale n≥30-, 3-Warmup-, 20k-Bootstrap-Läufe sind laut Plan §8.7 erst im ruhigen
> Koordinator-Messfenster UND nach B+D-Integration zulässig. Hier nur WIRKUNGSNachweis des Harnesses.

**CPU-Probe (Candidate cold-1000, 1 Lauf):** `verdict=PASS`; `mainThreadSumMs=44.28`
(contentUpdate 0.30 · workerPost 1.17 · converter 12.55 · safeAppend 4.26 · textbuffer 25.99);
`workerWaitMs=132.91` (separat); `updateToStyledCommitMs=178.84`; `nativeFrameDelta=3`;
`styledVerified=true`, `finalMarkerVisible=true`. → Disjunkte-Telegraphie und Styled-Commit-Orakel
sind plausibel; Summe+wait ≈ Walltime (44.3+132.9≈177 vs 178.8).

**Startup-Gate (2 Paare, 1000 Bootstrap, Hostload 6.19>4):** Ergebnis **UNCLEAR** (load budget
überschritten) — wie vorgeschrieben, kein synthetischer PASS. Raw: Import Baseline ~39.8 ms /
Candidate ~38.4 ms; TTFMF Baseline ~159 ms / Candidate ~161 ms. Zahlen nur informativ.

## 6. Befunde / Grenzen / offene Risiken

### 6.1 `test:js:node` — 7 vorab vorhandene Node-Dist-Fehler
7 Fehler in `Text.test.js`/`CodeRenderable` (Layout-Dirty-Semantik, `Expected 1 to be true`),
laufen gegen den gepackten Dist-Bundle unter Node 26. **Unabhängig von diesem Loop-B-Diff**
(nur additive Benchmark-Dateien; Loop B ändert kein Runtime-/Layout-/Dist-Code). `test:dist
--skip-build` ist grün. Wird als bereits vorhandene Node-Portierbarkeitslücke der Basis gemeldet,
nicht gelöst (würde `renderables`/Layout — Loop-D-/Out-of-Scope — berühren).

### 6.2 Native-Provenienz-Falle (Koordinator muss lösen fürs finale Gate)
- Mein Worktree-`node_modules` hatte nach `bun install` das **publizierte** (Baseline-)Native
  `e7e97644` statt des Candidates `deacf806`. Wave-3-FFI-Symbol `textBufferAppendStyledText` fehlte
  → 129 Testfehler in Code/text-buffer (nicht Code-bedingt). Behoben durch Kopieren des CANDIDATE-
  Native `deacf806` in die Candidate-arm `node_modules/.bun/...` (nicht committed, nicht Hardlink).
- Baseline-Worktree (`wave3-baseline`) ist **nicht clean**: untracked `packages/core/.yesmem/`
  → `git status --porcelain`-Prüfung eines Clean-Gates würde auf der Baseline hart failen.
  **Folge:** der finale `wave3-clean-gate-cpu`-Lauf darf nicht gegen diesen Baseline-Worktree ohne
  Vorab-Cleanup laufen; Koordinator muss das untracked-Verzeichnis behandeln oder ein sauberes
  Basline-Worktree liefern.
- `workerCpuMs` war im Streaming-Pfad-Diagnostiklauf `0` (Worker-Perf-Stats nicht je Generation
  befüllt). Die Workerwarte (`workerWaitMs`) ist das verlässliche, getrennte Trennsignal; die
  Worker-CPU bleibt Diagnose mit dokumentierter Einschränkung.

### 6.3 Partieller Claim
- Layout-/Native-Commit-Spans fehlen (Loop D). `mainThreadSumMs` ist die **partielle** Summe.
  Der Wave-3-Primärclaim (§15.1) für die VOLLSTÄNDIGE disjunkte Summe und den `update→styled`
  Wall wurde in Loop B nicht endgültig zertifiziert; erst nach B+D-Integration und seriellem
  Messfenster.

## 7. Gesamtergebnis Loop B

- **Mess-/Abnahmefähigkeit:** bereit (Harness + Gates + Tests grün).
- **Messmethode ersetzt:** ja — externe disjunkte Mainthread-Seams statt `process.cpuUsage()`.
- **Formale n=30/Primärclaim:** NOCH NICHT gelaufen (wartet auf Koordinatorfenster + B+D), korrekt
  als offen deklariert; keine falschen PASS-Claims.
- **Startup-Safety:** Gate implementiert; Diagnoselauf UNCLEAR wegen Hostload (kein Claim).
- **Verbleibende Integrationsblocker für den Koordinator:** (1) sauberes/richtiges
  Baseline-Native-Worktree, (2) Baseline untracked `.yesmem/`, (3) Candidate-arm-Native `deacf806`
  pro-arm bereitstellen, (4) `test:js:node` 7 Vorab-Fehler.
- **Kein Prozess hinterlassen:** siehe §8 Prozesshygiene.

## 8. Prozesshygiene
- Nach allen Diagnoseläufen `ps -C bun` geprüft; keine verwaisten Worker/Bun-Prozesse zurück.
- Load/Governor protokolliert (Startup-Diagnose: load 6.19/7.69/7.49 → UNCLEAR korrekt).
- `.yesmem/bench/wave3-final-cpu/` enthält nur Rohdaten/reports, keine `.so`/Heapdumps/Secrets.
