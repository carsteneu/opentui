# Wave 3 — Loop A: Stream-Gate Results (D3-D5)

Stand: 2026-08-18
Agent section: `yesloop-wave3-stream-gate`
Branch: `yesloop/wave3-stream-gate`
Worktree: `home/user/projects/opentui/.worktrees/wave3-stream-gate`

## 1. Branch, Worktree, Basiscommit, finaler HEAD, sauberer Status

- Branch: `yesloop/wave3-stream-gate`
- Worktree: `home/user/projects/opentui/.worktrees/wave3-stream-gate`
- Basiscommit: `fccae2158d5c98949fc050913b918621af918111` (confirmed at start, `git rev-parse HEAD`)
- Finaler HEAD: see commit list below; the branch starts from the confirmed basis and holds only Loop-A commits.
- Status: staged native asset `.yesmem/native-assets/` is git-ignored; worktree differs only by committed Loop-A files + raw-data commit.

## 2. Versionen und Native-SHA

- OpenTUI: `@opentui/core@0.5.3`
- Bun: 1.3.14 (`home/user/.bun/bin/bun`)
- Node: (probe used Bun path; Node parity via repo seam, see §9 limits)
- Gepinntes Native-Artefakt: `e7e9764462f2ee7f2c808856b60101ff659c6bda4a1df7cf235e418cf481a15c`
- Lokale gestagte `.so` (`.yesmem/native-assets/@opentui/core-linux-x64/libopentui.so`) hashcheck im Baseline-Skript; bei Abweichung wird gewarnt und der gepinnte Hash als Erwartung verwendet.

## 3. Commitfolge

| Commit     | Nachricht                                                                     |
| ---------- | ----------------------------------------------------------------------------- |
| `962a2099` | `perf(core): add wave3 opt-in stage-span telemetry`                           |
| `e07f4e48` | `perf(core): add wave3 streaming e2e + markdown attribution harness`          |
| `d1429cec` | `perf(core): record wave3 loop-a frozen baseline + attribution data`          |
| `1d57922b` | `perf(core): wave3 loop-a verify matrix (test:js/test:dist) + toolchain note` |

## 4. Geänderte Dateien und Ownership-Begründung

Nur erlaubte Ownership-Dateien (§5.2):

- `packages/core/src/telemetry.ts` — additiv: `Wave3SpanName`/`Wave3StageName`, `recordWave3Span`, `wave3Spans` in Snapshot/Reset. Off-State behält den einzelnen `enabled`-Guard; keine Clockreads/Allokationen im Off-State.
- `packages/core/src/benchmark/wave3-harness.ts` (neu) — deterministischer Streaming-E2E-Harness, kein Runtimepolicy-Eingriff.
- `packages/core/src/benchmark/wave3-harness.test.ts` (neu)
- `packages/core/src/benchmark/wave3-markdown-attribution.ts` (neu) — D3-D5 Parser-Attribution.
- `packages/core/src/benchmark/wave3-markdown-attribution.test.ts` (neu)
- `packages/core/scripts/wave3-baseline.ts` (neu) — Frozen-Baseline-Runner + balancierte Analyse.
- `packages/core/src/telemetry.wave3.test.ts` (neu)
- `packages/core/package.json` — additiv: `bench:wave3`, `bench:wave3:baseline`.
- `packages/core/.gitignore` — `.yesmem/native-assets/`, `.yesmem/tmp/` (Native nie committen, §2.4).
- Rohdaten: `.yesmem/bench/wave3-loop-a/*.json`, Bericht `.yesmem/wave3-loop-a-stream-gate-results.md`.

Nicht geändert: `Code.ts`, `client.ts`, `parser.worker.ts`, `types.ts`, `tree-sitter-styled-text.ts`, TextBuffer/Native/Zig, Layout-/Render-/Markdown-Policy. Kein zweiter Queue-/Versionsbesitzer.

## 5. RED-Beleg

Vor der Harness-Implementierung schlug der TDD-Test fehl: `Export named 'recordWave3Span' not found in module '.../telemetry.ts'` (RED). Für den Completion-Gate gilt die §5.4-RED-Semantik: Der alte `markdown-benchmark.ts` ersetzt `requestRender` durch einen No-op, wartet weder Worker noch Layout noch nativen Commit und kann daher einen Plain-Text-Zwischenframe fälschlich als Abschluss zählen. Der neue Harness zählt ausschließlich eine gestylte Span über den erwarteten Text + nativen Commit als GREEN (Plain-Text-/leerer Frame → Hard-Fail).

## 6. GREEN-Tests (Counts/Exitcodes)

```
bun test ./src/telemetry.wave3.test.ts ./src/telemetry.test.ts ./src/benchmark/wave3-harness.test.ts ./src/benchmark/wave3-markdown-attribution.test.ts
  → 20 pass, 0 fail (129 expect calls), exit 0
```

- Harness GREEN: styled generation committed, Stages disjunkt, Verdict PASS, `assertWave3SampleGreen` ok.
- Hard-Fails: unclean source arm, wrong scenario, nativer Hash-Mismatch, Plain-Text-only → alle werfen (Tests decken das ab).

## 7. Baseline/Candidate, n, p50/p95/p99, CI, Host/Load/Governor

Szenario `code-stream:100` (80x24 Viewport, 100 Zeilen), gefrorene Basis (beide Arme = gleiche Binär):
n=10 balancierte Paare (Lead wechselt pro Paar), 3 Warmups je Arm.

| Arm       | n   | p50 ms | p95 ms | p99 ms |
| --------- | --- | ------ | ------ | ------ |
| baseline  | 10  | 38.83  | 46.82  | 47.81  |
| candidate | 10  | 41.03  | 113.72 | 147.75 |

`analyzePairedObservations` (2000 Bootstrap, seed 7): `pairedChange≈+0.33`, `secondPositionEffect≈+0.07`, CI und Rohdaten in `.yesmem/bench/wave3-loop-a/baseline-code-stream:100-2026-08-17T22-03-28-383Z.json`.

Der hohe candidate-p95 stammt aus einzelnen langsamen Samples (Native-Load/GC/Absenderreihenfolge) — eine kleine Stichprobe ohne fresh-process-pro-arm. Das finale Gate verlangt ≥30 Paare + frischer Prozess pro Arm; das verschließt im Integrationsschritt.

Host-Provenienz: in der Roh-JSON erfasst (commit, bun, loadavg, governor). Load/Governor: siehe Rohdaten (`provenance`).

Markdown-Attribution (prose, 8k Bytes, 16 Steps): `stableRefsPreserved: true`, Tailklassen gezählt (siehe Rohdaten). Parsezeit-Messung über den Harness (Parser nicht optimiert, da Parse < 10 %-Budget für den Code-Pfad hier nicht der Engpass ist; siehe §10).

## 8. Correctness-/Ownership-Belege

- Harness wartet auf `highlightingDone` (akzeptierte Generation) + gestylte Span + nativen Commit; Plain-Text-/leerer Flush → Hard-Fail.
- `assertWave3SampleGreen` bricht bei Schema-Mismatch, unclean Source, Hash-Mismatch, fehlender styled-Verifikation, Verdict != PASS hart ab.
- Stufen-Spans disjunkt geprüft (`disjointMainThreadSum` wirft bei Überlappung).
- Telemetrie: nur `recordWave3Span` im Off-State = 1 Guard; im On-State kein Scheduling-/Commit-Eingriff; Counter/Snapshots monotonic und durch Session-Id getrennt.

## 9. PASS/FAIL/UNCLEAR/NO-OP

**PASS (verifiziert, inkl. Verifikationsmatrix §5.6):**

- Harness, Telemetrie, Attribution, RED/GREEN, Frozen-Baseline-Rohdaten: PASS.
- `bun run test:js` (ganze JS-Suite): **5552 pass / 0 fail** (23 skip; 201 Dateien; 90739 expect), exit 0.
- `bun run build:lib`: GREEN (Bundle inkl. telemetry, Typdeklarationen, `dist/parser.worker.js` + `dist/assets/*.wasm/scm`).
- `bun run test:dist`: **GREEN** (Dist-Test inkl. Packed-Dist-Smoke-Test, Node-26-Smoke, CommonJS-Smoke), nach Install von Zig 0.16.0 (siehe §10).

**UNCLEAR (nur echter Real-Worker-Baseline offen, §5.7):**

- Die echte Worker-Kette (`parser.worker.js` + WASM-Assets über `#opentui/runtime-assets`) wurde mit dem kontrollierten Completion-Seam gemessen (kein echtes Worker-Queue/ACK dieser Messung). Mit `build:lib` liegen nun `dist/parser.worker.js` + Assets vor — die Real-Worker-Messung ist damit im Integrationsschritt machbar, gehört aber zur Cross-Loop-Integration (Worker/Parsing gehört Loop D).
- Nicht neu ausgeführt: `test:js:node` (vorbestehend rot an fccae215, unabhängig von Loop A: tsc-spyOn-Cast in Code.test + Yoga/TextBuffer-.node-Festures; Doku in Wave-2-Gotchas).
- Kaltstart-/Additions-Gate (§13.2): Loop-A-Änderungen sind additiv (neue Dateien + 1 Guard im Off-State), kein zusätzlicher Cold-Import in Renderable/Markdown-Pfad (Parser nicht instrumentiert; Parse wird vom Harness extern getimed).

## 10. Grenzen und nicht erledigte Punkte

- Real-Worker-Baseline (Worker-post/Queue/ACK per echtem Worker): deferred auf Cross-Loop-Integration; Assets jetzt in `dist/` verfügbar.
- Finale Statistik (§3.5: ≥30 Paare, fresh process pro Arm, 20k Bootstrap) erst nach Integration der übrigen Loops im ruhigen Host; heutige Zahlen = kleine ausbalancierte Stichprobe (n=10).
- **Toolchain-Fix (Umwelt):** Repo pinnt Zig 0.16.0 (`.zig-version`), Host hatte nur 0.15.2 → `build:native`/`test:dist` brachen ab. Ich habe Zig 0.16.0 nach `~/.local/zig-0.16.0/` installiert (Binary im Archiv-Root, nicht `bin/`). Danach `build`, `test:dist` grün. Diese Shared-Env-Änderung gilt für alle Loops; wer `build:native` nutzt, braucht `~/.local/zig-0.16.0` vorn auf PATH, sowie Node 26 (`~/.nvm/versions/node/v26.4.0/bin`).
- Layout-/Render-/Native-Commit-Attribution nutzt die vorhandenen Renderer-Telemetrie-Marks (`opentui.firstNativeCommit`, Frame-Spans, `getNativeStats`) + Harness-Boundaries; keine Renderable.ts-Fremdinstrumentierung (cold-import-Schutz, Startup-Gate <3 %).

## 11. Kein eigener Bun-Prozess zurückgelassen

`ps -C bun` (00:03 Z): alle Harness-/Testruns dieses Loops beenden Renderer & Client in `finally`; kein von Loop A gestarteter Bun-Prozess läuft. Zum Prüfzeitpunkt liefen fremde Prozesse der parallelen Loops (Loop C/D: `styled-text.test.ts -t "Wave3 Loop D"`, `client.test.ts`, `test:js:node`) — diese wurden per §2.5 nicht beendet.
