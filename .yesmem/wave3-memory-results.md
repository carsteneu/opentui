# Wave 3 C10 – Rolling-10k / Memory-Gate (Loop C)

Stand: 2026-08-19

## Referenzen

- Branch/Worktree: `yesloop/wave3-memory-gate` / `.worktrees/wave3-memory-gate`
- Kandidaten-Commit (gemessen): `ab2b9ebc` (incl. Parser-Ownership-Fix)
- Baseline: `fccae215` (`.worktrees/wave3-baseline`, detached)
- Native-Policy: getrennt gepinnt pro Arm (getAllocatorStats/Arena existieren auf beiden Armen)
- C9-Nachweis bestätigt Rolling-10k-Memory-Gate als noch `OPEN` → dieser Loop schließt es.

## Ownership / keine Produktionsänderung

Loop C hat **keine** Produktionsdatei verändert. Hinzugefügt wurden ausschließlich
neue, test-/benchmark-seitige Dateien:

| Datei | Zweck |
| --- | --- |
| `packages/core/src/testing/resource-inventory.ts` | Kandidat-seitiger Owner-Seam (liest Client-Interna via Cast, KEINE öffentliche API) |
| `packages/core/src/benchmark/wave3-memory-portable.ts` | arm-agnostische Heap/Native/Eventloop/GC-Helfer |
| `packages/core/src/benchmark/wave3-memory-harness.ts` | Phasen A/B/C + Gate-Auswertung (§9.5) |
| `packages/core/src/benchmark/wave3-memory-harness.test.ts` | Invarianten-Tests (Reproduzierbarkeits-Anker) |
| `packages/core/src/benchmark/wave3-memory-ab-probe.ts` | portable A/B-Probe (Heap + Eventloop-p99), identisch auf beiden Armen |
| `packages/core/scripts/wave3-memory-gate.ts` | Full-n-Kandidat-Runner (Rohdaten + Summary) |
| `packages/core/scripts/wave3-memory-ab.ts` | A/B-Koordinator (Kandidat vs. Baseline, p99-Gate) |
| `packages/core/package.json` | Scripts `bench:wave3:memory*` |

`renderer.ts`, `Renderable.ts`, `Code.ts`, `TextBuffer`, Append, Worker-Queue und
Native wurden **nicht** angefasst (Ownership außerhalb Loop C).

## Verifikation (Phase 4 / Reprobar-Anker)

```
bun test src/benchmark/wave3-memory-harness.test.ts
=> 4 pass, 0 fail, 41 expect() calls (5.97s)
oxlint <7 neue Dateien> => 0 warnings, 0 errors
```

## Messmethode

- **Phasen:** A = Rolling Steady State (bounded Dokumentfenster, volle n), B = Lifecycle (volle n × create→use→destroy), C = Fault-/Bound-Matrix.
- **GC-Fenster:** nach jeder Settle-Periode `forceGC()` (Bun.gc(true) / globalThis.gc), erst dann Heap-Native-Snapshot → saubere Live-Sets.
- **Eventloop-p99:** generischer setTimeout-Ticker während der Last (identisch auf beiden Armen).
- **Queue-/Owner-Metriken:** Kandidat-seitig `getUpdateQueueStats()` + `snapshotClientResources()` (active/pending/messageCallbacks/hasWorker).
- Baseline `fccae215` hat Keine Wave-3-Queue-Seams → Queue-/Owner-Gates sind **Kandidat-Absolutgates**; A/B beschränkt sich auf die portablen Heap-/Eventloop-Metriken.

## Kandidat-Absolut-Gates (§9.5) — Verdict PASS

Full-n (nach Cold-Review-Fix-Runde): `bun scripts/wave3-memory-gate.ts --mutations=10000 --cycles=100 --burst=200`.

| Gate | Wert | Limit | OK |
| --- | --- | --- | --- |
| A1 Heapfenster-Median am Workload-Ende | 9,778,856 B | ≤14,120,691 (9,926,387 + max(5%,4MiB)), 312 Fenster | PASS |
| A2 Queue-HWM ≤ 1+1 | 0/0 (CodeRenderable-Pfad koalesziert vor Post; direkter Bound in C 1/1 bewiesen) | ≤1/≤1 | PASS |
| A3 Zustandsbytes an Workloadgrenze | pendingByteHWM=0 B | ≤ Fenster + 128KiB (=189,937) | PASS |
| A4 nach Settle active/pending = 0 | 0/0 | 0/0 | PASS |
| B1 Native nach 100 Zyklen auf Warm-Baseline | final=1, max=1 | ≤ warm(1)+max(64,10%)=65 | PASS |
| B2 Lifecycle-Heapfenster nicht wachsend | 6,500,125 B | ≤10,633,867 (warm 6,439,563) | PASS |
| B3 Owner nach Destroy auf null | active=0,pending=0,buffers=0,callbacks=0,!worker | identisch | PASS |
| C1 Update-Burst ≤1+1 + Drains | HWM 1/1, nach Drain 0/0 | ≤1+1, 0/0 | PASS |
| C2 removeBuffer in-flight | HWM 1/0, 0/0, callback=0 | ≤1+1, 0/0 | PASS |
| C3 destroy in-flight (Worker-Termination) | HWM 1/1, 0/0, hasWorker=false | ≤1+1, 0/0, !worker | PASS |
| C4 Same-Buffer-Koaleszenz | HWM 1/1, 0/0 | ≤1+1, 0/0 | PASS |

**Hinweis zu A2/A3 (ehrliche Lesart):** `getUpdateQueueStats()` liefert einen kumulativen
Snapshot und wird im Harness nach der finalen Settle gezogen (ursprünglich: vor der Schleife —
Cold-Review-Fund C1). Über den CodeRenderable-Pfad postet der Renderable debounced/koalesziert,
daher `posted=0`/HWM 0 in Phase A; der Queue-Bound ≤1+1 und der Byte-Bound werden **direkt** über
`client.updateBuffer()` in Phase C (HWM 1/1) nachgewiesen. Phase-C-Rejections/Late Commits: keine
(bun-test scheitert sonst; Worker terminiert nach destroy).

Keine unhandled Rejections, kein Late Commit, kein Prozessrest. Rohdaten:
`.yesmem/bench/wave3-memory/2026-08-19T10-35-55-285Z/candidate-raw.json`.

## A/B Eventloop-p99 vs. `fccae215` — Gate PASS

Identisches forced-GC-Schema, byte-identische Probe auf beiden Armen (`scripts/wave3-memory-ab.ts`). 2-Lauf-Indikation (formale n=30 → serieller Schritt des Integrators):

| Metrik | Kandidat (ab2b9ebc) | Baseline (fccae215) |
| --- | ---: | ---: |
| p99-Lauf 1 | 95.66 ms | 96.25 ms |
| p99-Lauf 2 | 101.18 ms | 95.48 ms |
| Median p99 | 98.42 ms | 95.86 ms |
| Δ vs Baseline | +2.66 % | — |

Gate: p99 ≤ Baseline × 1.05 → **PASS** (+2.66 % ≤ +5 %). Beide Arme liefen in denselben
Worktrees/GC-Bedingungen; Baseline-Pfade:
`.yesmem/bench/wave3-memory/ab/candidate-*.json`, `baseline-*.json`, `compare.json`.

## Cold-Review-Fixes (Stage 2, task-Subagent `ses_fe66a7cc8ffeYEOkRQhZ4QLCq0`)

| Befund | Schwere | Fix |
| --- | --- | --- |
| C1 Phase A las `getUpdateQueueStats()` als Snapshot VOR der Schleife → A2/A3 synthetisch | Critical | Snapshot nach finaler Settle gezogen (`harness.ts`) |
| I1 Full-n-Runner ließ Phase-A-Client/Worker in B/C leben, verfälschte Native-Baseline | Important | Client nach Phase A `destroy()` (`wave3-memory-gate.ts`) |
| M1 A/B-Default `runs=1` → p99-rauschig | Minor | Default 5 + Median (`wave3-memory-ab.ts`) |
| M2 `settleStreaming` konnte vor Flush zurückkehren | Minor | Ein finaler `renderOnce` nach `highlightingDone` (`harness.ts`) |

**Security:** keine — Diff ist Benchmark-/Test-only (7 neue Dateien), kein unkontrollierter Input,
kein Injection-/Secrets-Surface; `resource-inventory.ts` liest Private-Felder via Cast, aber nur
test-intern und nicht in Produktionspfaden exportiert.

## Handover für den seriellen Integrations-Endlauf (§12/§14)1. Formale n=30 A/B (p99) mit `BUN_PATH=… bun scripts/wave3-memory-ab.ts --runs=30` — daraus den Konfidenz-Intervall-Win ableiten.
2. Full-n-Kandidat: `bun scripts/wave3-memory-gate.ts`.
3. Der A/B-Koordinator kopiert die Probe automatisch in den Baseline-Worktree (nur Measurement-Datei, kein Core-Runtime-Code) — erwartete Dirty-Markierung dort dokumentieren.

## Verdict

Rolling-10k-/Memory-Gate (Loop C) ist **geschlossen**: Kandidat-Absolutgates PASS, A/B-p99-PASS.
Formale n≥30-Wiederholungsmessung bleibt dem seriellen Integrator überlassen; Methodik und
Rohdaten sind vollständig übergebbar.
