# Wave 2 — Integrations- und Performance-Ergebnis

- Stand: 2026-08-17
- Branch: `yesloop/wave2-startup-integration`
- Worktree: `home/user/projects/opentui/.worktrees/wave2-integration`
- Runtime-Baseline: `f33c801981fe45a58bd688575427bbffddf7daa0` (`yesloop/wave1-lifecycle`)

## Ergebnis

Wave 2 ist funktional integriert und durch die betroffenen Paket-, Build-, Distributions- und statischen Prüfungen
abgesichert. Die Agentenübergaben waren nicht unverändert integrationsreif: Die Audits fanden nicht portable
Tests, unvollständige Subpath-Abdeckung, einen falsch-positiven Parser-Worker-Probe, eine verletzte
Readiness-Reihenfolge, weiterhin eager eingebundene optionale Renderer-Subsysteme sowie einen zunächst
ungeeigneten TTFMF-Messpfad. Diese Punkte wurden vor dem Endlauf korrigiert.

Die Performance-Messung zeigt zwei getrennt zu bewertende Resultate:

- Der gepaarte Cold-Import verbessert sich von 185,186 ms auf 36,545 ms, also um 80,57 %.
- Der gepaarte TTFMF verbessert sich von 201,441 ms auf 171,401 ms, also um 14,92 %.
- Der eigenständige Candidate-Lauf erreicht beim TTFMF 155,245 ms p50, 193,050 ms p95 und 206,075 ms p99.
- Das festgehaltene absolute Ziel von höchstens 274,84 ms ist klar erfüllt.
- Ein neu gegen die aktuelle Wave-1-Basis berechneter relativer Gewinn von 30 % ist noch nicht erfüllt. Dafür müsste
  der gepaarte Candidate-Median höchstens 141,009 ms erreichen.
- Das eingebaute Regressions-Gate besteht für Import und TTFMF. Es prüft maximal 3 % Regression und ist nicht mit
  dem zusätzlichen 30-%-Verbesserungsziel gleichzusetzen.

Damit ist Wave 2 eine belastbare Verbesserung und integrationsfähig, aber noch nicht das Ende der angestrebten
Maximaloptimierung.

## Nachgearbeitete Übergaben

### Loop A — Lazy Native FFI

- Nicht versionierte `.yesmem/native-assets`- und Linux-x64-Hardcodierungen aus den Tests entfernt.
- Native Library über den vorhandenen plattformneutralen Asset-Descriptor aufgelöst.
- Exact-once-Invarianten für Library-Close und Event-Sink-Destroy beobachtbar getestet.
- Eager FFI-Laden aus dem Importpfad entfernt; B4 bleibt als dokumentierter, messungsbasierter Deferred-No-op offen.

### Loop B — Entry-Points und lean Renderer

- Alle sechs additiven Subpaths in Source und gepackter Distribution für Bun, Node ESM und Node CJS geprüft.
- `createRendererReady` über den lean Renderer-Subpath öffentlich gemacht, ohne den Root-Barrel erneut einzuziehen.
- Console und Tree-sitter über bestehende Registrierungs-Seams vom lean Renderer-Graph getrennt.
- Späten Console-Import für bereits erzeugte Renderer unterstützt.
- Registry-Ownership gegen das Wiederaufleben abgemeldeter Vorgänger abgesichert.
- Highlight-Completion durch einen symbolisch gebrandeten Seam statt unsicherem Duck-Typing modelliert.
- Listener-, Multi-Renderer-, Destroy- und Lifecycle-Isolation durch Regressionstests abgesichert.

### Loop C — Parser-Worker und Assets

- Worker-Probe prüft Child-Status, Fehler und einen nichtleeren absoluten Default-Pfad; Cleanup läuft in `finally`.
- Negativprobe mit nicht ausführbarem Worker schlägt nun erwartungsgemäß fehl.
- Medianberechnung und Handoff-Provenienz korrigiert.
- Gemessener Anteil bleibt mit rund 0,22 % unter der 2-%-Schwelle; deshalb keine Runtime-Änderung.

### Loop D — UI-ready

- `applicationReady` kann erst nach First Frame und abgeschlossenem Enhanced-Settling auflösen.
- Destroy-, Monotonie- und Listener-Invarianten ergänzt.
- Reproduzierbares Messskript und versionierte Rohdaten hinzugefügt.

### Benchmark-Gate

- `renderer-entry` misst nun einen echten Textframe bis zum nativen Commit statt nur den Import.
- Import-only-Szenarien melden kein erfundenes TTFMF.
- Explizite Baseline-Worktrees und unterschiedliche Baseline-/Candidate-Szenarien werden unterstützt.
- Beide Arme verwenden dasselbe Native-Artefakt mit SHA-256
  `e7e9764462f2ee7f2c808856b60101ff659c6bda4a1df7cf235e418cf481a15c`.
- Endmessung: 30 balancierte Paare, drei Warmups und 20.000 Bootstrap-Samples.

Die vollständigen Messwerte und die Provenienz stehen unter
`.yesmem/bench/wave2-final-root-vs-renderer/report.md`; die append-only Rohdaten stehen daneben in `raw.ndjson`.

## Verifikation

| Prüfung                                        | Ergebnis                                          |
| ---------------------------------------------- | ------------------------------------------------- |
| Fokussierte Wave-2-Regressionen                | 51/51 grün                                        |
| `bun run test:js`                              | 5538 bestanden, 23 übersprungen, 0 fehlgeschlagen |
| `bun run build:lib`                            | grün                                              |
| `bun run test:dist --skip-build` mit Node 26.4 | Node ESM, Node CJS und Bun grün                   |
| `bun run fmt:check`                            | grün                                              |
| `bun run lint`                                 | 0 Fehler, 0 Warnungen                             |
| `git diff --check`                             | grün                                              |

Ein vollständiger Native-Rebuild ist lokal weiterhin durch Zig 0.15.2 statt der verlangten Zig-0.16-Version blockiert.
Die Performance-Arme wurden deshalb bewusst gegen dasselbe bereits gebaute und per SHA gepinnte Native-Artefakt
gemessen.

## Verbleibende Arbeit

- Für das relative 30-%-TTFMF-Ziel fehlen gegenüber der aktuellen gepaarten Wave-1-Basis noch rund 30,392 ms.
- B4 (kleinere oder aufgeteilte Native Library, Symbol-/Binding-Optimierung) erst nach isolierter Nutzen-/Risiko-Messung
  wieder aufnehmen.
- Der ungekapselte Bun-Worker-Resolve bleibt ein Robustheitsrisiko, war aber kein messbarer Wave-2-Performancehebel.
- Die bereits vorher bestehende globale `ConsoleCapture`-/`TerminalConsoleCache`-Policy ist bei zwei gleichzeitig
  aktiven Root-Overlay-Renderern nicht refcounted. Sie wurde nicht in die Wave-2-Entkopplung hineingezogen und sollte
  separat mit einem beobachtbaren Multi-Owner-Test bearbeitet werden.
