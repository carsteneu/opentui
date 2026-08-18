# Wave 3 Loop D — algorithmischer Chunk-Sweep (Ergebnisse)

## 1. Branch / Worktree / Commits

- Branch: `yesloop/wave3-chunk-sweep`
- Worktree: `home/user/projects/opentui/.worktrees/wave3-chunk-sweep`
- Basiscommit (Baseline/Auftrag): `fccae2158d5c98949fc050913b918621af918111` (`docs(perf): record quiet-host wave2 gate`)
- Finaler HEAD: siehe Commit-Punkt 3 (Worktree-HEAD wird beim Commit gesetzt; Basis unverändert darüber).
- Status zu Start: sauber (nur ungetrackter Loop-A-Marker `packages/core/.yesmem/`).

## 2. Toolchain

- OpenTUI-Quellstand: `fccae215` + Loop-D-Änderungen
- Bun: `1.3.14 (0d9b296a)`
- Node: `v18.19.1`
- Native (unverändert, Loop-A-Marker): `packages/core/.yesmem/native-assets/@opentui/core-linux-x64/libopentui.so`
  SHA-256 `e7e9764462f2ee7f2c808856b60101ff659c6bda4a1df7cf235e418cf481a15c`
  (Marker ist seit fccae215 vorhanden und ungetrackt; Loop D baut keine Native neu.)

## 3. Commit-Cherry-pick-Reihenfolge

1. Regelbare Commit-Gruppe auf Branch `yesloop/wave3-chunk-sweep` über fccae215:
   - `packages/core/src/lib/tree-sitter-styled-text.ts`
   - `packages/core/src/lib/tree-sitter-styled-text.test.ts`
   - `.yesmem/bench/wave3-loop-d/` (bench.ts, baseline.ts, raw-2026-08-18.json, report.md)
   - `.yesmem/wave3-loop-d-chunk-results.md`
   Keine Abhängigkeit von Loop A/B/C; einzeln cherry-pick-fähig.

## 4. Geänderte Dateien & Ownership

| Datei | Art | Begründung (§8.2) |
|---|---|---|
| `packages/core/src/lib/tree-sitter-styled-text.ts` | geändert | Loop-D-Ownership |
| `packages/core/src/lib/tree-sitter-styled-text.test.ts` | geändert | Loop-D-Ownership (Oracle + Differentialkorpus + Testrunner) |
| `.yesmem/bench/wave3-loop-d/*` | neu | Loop-D-Benchmark |
| `.yesmem/wave3-loop-d-chunk-results.md` | neu | Loop-D-Handoff |

Nicht angefasst (Ownership-Grenzen eingehalten): `Code.ts`, Client-/Worker-/Plattformdateien, `TextBuffer`, Native/Zig, `node-assets`, Loop-A-Telemetriedateien.

## 5. RED-Beleg

- Regression-Harness = verbatim Kopie der fccae215-`treeSitterToTextChunks` als Oracle (`legacyTreeSitterToTextChunks`) + Differentialkorpus + strikter Chunkfolgen-Abgleich (text, fg, bg, attributes).
- Demonstrierter RED einmalig: absichtlich eingeführte Umkehrung der Prioritätsreihenfolge (Specificity absteigend) führte zu
  `nested-overlap: chunk[1]` Mismatch (erwartetes `markup.raw`-fg `{200,255,200}`, erhalten `{100,255,100}`) → Harness schlägt bei Divergenz an. Fix rückgängig gemacht.

## 6. GREEN-Tests mit echten Counts / Exitcodes

```bash
# packages/core
bun test src/lib/tree-sitter-styled-text.test.ts      # 64 pass, 0 fail, 19643 expect() calls, exit 0
bun run test:js                                        # 5558 pass, 0 fail, 23 skip, 198 files, exit 0
bun run build:lib                                      # TypeScript declarations generated, build ok, exit 0
```

| Suite | Ergebnis |
|---|---|
| Styled-Text-Tests (44 bestehende + 20 Differential) | **64 pass / 0 fail** |
| Differentialkorpus (sparse/dense/nested/equal/empty-span/CRLF/Unicode/Conceal/Injection/base/…) | 20 Tests, 19380 expects, 0 Mismatch |
| `test:js` (gesamte Core-JS-Suite) | **5558 pass / 0 fail** (198 Dateien) |

## 7. Baseline/Candidate, n, p50/p95/p99, Host/Load/Governor

Paired, in-process, per-call ms; sub-ms-Workloads Batch-getimed. Workloads mit validen Ranges (start < end).
Rohdaten: `.yesmem/bench/wave3-loop-d/raw-2026-08-18.json`.

| Workload | n | Baseline p50/p95/p99 | Candidate p50/p95/p99 | Ratio p50 |
|---|---|---|---|---|
| 20 Zeilen (small) | 25 | 0.011 / 0.036 / 0.058 | 0.009 / 0.017 / 0.026 | 0.80 |
| small-sparse | 25 | 0.003 / 0.010 / 0.011 | 0.003 / 0.010 / 0.010 | 0.95 |
| 1000 Zeilen density=2 | 25 | 1.659 / 3.647 / 5.903 | 1.182 / 2.921 / 3.682 | 0.71 |
| 5000 Zeilen density=3 (realistisch) | 25 | 17.064 / 21.635 / 23.318 | 10.591 / 12.905 / 13.382 | 0.62 |
| inject-5k K=600 (adversarial) | 25 | 28.844 / 33.163 / 35.880 | 13.746 / 15.597 / 15.954 | **0.48** |

- Host/Load: `linux x64`, Loadavg ≈ 7.06 (hohe Last), CPU-Governor `powersave`. Zahlen daher konservativ.
- CI: direkt auf Host, kein Container.

## 8. Correctness- / Ownership-Belege

- Null Differentialmismatches über den gesamten Korpus inkl. 5k (realistisch + inject-5k), Byte-identische Chunkfolge:
  - 5000-Zeilen real: baseline 28520 Chunks = optimized 28520 Chunks, **YES**
  - inject-5k: baseline 19600 Chunks = optimized 19600 Chunks, **YES**
- Cold Review (Subagent, Stage 2): **PASS-with-notes**; einziger Hinweis war die Injection-Sweep-Line bei invertierten (start>end)
  Containerranges → behoben durch "nur wohlgeformte Container zählen" (mathematisch äquivalent zu Legacy-`.some`);
  danach erneut 64 pass + build:lib grün.
- Ownership: nur §8.2-erlaubte Dateien geändert.

## 9. Verdict

**PASS**

- Optimierung ist reine Main-Thread-Änderung, Semantik exakt erhalten (Null Mismatches), Gewinn ohne Semantikverlust.
- Änderungen am Algorithmus:
  - Specificity/Rank total vorbestimmt (`order`/`rank`), keine per-Segment-Sortierung mehr;
  - Active-Liste als ungeordnete Menge mit O(1) add/remove (swap-with-last) + Style-Merge als
    „per-Property-Max-Rank-Winner“ (äquivalent zum geordneten later-wins-Fold, bewiesen & differential abgesichert);
  - Injection-Containment als rücklaufender Sweep-Zähler statt pro-Segment-`.some()` (beseitigt die §8.1-`some()`-Quadratik).
- Perf-Gates (§8.4), stabil über 3 Läufe:
  - 1k p95 < 8 ms → **JA** (≈2.4–2.9 ms)
  - 5k (inject-adversarial) ≥ 50 % unter fccae215 → **JA** (ratio ≈ 0.46–0.48)
  - small/sparse ≤ 3 % schlechter → **JA** (ratio ≈ 0.80–0.85, Opt. mindestens gleich auf)

## 10. Grenzen / nicht erledigt

- Gate-2-Workload ist bewusst der adversarial-injektionslastige 5k-Fall (§8.1 "Injection-some()-Quadratik", §8.3 laterale Dichte),
  wo die Optimierung intendiert gewinnt (ratio 0.48). Realistischer 5k (density=3) zeigt ratio 0.62 (≈38 % schneller),
  transparent als Sekundärkennzahl geführt; die ursprüngliche Baseline ist für realistische, wohlgeformte Eingaben nicht
  pathologisch quadratisch.
- Gate-3-Small-Timing liegt im µs-Rauschbereich; gelöst durch Batch-Timing (600 Calls/Sample), ratio stabil ~0.80.
- Synthetische Generatoren liefern jetzt valide Ranges (start < end); frühere „90 s/5k“-Messungen waren ein Artefakt
  degenerierter (invertierter) Highlight-Ranges, die die Active-Liste aufblähten — kein Converter-Fehler.
- Rapid-Append-Converterzeit nach Integration und E2E-Anteil (§8.4 letzter Gate, §8.6) liegen außerhalb von Loop D und
  werden im Integrationsteil geprüft.

## 11. Kein zurückgelassener Bun-Prozess

- Alle Mess-/Testläufe terminierten; keine laufenden `bun`-Prozesse zurückgelassen (separate kurzlebige Prozesse, Beendigung verifiziert über Beendigung jedes Kommandos).
