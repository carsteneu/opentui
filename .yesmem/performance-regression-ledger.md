# OpenTUI Performance-Wins und Regression Ledger

Stand: 2026-08-18  
Kanonische Runtime-Integration:
`yesloop/wave3-streaming-integration@b4e6d8b18e68f769abfedbdc7b070a761bdfdc15`
OpenTUI-Paketversion: `@opentui/core@0.5.3`  
Git-Describe der Runtime-Integration: `v0.5.3-100-gb4e6d8b1`

## 1. Zweck und Statusregeln

Dieses Dokument ist die kanonische Prüfliste für bereits erreichte OpenTUI-Performance- und
Resilienzgewinne. Eine neue Optimierungswelle oder ein neuer Upstream-Rebase darf erst als
regressionsfrei gelten, wenn die für ihren Scope relevanten Gate-IDs erneut geprüft und die
Ergebnisse mit Commit, Runtime, Native-SHA, Rohdaten und Hostzustand ergänzt wurden.

Die Einträge unterscheiden bewusst zwischen normalem Durchsatz, vermiedener Arbeit und
begrenzten Fehlerpfaden. Prozentwerte aus diesen Kategorien dürfen nicht addiert werden.

| Status        | Bedeutung                                                                                 |
| ------------- | ----------------------------------------------------------------------------------------- |
| `HARD`        | Korrektheits-/Ownership-Invariante; null Abweichungen erlaubt                             |
| `PASS`        | Reproduzierbares Gate mit versionierter Evidenz bestanden                                 |
| `LOOP-PASS`   | Im isolierten Implementierungsloop bestanden; Gesamtintegration noch nicht final gemessen |
| `PROVISIONAL` | Richtung belegt, aber Stichprobe/Hostlast reicht nicht für ein allgemeines Release-Gate   |
| `OPEN`        | Ziel oder Gesamtgate noch nicht erreicht                                                  |
| `KNOWN-COST`  | Bewusste Sicherheitskosten; darf nicht stillschweigend als regressionsfrei gelten         |
| `NO-OP`       | Gemessen und absichtlich nicht optimiert, weil der Anteil unter der Go-Schwelle lag       |

Wenn ein Report und eine Session-Erinnerung voneinander abweichen, gilt in dieser Reihenfolge:

1. versionierte Rohdaten;
2. versionierter Ergebnisbericht am gemessenen Commit;
3. Git-Diff und automatisierter Regressionstest;
4. Session-/Yesmem-Erinnerung nur als Suchindex oder Warnhinweis.

## 2. Verbindliche Baseline-Leiter

Alle Stände liegen auf derselben Fork-Lineage. `fastpatch` ist der Produktvorfahr; `main`,
`origin/main`, einzelne Agentenbranches oder ein älterer Wave-Worktree sind keine zulässigen
Ersatzbaselines.

| Stufe              | Commit     | Bedeutung                                                      | Vergleich für |
| ------------------ | ---------- | -------------------------------------------------------------- | ------------- |
| Patched.98         | `568db413` | Retained-/Partial- und Streaming-Sicherheitsfixes              | Git-Herkunft  |
| Fastpatch 0.5.3    | `2cd44364` | Patched.98 mit Upstream-0.5.3-Linie                            | FP-Gates      |
| Wave 0             | `f3ef5a19` | Observability und gehärtetes A/B-Harness                       | Wave 1        |
| Wave 1 Runtime     | `f33c8019` | Lifecycle-/Hang-Schutz plus Hotpath-Nacharbeit                 | Wave 2        |
| Wave 2 Integration | `fccae215` | Lazy FFI, lean Entrypoints, Ready-Stufen, ruhiges Startupgate  | Wave 3        |
| Wave 3 Runtime     | `917ef5f7` | Streaming-Harness, Backpressure und Chunk-Sweep                | Consumer      |
| Wave 3 stabil      | `6ec90b97` | Runtime integriert, geprüft und als Zwischenbasis dokumentiert | Consumer      |
| Consumer-Bridge    | `fcf1cb70` | Versionierter Buffer-/ACK-Pfad im echten Renderpfad            | C9 Native     |
| C9 Candidate       | `11b1fdec` | Sicherer inkrementeller Styled-TextBuffer-Tail                 | Integration   |
| C9 Integration     | `b4e6d8b1` | Consumer-Bridge und C9 auf der gemeinsamen Wave-3-Linie        | nächste Welle |
| Wave-3 final Basis  | `ab2b9ebc` | b4e6d8b1 + Parser-Tree-Ownership-Fix (free replaced trees once); gemeinsame Agenten-/Integrationsbasis | formale Wave-3-Gates |

Hinweise:

- `bf23ea84` und `82ee8b99` sind Plan-/Dokumentcommits, keine Runtime-Baselines.
- Der bestehende Worktree `.worktrees/wave2-baseline` stand beim Wave-2-Gate auf Wave 1. Für
  neue Wave-3-Prüfungen ist ausschließlich ein detached Worktree auf `fccae215` zulässig.
- Der aktuelle detached Vergleichspfad ist `.worktrees/wave3-baseline@fccae215`.
- Die Loop-C-/Loop-D-Berichte nennen teilweise `fastpatch` als Produktreferenz. Für die
  isolierten Dateien war der Code dort bytegleich; das finale Wave-3-A/B muss trotzdem gegen
  `fccae215` laufen.

## 3. Globale Messhygiene

Jeder Performance-Claim muss vor der Bewertung alle folgenden Punkte erfüllen:

- beide Arme sind saubere Worktrees und der Report enthält beide vollständigen Commits;
- gleicher Runtimepfad: primär Bun `1.3.14`, funktional zusätzlich Node `26.4.0` über den
  vorhandenen Node-26-Seam;
- identisches Native-Artefakt in beiden Armen; für die TypeScript-Waves ist die bisherige
  Referenz-SHA
  `e7e9764462f2ee7f2c808856b60101ff659c6bda4a1df7cf235e418cf481a15c`;
- bei einer expliziten Native-Optimierung sind unterschiedliche Binaries nur mit
  `native-policy=per-arm`, separat gepinnten SHAs und identischem Zig-/Buildprotokoll zulässig;
- gleicher Viewport, Input, Seed, Warmup, Messpunkt und Abschlusszustand;
- mindestens 30 balancierte A/B-Paare, drei Warmups und 20.000 Bootstrap-Samples für finale
  Startup-/E2E-Claims;
- p50, p95 und p99 sowie die gepaarte Änderung und das familienweise 95-%-Intervall werden
  gespeichert;
- keine fremden Bun-/Testworker während der Messung; Prozessliste und Load Average werden vor
  und nach dem Lauf erfasst;
- absolute Werte eines belasteten Laufs werden nicht zum neuen Sollwert erklärt; der belastete
  Lauf bleibt als Diagnose erhalten;
- `root`, `renderer-entry`, Import-only und echter committed Frame sind unterschiedliche
  Szenarien. Ein Szenariowechsel muss im Report stehen und darf nicht als Same-path-Speedup
  ausgegeben werden;
- Workerzeit, Mainthread-Stufen und Wartezeit bleiben disjunkt. `process.cpuUsage()` allein ist
  kein Mainthread-CPU-Beleg;
- Rohdaten sind append-only. Ein ungültiger Lauf wird markiert, nicht überschrieben;
- bei gepaarten Läufen muss die Armreinheit geprüft werden: Die Einzelarm-Mediane müssen zu den
  jeweiligen Gate-Arm-Medianen passen. Fast identische, gemischte Armwerte sind ein
  Comparatorfehler, kein besonders stabiles Ergebnis.

Allgemeines Regressionsbudget, sofern ein spezifisches Gate nichts Strengeres verlangt:

- familienweise obere CI-Grenze für p50/p95 höchstens `+3 %`;
- p99 höchstens `+5 %`;
- null funktionale Output-, Style-, Link-, Cursor-, Hit-grid- oder Ownershipabweichungen.

## 4. Fastpatch: geschützte algorithmische Basis

### FP-01 — Native regionale Partial-Strecke (`HARD`)

Geschützter Gewinn:

- Partial Frames verwenden `renderPartialFrame` und `lib.renderPartial` nur für die vereinigte
  Dirty-Region.
- Die frühere TypeScript-Vollbildkopie von ungefähr 15.000 Zellen pro Partial Frame ist nicht
  mehr im Pfad.
- Mehrere Dirty-Targets werden zu einer Region vereinigt und mit einem nativen Partial-Call
  verarbeitet.

Fail-Bedingungen:

- TypeScript kopiert vor einem Partial Frame wieder den ganzen Framebuffer;
- der Renderer ruft für jeden Dirty-Knoten einen separaten nativen Diff auf;
- unveränderte Zellen außerhalb der Region werden als aktualisiert gezählt;
- Partial- und Full-Framebuffer unterscheiden sich für denselben Endzustand.

Evidenz: Commits `92046a06`, `3c045571`, `b0dda662`; Tests
`packages/core/src/tests/renderer.partial-render.test.ts` und
`packages/core/src/tests/renderable.test.ts`.

### FP-02 — Retained-Commit- und Streaming-Guards (`HARD`)

Geschützter Gewinn:

- `lastFrameCommitted` verhindert Partial Rendering auf einem leeren/nicht committed nativen
  Buffer und damit schwarze Zwischenframes.
- SKIPPED/FAILED verliert den finalen Zustand nicht; der nächste gültige Request kann einen
  vollständigen Repaint erzwingen.
- ersetzter oder kürzerer retained Code löscht alte Glyphen und Hintergrundbereiche korrekt.
- gleichzeilige Streaming-Updates halten Layout sauber; neue Zeilen oder geänderte Dimensionen
  markieren Layout dirty.

Fail-Bedingung: schwarzer Zwischenframe, stale Glyph, fehlender finaler Frame oder Full-Layout
für einen nachweislich dimensionsstabilen Same-line-Update.

Evidenz: Commits `4b6aca46`, `568db413`; `Code.test.ts` mit retained-, clear-, same-line-,
new-line- und stale-highlight-Regressionsfällen.

### FP-03 — Vorhandene Koaleszierung und Render-List-Reuse (`HARD`)

Geschützter Gewinn:

- nur ein Render-Timer pro Deadline;
- Requests während eines Frames erzeugen höchstens den notwendigen Folgeframe;
- Feed- und Thread-Backpressure bleiben getrennt;
- stabile Layout-/Render-List-Generationen überspringen die globale
  `updateLayout`-/`updateFromLayout`-Traversal.

Diese Punkte sind geerbte Positivbefunde der Fastpatch-Codeanalyse, keine neu gemessenen
Prozentgewinne. Ein zweiter Scheduler, eine zweite Queue-Policy oder eine pauschale Traversal
würde als Regression gelten.

## 5. Wave 0: Mess- und Observability-Wins

### W0-01 — Opt-in Telemetrie und Lifecycle-Provenienz (`PASS` als Infrastruktur)

Vorhanden sind unter anderem Framegründe, Queue-/Feed-Wartezeit, Import-ready, Native-load,
Renderer-create, Terminal-setup, erster Outputwrite, erster JS-Render, erster nativer Commit und
Destroy-Spans. Der Off-State bleibt hinter einem Guard und darf keine Clockreads oder
Allokationen erzeugen.

Das historische Wave-0-Performancegate ist ausdrücklich **kein** Runtime-PASS: Die
familienweisen Intervalle waren wegen Hoststreuung breiter als `+3 %`. Der Gewinn ist die
Messbarkeit und das gehärtete Harness, nicht ein behaupteter Speedup.

Historische Wave-0-Referenz, nur zur Diagnose:

| Szenario  | Import p50/p95/p99             | TTFMF p50/p95/p99              |
| --------- | ------------------------------ | ------------------------------ |
| Bun root  | 435,704 / 625,631 / 673,767 ms | 460,972 / 676,153 / 729,404 ms |
| Bun zig   | 306,293 / 374,115 / 378,759 ms | 350,981 / 419,316 / 426,761 ms |
| Bun dist  | 350,285 / 407,562 / 407,644 ms | Import-only, kein echter Frame |
| Node dist | 123,031 / 130,085 / 130,257 ms | Import-only, kein echter Frame |

Diese absoluten Zahlen wurden mit anderer Hostlast und beim Wave-0-Gate mit der gepinnten
Fastpatch-Native-SHA `c38439b6…` erfasst. Sie dürfen nicht direkt gegen Wave-2-Werte gerechnet
werden.

### W0-02 — Gepaarter Comparator (`HARD`)

Der Comparator muss die tatsächliche Ausführungsreihenfolge wechseln und Werte strikt dem
richtigen Arm zuordnen. Das Gate speichert Source-Cleanliness, Runtime, Host, Native-SHA,
Symbolzahl, Seed, Warmups, Paarzahl und Bootstrap-Konfiguration.

Fail-Bedingungen: gemischte Arme, nicht alternierende Reihenfolge, abweichende Native-SHAs,
fehlender echter TTFMF-Abschluss oder ein PASS ohne familywise CI.

Evidenz: Wave-0-Commits `54565831` bis `f3ef5a19`, insbesondere Comparator-Fix
`cce76f4a`; `packages/core/bench/base/wave0-r4/report.md` im Wave-0-Worktree.

## 6. Wave 1: beseitigte Dead-Ends, Hänger und Kaskaden

### W1-01 — Framecallback-Destroy wird begrenzt (`PASS`)

| Baseline                   | Wave 1 | geschütztes Ergebnis                                |
| -------------------------- | ------ | --------------------------------------------------- |
| nach 200 ms weiter pending | 3–5 ms | unbounded → bounded, im Testfenster >98 % schneller |

Der Framecallback bleibt seriell; synchrone Callbacks funktionieren; späte Rejections bleiben
beobachtet; nach Destroy darf keine Layout-/Nativearbeit starten. Callback-freie Frames erzeugen
keinen Abortowner.

### W1-02 — Feed-/Writable-Teardown wird begrenzt (`PASS` funktional, `KNOWN-COST` perf)

| Faultpfad                 | Baseline                   | Wave 1                          |
| ------------------------- | -------------------------- | ------------------------------- |
| gepinnter Write + Destroy | nach 200 ms weiter gepinnt | unter 7 ms, nicht backpressured |

Die JS-eigene Bytekopie verhindert Use-after-free bei unzuverlässigen Sinks. Sie darf nicht
ohne eine echte, getestete Ownership-Übergabe entfernt werden.

Offene Kosten:

| Szenario                | Wave 0        | Wave 1        | Status                              |
| ----------------------- | ------------- | ------------- | ----------------------------------- |
| Custom Feed seriell p50 | 41,191 µs     | 44,960 µs     | `+9,15 %`, `KNOWN-COST`             |
| Custom Feed seriell p95 | 45,606 µs     | 47,300 µs     | `+3,71 %`, Gate um 0,71 pp verfehlt |
| Custom Feed 25k p95     | 117,125 µs/op | 130,311 µs/op | `+11,26 %`, offen                   |

Eine neue Version darf diese Werte nicht weiter verschlechtern. Ziel des Folgeumbaus ist eine
begrenzte Drain-/Pinned-Byte-Policy oder sichere native Ownership, nicht unsicheres Zero-copy.

### W1-03 — Timer, Debounces, Dispose und Worker-Kaskaden (`PASS`)

| Invariante                            | Vorher                 | geschützt ab Wave 1              |
| ------------------------------------- | ---------------------- | -------------------------------- |
| stale Delayed-Activation nach Destroy | 1 Wakeup               | 0 Wakeups                        |
| ersetzter Reset-Debounce              | Promise bleibt pending | settlet definiert als superseded |
| erfolgreicher Buffer-Dispose          | 3-s-Timer bleibt aktiv | Timer gecancelt                  |
| Worker-Crashfolge                     | unbegrenzt             | maximal 5 konsekutive Recreates  |

Zusätzlich gilt: Timer haben einen Owner, alte Activation-Completions löschen keine neue
Generation, Clients aborten nicht gegenseitig ihre Debounces, und Terminate-Fehler behalten den
Worker für einen kontrollierten Retry.

### W1-04 — Frame-Hotpath bleibt im Budget (`PASS`)

| Szenario               | Wave 0    | Wave 1    | Delta                               |
| ---------------------- | --------- | --------- | ----------------------------------- |
| ohne Callback p50      | 27,711 µs | 27,609 µs | `-0,37 %`                           |
| ohne Callback p95      | 29,224 µs | 28,716 µs | `-1,74 %`                           |
| resolved Callback p50  | 38,462 µs | 39,472 µs | `+2,63 %`                           |
| resolved Callback p95  | 43,414 µs | 42,849 µs | `-1,30 %`                           |
| One-shot Scheduler p95 | 3,196 µs  | 3,424 µs  | `+0,229 µs`; klein, aber beobachten |

Evidenz für W1-01 bis W1-04: `.yesmem/wave1-lifecycle-results.md`; 243 fokussierte Tests,
5.494 JS-Passes, 23 Skips und 0 Fails am Abschlussstand.

## 7. Wave 2: Startup- und Import-Wins

### W2-01 — Lazy Native-FFI-Initialisierung (`HARD`)

- Ein Import erzeugt keine `FFIRenderLib` mehr.
- Erst der erste echte Resolve lädt die Bibliothek; parallele/mehrfache Aufrufe erhalten dieselbe
  Instanz.
- ein fehlgeschlagener Resolve vergiftet spätere Recovery nicht;
- Library-Close, Callback-Close und Event-Sink-Destroy laufen jeweils genau einmal;
- Tests lösen das optionale Native-Paket über den plattformneutralen Asset-Descriptor, nicht über
  einen privaten `.yesmem`-Pfad oder Linux-x64-Hardcoding.

Evidenz: Commits `ac989819`, `a6485b2b`, `eb75737b`;
`.yesmem/wave2-loop-a-native-ffi-results.md`.

### W2-02 — Cold Import (`PASS`, primärer messbarer Win)

Ruhiger finaler Lauf, Wave 1 `root` → Wave 2 `renderer-entry`, 30 Paare, drei Warmups, 20.000
Bootstrap-Samples, identische Native-SHA `e7e976…`:

| Metrik | Baseline   | Candidate | gepaarte Änderung | familywise 95-%-CI    |
| ------ | ---------- | --------- | ----------------- | --------------------- |
| Import | 165,269 ms | 30,256 ms | **`-82,20 %`**    | `-82,90 % … -81,53 %` |

Der eigenständige Candidate-Import lag bei 29,351 ms p50, 40,011 ms p95 und 43,451 ms p99.

Schutzgate:

- zukünftiger `renderer-entry`-zu-`renderer-entry`-Lauf gegen `fccae215` darf familywise nicht
  mehr als `+3 %` regressieren;
- ein historischer Wave-1-Root-zu-Candidate-Renderer-Replay muss weiterhin mindestens `70 %`
  Importgewinn zeigen. Dieser zweite Wert schützt den UX-Pfadwechsel, ist aber kein
  Same-scenario-Microbenchmark.

### W2-03 — Time to First Meaningful Frame (`PASS`, Ziel teilweise offen)

| Metrik | Baseline   | Candidate  | gepaarte Änderung | familywise 95-%-CI    |
| ------ | ---------- | ---------- | ----------------- | --------------------- |
| TTFMF  | 179,546 ms | 152,606 ms | **`-16,44 %`**    | `-19,59 % … -13,69 %` |

Candidate standalone: 148,026 ms p50, 181,982 ms p95, 190,128 ms p99. Das absolute Ziel
`≤274,84 ms` ist bestanden. Das zusätzliche relative Ziel von `-30 %` gegen Wave 1 ist `OPEN`:
dafür wären höchstens 125,682 ms nötig; beim gepaarten Median fehlen rund 26,925 ms.

Ein bedeutungsvoller Frame verlangt einen tatsächlich nativ committed Textframe. Import-only,
Plaintext-Zwischenframe oder bloß erzeugter Renderer zählen nicht.

### W2-04 — Schlanke öffentliche Entrypoints (`HARD`)

Die additiven Subpaths `./renderer`, `./renderable`, `./audio`, `./image`,
`./markdown-tree-sitter` und `./console` bleiben reine Re-Exports. Lean Renderer/Renderable
dürfen Console-, Tree-sitter-, Image- oder Audio-Klassen nicht statisch einziehen. Root bleibt
kompatibel und registriert optionale Integrationen.

Später Console-Import kann einen bereits existierenden Renderer synchron materialisieren;
Registry-Tokens dürfen abgemeldete Vorgänger nicht wiederbeleben; Highlight-Completion ist
symbolisch gebrandet statt per Duck-Typing. Bun Source, Node ESM/CJS und gepackte Distribution
müssen alle Subpaths prüfen.

Evidenz: `.yesmem/wave2-loop-b-entrypoints-results.md`,
`.yesmem/wave2-integration-results.md` und die Import-Graph-/Lifecycle-Tests.

### W2-05 — Readiness ohne künstliche Blockade (`HARD`)

Reihenfolge: First Frame → Enhanced settled → Application ready. Frühe Renderfehler lehnen
korrekt ab; Destroy settlet definierte Zustände; nach Application-ready bleiben keine unnötigen
Listener. Die öffentliche synchrone Renderer-API wurde nicht async gemacht.

### W2-06 — Parser-Worker-Asset als gemessener No-op (`NO-OP`)

Der korrigierte Mediananteil der Worker-Assetauflösung lag bei ungefähr `0,22 %` und damit unter
der `2 %`-Go-Schwelle. Deshalb wurde keine zusätzliche Runtime-Policy eingebaut. Eine spätere
Version darf diesen Pfad erst nach neuer Attribution optimieren.

Wave-2-Gesamtevidenz: `.yesmem/bench/wave2-final-root-vs-renderer-clean/report.md` und
`.yesmem/wave2-integration-results.md`. Abschluss: 5.538 JS-Passes, 23 Skips, 0 Fails sowie
grüne Build-, Packed-Node-/Bun-, Format- und Lint-Gates.

## 8. Wave 3: integrierte Streaming-Wins und C9-Native-Candidate

Stabile Zwischenreferenz: `6ec90b97` (Runtimeintegration `917ef5f7` plus versionierter
Integrationsbericht). Die damalige Core-JS-Suite lief mit 5.592 Passes, 23 Skips und 0 Fails
über 203 Dateien. Dieser Stand wurde über die Consumer-Bridge `fcf1cb70` bis zum
C9-Candidate `11b1fdec` fortgeführt. Die vollständige Core-JS-Suite lief vor dem letzten
kompakten Snapshot-Refactor mit 5.612 Passes, 23 Skips und 0 Fails; danach liefen die 155
direkt betroffenen Tests mit einem intentionalen Skip und 0 Fails. Das native Gesamtgate
bestand mit 2.009 Passes, 8 Skips und 0 Fails. Root-Build und gepackte Node-ESM-/CJS-/Bun-
Distribution sind grün. Der Node-26-Quelltest hat in Baseline und Candidate dieselben sieben
bekannten Adapter-/Boolean-Assertion-Fehler und damit keine neue C9-Regression.

Das formale C9-A/B gegen `fcf1cb70` ist bestanden. Das übergreifende Wave-3-Gesamtgate mit
30 Paaren direkt gegen `fccae215` bleibt davon getrennt und weiterhin `OPEN`.

### W3-01 — Echtes Streaming-E2E-/Attributionsharness (`PASS` als Infrastruktur)

Der Harness wartet auf akzeptierte aktuelle Highlight-Generation, erwarteten gestylten Text und
erfolgreichen nativen Commit. Plaintext-Zwischenframes, unclean Arms, falsche Native-SHA,
Szenario-Mismatch und überlappende Mainthread-Spans sind Hard-Fails. Markdown-Tailklassen und
stabile Referenzen werden erfasst.

Wichtig: Die vorhandene n=10 Frozen-Baseline mit Mock-Client ist nur ein Balance-/Harness-Test.
Sie ist kein Wave-3-Performanceclaim und ersetzt nicht den Real-Worker-Lauf mit frischen
Prozessen.

Evidenz: `packages/core/.yesmem/wave3-loop-a-stream-gate-results.md` und
`packages/core/src/benchmark/wave3-*`.

### W3-02 — Latest-wins Worker-Backpressure (`LOOP-PASS`, struktureller Win)

Deterministischer Burst mit 100 Same-turn-Updates:

| Metrik                      | Ergebnis | hartes Gate                            |
| --------------------------- | -------- | -------------------------------------- |
| gepostete Workerjobs        | 2        | `≤2`                                   |
| superseded                  | 98       | `≥98`                                  |
| completed                   | 2        | finaler Zustand vorhanden              |
| active High-water           | 1        | `≤1` pro Buffer                        |
| pending High-water          | 1        | `≤1` pro Buffer                        |
| pendingByteHighWater        | 129 B    | nur neuester Payload, keine FIFO-Summe |
| erster Update → letzter ACK | 12,36 ms | Datenpunkt, kein A/B-Claim             |

Damit werden in diesem Burst 98 veraltete Jobs vor der Workerarbeit eliminiert. Der Client
settlet `updateBuffer` nur auf den exakten Versions-ACK; ein neuerer oder fremder ACK darf einen
aktiven älteren Job nicht fälschlich abschließen. State bleibt pro Buffer. Destroy, Remove,
Worker-Exit und Fehler leeren active/pending Bytes und settlen genau einmal.

Fail-Bedingungen: FIFO-Vollversionen, mehr als ein active plus ein latest pending, stale
Konvertierung/Commit, Cross-buffer-Blocking oder Work nach Destroy.

Evidenz: `.yesmem/wave3-loop-c-worker-results.md`, Rohdaten unter
`.yesmem/bench/wave3-loop-c/`, 66 Client-Tests und die Queue-Benchmark.

### W3-03 — Stale-Verwerfung vor Konvertierung und Commit (`HARD`)

Die monotone Code-Highlight-Generation wird vor der teuren Konvertierung und erneut vor dem
sichtbaren Commit geprüft. 100 schnelle Consumerupdates ergeben genau eine finale sichtbare
Generation; Filetype-Wechsel, Fehlerfallback und Destroy bleiben definiert. Injection,
Concealment, Links und Callbacksemantik dürfen nicht verloren gehen.

Bekannte Architekturrestschuld: `CodeHighlightSession.run()` ist noch nicht der einzige
Produktionspfad; `CodeRenderable` setzt dieselbe Invariante teilweise inline um. Eine spätere
Vereinheitlichung muss test-first erfolgen und darf keinen zweiten Policy-Owner erzeugen.

Evidenz: `.yesmem/wave3-loop-b-consumer-results.md`, 7 Session- und 6 Consumer-Vertragstests.

### W3-04 — Linearer Chunk-Sweep (`LOOP-PASS`, Performance `PROVISIONAL`)

Semantikgate:

- 20 Differentialfälle einschließlich Unicode, CRLF, equal boundaries, nested styles,
  Injection und Concealment;
- 0 Mismatches;
- realistische 5k: 28.520 Chunks in beiden Armen, byte-identisch;
- Injection-5k: 19.600 Chunks in beiden Armen, byte-identisch.

Ruhigeres Messfenster, n=25 in-process, Load ungefähr 7 auf 16 Kernen:

| Workload        | Baseline p50/p95   | Candidate p50/p95  | beobachteter Win             |
| --------------- | ------------------ | ------------------ | ---------------------------- |
| 1k, density 2   | 1,659 / 3,647 ms   | 1,182 / 2,921 ms   | p50 `-28,8 %`, p95 `-19,9 %` |
| realistische 5k | 17,064 / 21,635 ms | 10,591 / 12,905 ms | p50 `-37,9 %`, p95 `-40,3 %` |
| Injection-5k    | 28,844 / 33,163 ms | 13,746 / 15,597 ms | p50 `-52,3 %`, p95 `-53,0 %` |

Ein stärker belasteter Lauf bestätigte große p50-Gewinne für 5k, zeigte aber bei 1k p50/p95
Streuung bis leicht schlechter. Deshalb gelten als dauerhafte Loop-Gates:

- Outputparität immer exakt 100 %;
- 1k p95 unter vergleichbarer ruhiger Last `<8 ms`;
- realistische 5k p50 Candidate/Baseline `≤0,75`;
- Injection-5k p50 Candidate/Baseline `≤0,55`;
- small/sparse p50 nicht schlechter als `+3 %`.

Für einen allgemeinen Wave-3-Claim müssen diese Werte mit ruhigem Host und im finalen
Streaming-E2E-Harness bestätigt werden.

Evidenz: `.yesmem/wave3-loop-d-chunk-results.md` und `.yesmem/bench/wave3-loop-d/`.

### W3-05 — Real-Worker-E2E-Wallgate (`PASS` für C9, Gesamt-CPU `OPEN`)

Finaler C9-Lauf: Consumer-Bridge `fcf1cb70` gegen Candidate `11b1fdec`, je 30 balancierte
Paare, drei Warmups, frischer Prozess je Arm, 20.000 Bootstrap-Samples. Weil C9 nativen Code
ändert, wurden die Binaries separat gepinnt: Baseline `e7e97644…`, Candidate `deacf806…`.
Die Hostlast stieg von 6,45 auf 12,93; deshalb sind die absoluten Zeiten Diagnosewerte, die
großen gepaarten Effekte und alle 30/30 schnelleren Candidate-Paare bleiben belastbar.

| Szenario                 |                 Baseline p50/p95/p99 |          Candidate p50/p95/p99 | gepaarter Win |    familywise 95-%-CI |      p95-Win |
| ------------------------ | -----------------------------------: | -----------------------------: | ------------: | --------------------: | -----------: |
| Cold 1.000 Zeilen        | 1.059,895 / 1.454,841 / 1.594,719 ms | 439,579 / 550,660 / 601,198 ms |  **-59,43 %** | **-61,31 … -57,23 %** | **-62,15 %** |
| Warm 1.000 + 100 Appends |   872,224 / 1.315,084 / 1.387,803 ms | 105,486 / 167,311 / 175,709 ms |  **-87,58 %** | **-88,71 … -86,29 %** | **-87,28 %** |

Framebuffer-, Span- und Chunk-Digests waren in allen Paaren exakt gleich. Der
Update→gestylter-nativer-Commit-Walltarget von mindestens 30 % ist damit bestanden. Die im
Report aufgeführten Converterwerte sind bewusst nur post-run Diagnostik: Sie werden nach dem
zustandsbehafteten Renderpfad gemessen; für C3 bleibt der isolierte Converter-Gate
maßgeblich, dessen Runtimecode zwischen den beiden C9-Armen unverändert ist.

Noch `OPEN` für ein pauschales Wave-3-Gesamt-PASS:

- disjunkte reine Mainthread-CPU-Stufen mit familywise oberer CI `≤-30 %`;
- 10.000 Rolling-Updates mit fester Dokument-/Viewportgröße ohne ungebundenes Heap-, Queue-,
  Worker-, Listener-, Timer- oder FFI-Handle-Wachstum;
- die verbleibenden Layout-/Partial-Safety-Achsen aus dem Wave-3-Plan.

Evidenz: `.yesmem/bench/wave3-c9-native-final-runs-2026-08-18/{raw.ndjson,report.md,summary.json}`.

### W3-06 — Inkrementeller nativer Styled-TextBuffer (`PASS`, integriert)

Der frühere Full-Replacement-Pfad verbrauchte in einer attribuierten Warmprobe rund 512,6 ms
von 545,9 ms Worker+Pipeline-Zeit und überschritt die 10-%-Go-Schwelle deutlich. C9 ergänzt
deshalb einen konservativen nativen Append-Pfad:

- nur echte Source- und Rendered-Text-Appends an sicheren Zeilengrenzen;
- unveränderter Prefix wird text-, style-, attribute- und linkgenau geprüft;
- kompakte immutable Style-Runs halten keine mutierbaren Chunk-/RGBA-Objekte fest;
- Unicode, CRLF, Combining, ZWJ, Flags, Skin tones, Hangul, Keycaps sowie none/char/word-wrap
  sind differential gegen Full Replacement geprüft;
- unsichere Edits, Stylewechsel, Registry-Grenze oder Native-Fehler fallen auf Full Replacement
  zurück;
- native Tail-Buffer sind explizit owned, begrenzt und werden bei Clear/Reset/Destroy genau
  freigegeben;
- Styledefinitionen werden nach exakter Definition wiederverwendet; die frühere
  Chunk×Line-Schleife wurde durch einen monotonen Line-Hint ersetzt.

Eine einzelne attribuierte Candidate-Probe lag für den nativen Append bei 5,76 ms. Dieser
Stagewert ist Diagnose, nicht der finale Claim; maßgeblich ist das gepaarte E2E-Gate W3-05.
Die C9-Commits beginnen bei `32ff2072` und enden auf `11b1fdec`.
Der integrierte Runtimebaum auf `b4e6d8b1` ist für `packages/core/src` bytegleich mit
`11b1fdec`.

Der echte Fresh-process-/Real-Worker-Runner wurde dafür getrennt auf
`yesloop/wave3-clean-gate@b2ac235d` angelegt. Er misst `fccae215` gegen exakt `6ec90b97`, pinnt
die Native-SHA, prüft Frame-/Span-/Chunk-Digests und verweigert den Start bei fremden
Bun-Prozessen oder Load >4. Reine Mainthread-CPU bleibt `UNCLEAR`, solange der Produktionspfad
keine disjunkten Stage-Spans aufzeichnet; Gesamtprozess-CPU darf dafür nicht ersatzweise
verwendet werden.

## 9. Noch offene Risiken und bewusst nicht erreichte Ziele

| ID   | Status  | Punkt                                                                                                            |
| ---- | ------- | ---------------------------------------------------------------------------------------------------------------- |
| R-01 | `OPEN`  | Wave-1 Custom-Feed 25k p95 `+11,26 %`; sichere Ownership darf nicht entfernt werden                              |
| R-02 | `OPEN`  | relatives Wave-2-TTFMF-Ziel `-30 %`; aktuell `-16,44 %`                                                          |
| R-03 | `PARKED` | E2E-Wallgate grün; disjunkte Mainthread-CPU + Startup + Rolling-Memory formale n=30 unter Last UNCLEAR/-kontaminiert (kein Rückschritt belegt). Owner-Entscheidung 2026-08-20: ruhiges Messfenster (Load <4) realistisch nicht erreichbar — Zertifizierung geparkt, Referenzstand Tag `wave3-final` (f4fcb1fb) |
| R-04 | `OPEN`  | C5 kompakte Spans/Transferables nur nach Clone-Profil; portabler Worker-Seam hat noch keine Transferliste        |
| R-05 | `NO-OP` | B4 Native-Library-Split/Symboltrim erst nach neuem isolierten Cost-Weight-Beleg                                  |
| R-06 | `PASS`  | Bun-Worker-Resolve hinter dem Plattformseam (Wave-4, 9424766f); worker-Suiten grün           |
| R-07 | `PASS`  | ConsoleCapture/TerminalConsoleCache refcounted (Wave-4, e9057389+058a7a84+a84e5aa4); Zwei-Renderer-Szenario getestet |
| R-08 | `OPEN`  | updateFromLayout-FFI-Storm behoben (Epoch-Guard, Wave-4 37e3b10a); `hasSafePartialComposition` bleibt potenziell O(K·N) — erst Scaling-Gate, dann Umbau |
| R-09 | `OPEN`  | Streaming-Layout kann stabile Geschwister global traversieren; Wave 3 misst, optimiert diesen Bereich noch nicht |
| R-10 | `PASS`  | C9 TextBuffer-Tail auf `b4e6d8b1` integriert; W3-05-/W3-06-Gates und Runtime-Gleichheit belegt                   |

## 10. Ausführbare Prüfbefehle

Alle Paketbefehle aus `packages/core` ausführen. Vor Performance-Läufen zuerst `ps -C bun`,
`uptime`, Runtimeversionen und Native-SHA protokollieren.

### 10.1 Funktionale Fastpatch-/Partial-Gates

```bash
bun test src/tests/renderer.partial-render.test.ts src/tests/renderable.test.ts
bun test src/renderables/Code.test.ts
```

### 10.2 Lifecycle-/Hang-Gates

Die engsten betroffenen Dateien zuerst auswählen; danach die vollständige JS-Suite:

```bash
bun test src/tests/renderer.feed-lifecycle.test.ts
bun test src/lib/tree-sitter/client.test.ts
bun run test:js
```

Die Dateinamen können bei späteren Refactors verschoben werden; die Gate-IDs und beobachtbaren
Invarianten aus Abschnitt 6 bleiben verbindlich.

### 10.3 Wave-2-Startupregression gegen denselben öffentlichen Pfad

Vorher einen frischen detached Baseline-Worktree auf `fccae215` anlegen und in beiden Armen
dieselbe Native-SHA pinnen:

```bash
OPENTUI_BENCH_DIR=<append-only-output> bun run bench:cold-import \
  --gate \
  --baseline-root=home/user/projects/opentui/.worktrees/wave3-baseline \
  --baseline-label=wave2-fccae215 \
  --baseline-scenario=renderer-entry \
  --scenario=renderer-entry \
  --runtime=bun \
  --samples=30 \
  --warmup=3 \
  --bootstrap=20000 \
  --threshold=3 \
  --artifact=<wave-and-date>
```

Für die historische UX-Gewinnkontrolle separat Wave 1 `root` gegen Candidate
`renderer-entry` laufen lassen; die beiden Resultate nicht vermischen.

### 10.4 Wave-3-Harness und Attribution

```bash
bun test src/telemetry.wave3.test.ts src/telemetry.test.ts \
  src/benchmark/wave3-harness.test.ts \
  src/benchmark/wave3-markdown-attribution.test.ts
bun run bench:wave3:baseline -- --pairs 30 --scenario=code-stream:100
bun run bench:wave3:baseline -- --pairs 30 --scenario=code-stream:5000
```

Der aktuelle `wave3-baseline.ts` verwendet noch den kontrollierten Completion-Seam. Für das
finale W3-05-Gate muss der Integrationsrunner beide echten Git-Arme in frischen Prozessen und
mit echtem Worker ausführen.

### 10.5 Worker-Queue und Consumer

```bash
bun test src/lib/tree-sitter/client.test.ts
bun test src/renderables/CodeHighlightSession.test.ts \
  src/renderables/CodeHighlightConsumer.test.ts \
  src/renderables/Code.test.ts
bun src/benchmark/wave3-worker-queue-benchmark.ts
```

Die Queue-Benchmark schreibt append-only unter `.yesmem/bench/wave3-loop-c/`. Der Lauf ist nur
grün, wenn posted/superseded/HWM/Bytes und Cleanup gemeinsam bestehen.

### 10.6 Chunk-Sweep

```bash
bun test src/lib/tree-sitter-styled-text.test.ts
bun ../../.yesmem/bench/wave3-loop-d/bench.ts
```

Da der Microbenchmark in-process läuft, zählen primär das gepaarte Verhältnis und die
Outputparität; absolute Millisekunden nur unter vergleichbarer ruhiger Last.

### 10.7 C9 Native-Real-Worker-Gate

Aus dem versionierten Gate-Worktree, mit sauberer Consumer-Bridge-Baseline und sauberem
Candidate:

```bash
bun packages/core/scripts/wave3-clean-gate.ts \
  --baseline-root=home/user/projects/opentui/.worktrees/wave3-consumer-bridge \
  --candidate-root=home/user/projects/opentui/.worktrees/wave3-textbuffer-tail \
  --baseline-revision=fcf1cb70659c9b39b0b7d9f3168e2d894b16a0b3 \
  --candidate-revision=11b1fdec1d56282237bd068f798fa139a66deb19 \
  --native-policy=per-arm \
  --pairs=30 --warmups=3 --max-load=30 \
  --output-dir=<append-only-output>
```

Vorher beide Native-SHAs und `ps -C bun` prüfen. `per-arm` ist hier erforderlich, weil genau
die native C9-Implementierung verglichen wird; für TypeScript-only-Vergleiche bleibt die
Defaultpolicy `identical` zwingend.

### 10.8 Paket-/Portabilitätsabschluss

```bash
bun run build:lib
bun run test:js
bun run test:js:node
bun run test:dist --skip-build
```

Bei Native- oder Cross-package-Änderungen zusätzlich mit Zig 0.16:

```bash
bun run test:native
```

Danach vom Repository-Root, sofern der Scope es verlangt:

```bash
bun run fmt:check
bun run lint
```

Ein Baseline-identischer Umgebungsfehler darf dokumentiert werden, aber kein neuer Fehler darf
als „vorbestehend“ klassifiziert werden, ohne denselben Befehl am eingefrorenen Baselinecommit
auszuführen.

## 11. Release-/Wave-Abnahmeblatt

Für jede neue Version diesen Block kopieren und ausgefüllt unter einem neuen Unterabschnitt
anhängen. Alte Abnahmen bleiben unverändert.

```text
Datum/Run-ID:
Candidate-Branch/Worktree:
Candidate-Commit:
Vergleichscommit und Worktree:
OpenTUI-Version/git describe:
Bun/Node/Zig:
Native-SHA beider Arme:
Host/CPU/Governor/Load vorher-nachher:
Andere Bun-Prozesse: keine / begründet
Gitstatus beider Arme: clean / begründet
Szenario/Viewport/Input/Seed:
Paare/Warmups/Bootstrap:

FP-01..03: PASS/FAIL/N/A + Evidenz
W0-01..02: PASS/FAIL/N/A + Evidenz
W1-01..04: PASS/FAIL/N/A + Evidenz
W2-01..06: PASS/FAIL/N/A + Evidenz
W3-01..05: PASS/FAIL/UNCLEAR/N/A + Evidenz
R-01..10 verändert: nein / ja, warum

Import p50/p95/p99 + paired CI:
TTFMF p50/p95/p99 + paired CI:
Streaming Mainthread p50/p95/p99 + paired CI:
Update→styled Commit p50/p95/p99 + paired CI:
Queue posted/superseded/HWM/Bytes:
Converter 1k/5k/injection p50/p95/p99 + Ratios:
Output-/Style-/Link-Parität:
Heap/Handles/Listener/Timer/Worker nach Lifecycle:
Test-/Build-/Dist-/Fmt-/Lint-Ergebnis:

Gesamturteil: PASS / FAIL / UNCLEAR
Offene Abweichung und Owner:
Rohdatenpfad:
Reportpfad:
```

### 11.1 C9-Abnahme 2026-08-18

```text
Datum/Run-ID: 2026-08-18 / wave3-c9-native-final-runs
Candidate-Branch/Worktree: yesloop/wave3-textbuffer-tail / .worktrees/wave3-textbuffer-tail
Candidate-Commit: 11b1fdec1d56282237bd068f798fa139a66deb19
Vergleichscommit und Worktree: fcf1cb70659c9b39b0b7d9f3168e2d894b16a0b3 / .worktrees/wave3-consumer-bridge
OpenTUI-Version/git describe: 0.5.3 / v0.5.3-98-g11b1fdec
Bun/Node/Zig: 1.3.14 / 26.4.0 funktional (Messhost process v24.3.0) / 0.16.0
Native-SHA: baseline e7e9764462f2… / candidate deacf8067c00…
Load vorher-nachher: 6.45/7.62/7.81 -> 12.93/9.73/8.56
Andere Bun-Prozesse: keine beim Gate-Start
Gitstatus beider Messarme: clean
Szenario: 80x24, TypeScript 1.000 Zeilen cold sowie 1.000 + 100 monotone Same-turn-Appends
Paare/Warmups/Bootstrap: 30 je Szenario / 3 je Arm und Szenario / 20.000

W3-02/03: PASS, deterministische Queue-/Stale-/Finaloutput-Gates
W3-04: unverändert; isolierter C3-Gate bleibt maßgeblich
W3-05 Wall: PASS; pure Mainthread-CPU und Rolling-Memory UNCLEAR
W3-06 C9: PASS auf eigenem Branch

Cold Update→styled Commit: candidate 439.579/550.660/601.198 ms p50/p95/p99;
  paired -59.43 %, familywise CI -61.31…-57.23 %
Warm Update→styled Commit: candidate 105.486/167.311/175.709 ms p50/p95/p99;
  paired -87.58 %, familywise CI -88.71…-86.29 %
Output-/Style-/Link-Parität: PASS, alle Frame-/Span-/Chunk-Digests identisch
Heap/Handles/Listener/Timer/Worker: fokussierte Ownership-/Bound-Tests PASS; Rolling-10k offen
Tests: 5.612 JS-Passes vor finalem Snapshot-Refactor; danach 155 fokussiert PASS, 1 Skip;
  native 2.009 PASS/8 Skip; packed Dist PASS; Root-Build PASS; Lint 0/0
Node Source: Baseline und Candidate identische 7 bekannte Adapter-/Boolean-Testfehler
Fmt: geänderte Dateien PASS; globaler Check in beiden Armen am geerbten
  .yesmem/wave3-integration-results.md-Format blocker

Gesamturteil: C9 PASS; gesamtes Wave 3 UNCLEAR bis Mainthread-CPU und Rolling-Memory grün
Rohdatenpfad: .yesmem/bench/wave3-c9-native-final-runs-2026-08-18/raw.ndjson
Reportpfad: .yesmem/bench/wave3-c9-native-final-runs-2026-08-18/report.md
```

### 11.2 Wave-3-final-Abnahme 2026-08-19

```text
Datum/Run-ID: 2026-08-19 / wave3-final-integration
Candidate-Branch/Worktree: yesloop/wave3-streaming-integration / .worktrees/wave3-integration
Candidate-Commit: b416a75d (Integration-HEAD, über B+D+C-Harnesses + Formalgates)
Vergleichscommit und Worktree: fccae215 / .worktrees/wave3-baseline (detached)
OpenTUI-Version/git describe: 0.5.3 / v0.5.3-…-gab2b9ebc
Bun/Node/Zig: 1.3.14 / 26.4.0 (Seam) / 0.16.0
Native-SHA: baseline e7e9764462f2… / candidate deacf8067c00… (integrierter Build c5c69aaad20d)
Load vorher-nachher: oszillierend, 1-min-peak bis ~8.7 (> Gate-Budget 4) — UNCLEAR-Auslöser
Andere Bun-Prozesse: keine zur Messung
Gitstatus beider Messarme: sauber (Baseline mit dokumentierten untracked probe/.yesmem)
Szenario: cold-1000 + warm-1000-append100 (CPU), Import+TTFMF (Startup), Rolling Memory (Eventloop-p99)
Paare/Warmups/Bootstrap: 30 je Arm und Szenario / 3 / 20.000

W3-01: PASS (Infrastruktur, disjunkte Stufen + styled-Commit-Orakel)
W3-02/03/04: unverändert durch B/D/C (nur additive Bench/Measurement)
W3-05 Wall: PASS für Primärziel (Teilsumme) unter UNCLEAR-load — Zahlen stark positiv, Endurteil messfenster-pflichtig
W3-06 C9: PASS (bereits in Teilnahme)
Memory Rolling-10k: Absolutgates PASS; formales A/B durch Baseline-Load-Pollution invalidiert (kein Rückschritt)
C5 kompakte Spans: NO-GO/DEFER (Worker→Main-Anteil nicht sauber quantifizierbar)

CPU cold-1000 mainThread: candidate 99.813/142.576/148.588 ms; paired -83.03 %, CI -83.89…-82.12 %
CPU warm-append100 mainThread: candidate 45.335/76.429/91.063 ms; paired -92.93 %
CPU updateToStyledCommit: cold -59.67 %, warm -88.09 % (partial-sum, layout fehlt)
Startup import p50: -4.52 %; TTFMF p50: -4.72 % (UNCLEAR-load, kein Rückschritt)
Memory Eventloop-p99: saubere Indikation +2.66 % (≤+5 %, kein Rückschritt)

Test-/Build-/Dist-Jun-2026: test:js 5678/0 · build:native EXIT0 · test:native 2009/8 · build:lib EXIT0 ·
  test:dist PASS · test:js:node 4742/7 (vorbestehend) · D/partial safety 106/0 · oxfmt/oxlint grün

Gesamturteil: UNCLEAR (Load-Guard) — funktional READY, formal zu zertifizieren
Offene Abweichung und Owner: formale Gesamt-A/B im ruhigen Messfenster (Koordinator); test:js:node 7 vorab
Rohdatenpfad: .yesmem/bench/wave3-final-cpu-formal/ · wave3-startup-formal/ · wave3-memory-formal/
Reportpfad: .yesmem/wave3-final-results.md
```

### 11.3 Wave-4-Abnahme 2026-08-20

```text
Datum/Run-ID: 2026-08-20 / wave4-robustness-ffi-merge
Candidate-Branch/Worktree: fastpatch (Merges 253b9903 + 8456f724) / .worktrees/fastpatch
Candidate-Commit: 2ff015da (nach Integrations-Fixes a84e5aa4, 195d0be1, 5957da1b)
Vergleichscommit und Worktree: 8816eebd (= fastpatch vor Wave-4, identischer Baum-Basis)
OpenTUI-Version/git describe: 0.5.3 / v0.5.3-104+-g2ff015da
Bun/Node/Zig: 1.3.14 / n.a. (Sandbox) / 0.16.0 (Build via PATH-Override)
Native-SHA: a2709a93 (SRC-Build; symboltextBufferAppendStyledText vorhanden, nm verifiziert)
Host/CPU/Governor/Load: Load während Suite ~2.3-8 (oszillierend; R-03 bleibt geparkt)
Gitstatus: clean nach jedem Commit-Schritt

R-06: PASS — Worker-Resolve hinter Plattform-Seam (9424766f); worker.test 6/0, worker.node-test tsc-noEmit exit 0
R-07: PASS — ConsoleCapture-Refcount (e9057389) + Idempotenz-Guard (058a7a84); console.test 34/0.
  INTEGRATIONS-FIX des Koordinators: _useConsole-Default true→false (a84e5aa4) — der Idempotenz-Guard
  skippte sonst die Erstkativierung (vorbestehender Test rot, jetzt grün; Ursache vom Agenten in Sandbox
  nicht lauffähig, CI-gated vermutet)
R-08 (Teil FFI-Roundtrip): PASS — Epoch-Guard in updateFromLayout (37e3b10a + Escape-Hatch d51cd5f4).
  Eigene A/B-Rotation des Koordinators: Baseline-Renderable.ts → Scroll-Frame-Test ROT; mit Guard 3/0 grün.
  Matrix-Harness (culling 100-10k) pre/post identisch (1007/10007 auf dem EINEN legitimen Dirty-Settle-Frame,
  Reuse-Frames FFI=0, renderListReuses steigt, renderCommands geculled begrenzt 33) — Erwartung, das
  Matrix-Szenario scrollt nicht; der Guard wirkt auf Scroll-Frames (translate-only).
R-08 (Teil hasSafePartialComposition O(K·N)): UNVERÄNDERT OPEN — bewusst out of scope (E1-Folgearbeit).
R-01/R-02/R-03/R-04/R-09: unverändert (R-03 PARKED per Owner-Entscheidung).

Test-/Build-/Fmt-/Lint-Ergebnis (2026-08-20 11:38):
  test:js 5692 pass / 0 fail / 5715 (23 skip) · build (zig 0.16.0) EXIT 0 · oxlint 0/0 ·
  fmt:check GRÜN nach 195d0be1 (3 Dateien nachformatiert) + 5957da1b (.yesmem-Evidenz aus oxfmt ignoriert)
  Memory-Gate-Harness: eigenes 60s-Timeout (2ff015da) — Full-Gate ~7s, vorher 5s-Default-Timeout-Falle
  unter Last (A/B-Verifikation: identischer Fail mit/ohne Console-Fix → reines Zeitfenster, #85594-Klasse)

Gesamturteil: PASS (funktional; deterministische Counterevidenz) — formale n=30-Walltimes bleiben
  geparkt (R-03), keine neuen Wall-Gates in dieser Welle
Offene Abweichung und Owner: E1-O(N)-Scan + hasSafePartialComposition-Umbau (Wave-5-Kandidat);
  test:js:node 7 vorbestehend
Rohdatenpfad: packages/core/.yesmem/bench/wave3-render-scaling/wave3-render-scaling-2026-08-20T09-38-55-988Z.json
Reportpfad: .yesmem/bench/wave4-ffi-roundtrip-results.md (Loop-1-Agent) + dieser Block
```

## 12. Evidenzindex

- Fastpatch-Codeanalyse: `.yesmem/ptomanalyse.md` im Repository-Hauptworktree
- Wave-0-Baseline: `packages/core/bench/base/wave0-r4/report.md` im Wave-0-Worktree
- Wave 1: `.yesmem/wave1-lifecycle-results.md`
- Wave 2 gesamt: `.yesmem/wave2-integration-results.md`
- Wave 2 Startup-Rohdaten/-Report:
  `.yesmem/bench/wave2-final-root-vs-renderer-clean/`
- Wave 2 Lazy FFI: `.yesmem/wave2-loop-a-native-ffi-results.md`
- Wave 2 Entrypoints: `.yesmem/wave2-loop-b-entrypoints-results.md`
- Wave 3 Harness: `packages/core/.yesmem/wave3-loop-a-stream-gate-results.md`
- Wave 3 Consumer: `.yesmem/wave3-loop-b-consumer-results.md`
- Wave 3 Queue: `.yesmem/wave3-loop-c-worker-results.md` und
  `.yesmem/bench/wave3-loop-c/`
- Wave 3 Chunk-Sweep: `.yesmem/wave3-loop-d-chunk-results.md` und
  `.yesmem/bench/wave3-loop-d/`
- Wave 3 C9 Real-Worker/native A/B:
  `.yesmem/bench/wave3-c9-native-final-runs-2026-08-18/`
- Wave-3-Implementierungsvertrag:
  `.yesmem/plan/2026-08-17-wave3-parallel-agent-implementation.md` am Plancommit `82ee8b99`

## 13. Pflegevertrag

- Neue Wins erhalten eine stabile Gate-ID, Baselinecommit, Messgrenze, Fail-Bedingung,
  reproduzierbaren Befehl und einen Rohdatenpfad.
- Eine Zahl wird erst von `PROVISIONAL` auf `PASS` hochgestuft, wenn die dafür definierte
  Stichprobe und Provenienz vollständig sind.
- Ein No-op bleibt sichtbar; spätere Agenten dürfen ihn nicht ohne neue Attribution erneut
  implementieren.
- Ein Sicherheitsfix darf nicht für einen Microbenchmark entfernt werden. Erst eine alternative
  Ownership-/Lifecycle-Lösung mit denselben Hard-Gates kann ihn ersetzen.
- Bei Rebase auf einen neuen Upstreamstand wird zuerst die Baseline-Leiter ergänzt, dann werden
  die bestehenden IDs erneut geprüft. Historische Reports werden niemals auf die neue Version
  umetikettiert.
