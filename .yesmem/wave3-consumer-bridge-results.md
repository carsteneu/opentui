# Wave 3 — Consumer-Bridge-Ergebnis

Stand: 2026-08-18

## Provenienz

- Branch/Worktree: `yesloop/wave3-consumer-bridge` / `.worktrees/wave3-consumer-bridge`
- Basis: `yesloop/wave3-streaming-integration@6ec90b97d72606fc98761417304c8039048bbc06`
- Kandidat: `8655d4c2d0abf33556b498727e9b6306a74fd5cc`
- Paket: `@opentui/core@0.5.3`
- Native-SHA beider Messarme: `e7e9764462f2ee7f2c808856b60101ff659c6bda4a1df7cf235e418cf481a15c`
- Runtime: Bun 1.3.14; gepackter Node-Test mit Node 26.4.0

## Umgesetzter Vertrag

- Streaming-`CodeRenderable` verwendet nicht mehr `highlightOnce`, sondern genau einen eigenen versionierten
  Tree-sitter-Buffer.
- Sichere Appends werden als UTF-8-Byte-Edits gesendet. Nicht-Appends und Filetype-Wechsel erhalten einen neuen,
  nie wiederverwendeten Buffer-Identifier.
- Initial- und Update-ACKs liefern vollständige `SimpleHighlight`-Ergebnisse einschließlich Injection- und
  Conceal-Metadaten. Ein Real-Worker-Differentialtest vergleicht sie exakt mit `highlightOnce`.
- Stale Ergebnisse werden weiter vor Konvertierung und vor UI-Commit verworfen. Destroy, Release, Create-Fehler und
  verspätete Antworten entsorgen den Buffer genau einmal.
- Worker-Rejections bleiben Rejections. Sie dürfen nicht als erfolgreiche leere Highlightantwort in `onChunks` oder
  `baseHighlight` gelangen; der bestehende Plaintext-Fallback bleibt dadurch semantisch identisch.
- Der bestehende Client bleibt der einzige Backpressure-/Latest-wins-Owner. Die Bridge führt keine zweite Queue ein.

## Funktionale Verifikation

- fokussierter kombinierter Satz: 211 Pass, 2 Skip, 0 Fail;
- vollständige Bun-JS-Suite: 5.601 Pass, 23 Skip, 0 Fail, 239 Snapshots;
- `build:lib`: grün;
- gepackte Distribution: Node ESM, Node CJS und Bun grün;
- Root-Lint: 0 Warnungen, 0 Fehler;
- alle 15 berührten Dateien: `oxfmt --check` und `oxlint` grün;
- Root-`fmt:check` bleibt ausschließlich an der geerbten `.yesmem/wave3-integration-results.md` rot;
- vollständiger Node-26-Lauf beendet sich nach den ergänzten Test-Cleanups zuverlässig. Er erreicht weiterhin die
  bereits am Integrationsstand dokumentierten Wave-3-fremden Yoga/TextBuffer-Basisfehler: native FFI-Bools liefern
  dort `0`/`1`, während einzelne Tests strikt `false`/`true` erwarten. Der gepackte Node-Pfad ist grün.

## Gepaarte Real-Worker-Messung gegen die direkte Vor-Bridge-Basis

Protokoll: 30 balancierte Paare, drei Fresh-process-Warmups je Arm/Szenario, 20.000 Bootstrap-Samples, keine fremden
Bun-Prozesse, identische Native-SHA und identische Frame-/Span-/Chunk-Digests. Wegen der dauerhaft aktiven
Arbeitsumgebung lief die Messung bei Load 10,37 bis 10,98 auf 16 logischen CPUs; sie ist deshalb als belastete,
gepaarte Messung und nicht als ruhige Absolutwert-Baseline zu lesen.

| Szenario            | Metrik               |                  Basis p50/p95/p99 |                 Kandidat p50/p95/p99 | gepaarte Änderung (95-%-CI) |      p95 |
| ------------------- | -------------------- | ---------------------------------: | -----------------------------------: | --------------------------: | -------: |
| cold-1000           | Update→styled Commit | 988,639 / 1.789,705 / 1.938,722 ms | 1.061,850 / 1.652,518 / 1.767,177 ms |      +0,07 % [-6,61; +7,08] |  -7,67 % |
| cold-1000           | Converter            |        16,131 / 38,417 / 40,623 ms |          19,771 / 31,890 / 35,718 ms |     +9,23 % [-6,23; +25,92] | -16,99 % |
| warm-1000-append100 | Update→styled Commit | 841,248 / 1.449,878 / 1.583,953 ms |   847,063 / 1.207,039 / 1.328,810 ms |     -1,37 % [-10,12; +7,48] | -16,75 % |
| warm-1000-append100 | Converter            |        12,406 / 31,322 / 37,243 ms |          13,400 / 23,130 / 33,577 ms |     +1,75 % [-7,52; +12,09] | -26,15 % |

Output-/Style-/Chunk-Parität: **PASS**. Die Tail-Latenz verbessert sich in beiden E2E-Szenarien. Das formale
Regressionsbudget (familienweise obere CI-Grenze höchstens +3 %) und das relative -30-%-Primärziel sind jedoch nicht
bestanden. Reine Mainthread-CPU bleibt ohne disjunkte Produktionsspans `UNCLEAR`.

## Entscheidung und nächster Checkpoint

Der Commit bleibt bis zum nächsten Profil-/Optimierungsschritt auf dem separaten Consumer-Bridge-Branch. Er wird
nicht allein aufgrund der verbesserten p95-Werte in die stabile Wave-3-Linie übernommen. Nächster Hebel ist die noch
doppelte Workerarbeit im internen Bufferpfad: der Worker erzeugt neben dem vollständigen `SimpleHighlight`-Resultat
weiterhin das öffentliche zeilenbasierte Delta. Ein expliziter interner Response-Modus darf diese Doppelarbeit nur
für den Code-eigenen Buffer abschalten; bestehende öffentliche Buffer-/Eventsemantik muss unverändert bleiben.

Versionierte Evidenz:
`yesloop/wave3-clean-gate@b1753385`,
`.yesmem/bench/wave3-bridge-6ec90b97-vs-8655d4c2-load16/{raw.ndjson,summary.json,report.md}`.
