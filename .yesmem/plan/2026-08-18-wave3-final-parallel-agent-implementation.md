# Wave 3 Abschluss: paralleler Agentenplan für Praxis-, CPU-, Memory- und Skalierungsgates

Stand: 2026-08-18

## 0. Dringender Basis- und Vergleichsvertrag

> **Jeder Agent bestätigt diesen Abschnitt vor der ersten Änderung. Bei einer Abweichung gilt STOP.**
>
> OpenTUI-Kandidat:
>
> - Quellworktree: `home/user/projects/opentui/.worktrees/wave3-integration`
> - Branch: `yesloop/wave3-streaming-integration`
> - Exakter gemeinsamer Agenten-Basiscommit:
>   `ab2b9ebcdc7bb56cbfe7e00f871351d1aa4de325`
> - Letzter Runtime-Commit in dieser Linie:
>   `ab2b9ebcdc7bb56cbfe7e00f871351d1aa4de325` (inkl. `fix(core): free replaced
>   tree-sitter trees exactly once`, der Parser-Tree-Ownership-Commit nach `b4e6d8b1`)
> - OpenTUI-Paket: `@opentui/core@0.5.3`
> - Git-Describe: `v0.5.3-110-gab2b9ebc`
> - Enthalten: patched.98, Fastpatch 0.5.3, Wave 0–2, Wave-3-A→C→B→D,
>   Consumer-Bridge, C9 und Parser-Tree-Ownership-Fix.
>
> Primäre OpenTUI-Performancebaseline:
>
> - Commit: `fccae2158d5c98949fc050913b918621af918111`
> - Branchherkunft: `yesloop/wave2-startup-integration`
> - Detached Worktree: `home/user/projects/opentui/.worktrees/wave3-baseline`
> - Paket: `@opentui/core@0.5.3`
> - Git-Describe: `v0.5.3-75-gfccae215`
>
> OpenCode-Praxistest:
>
> - Repository: `home/user/projects/opencode`
> - Kanonische Quellbranch: `working`
> - Exakter, für beide A/B-Arme identischer OpenCode-Commit:
>   `54565da2792fdac495a266261d81bf8e980d33e7`
> - OpenCode-Version: `1.18.18`
> - Git-Describe: `1.18.18-patched.112-77-g54565da279`
> - Der Hauptworktree `home/user/projects/opencode` ist dirty und darf nicht benutzt werden.
> - OpenCode-Baseline: unverändertes/publiziertes `@opentui/*@0.5.3`.
> - OpenCode-Kandidat: exakt derselbe OpenCode-Commit mit Overlay aus dem obigen
>   OpenTUI-Wave-3-Kandidaten.

Für den OpenTUI-Gesamtvergleich sind `fastpatch@2cd44364`, patched.98, Wave 1,
`6ec90b97`, `11b1fdec`, einzelne Agentenbranches, `main`, `origin/main` und Upstream
keine Ersatzbaseline. Der Vergleich lautet ausschließlich:

`fccae215` → `ab2b9ebc` mit Runtimeinhalt bis `ab2b9ebc` (inkl. Parser-Ownership-Fix).

Für OpenCode wird nie gleichzeitig die OpenCode-Quellrevision gewechselt. Sonst wäre nicht
mehr feststellbar, ob eine Abweichung aus OpenTUI oder OpenCode stammt.

Der Plan liegt nach dem Agenten-Basiscommit im Integrationsworktree. Die Agentenbranches
starten trotzdem bewusst von `ab2b9ebc` und lesen diesen Plan über seinen absoluten Pfad:

`home/user/projects/opentui/.worktrees/wave3-integration/.yesmem/plan/2026-08-18-wave3-final-parallel-agent-implementation.md`

## 1. Bereits erledigt – nicht erneut implementieren

Die folgenden Punkte sind auf dem Kandidaten vorhanden und durch
`.yesmem/performance-regression-ledger.md` sowie `.yesmem/wave3-c9-integration-results.md`
belegt:

- Latest-wins pro Tree-sitter-Buffer: höchstens ein aktiver und ein neuester wartender Job;
- versioniertes Worker-ACK statt Settle direkt nach `postMessage`;
- Stale-Verwerfung vor Konvertierung und vor UI-Commit;
- vollständige Injection-/Conceal-/Link-Semantik des Bufferpfads;
- linearer Chunk-Sweep mit Differentialkorpus;
- Consumer-Bridge im echten `CodeRenderable`-Renderpfad;
- C9: konservativer inkrementeller nativer StyledText-Tail mit sicherem Fallback;
- Root-Build, Node/Bun Packed Dist, 5.618 JS- und 2.009 Native-Passes;
- formales C9-Wallgate gegen die Consumer-Bridge:
  Cold `-59,43 %`, warmes Streaming `-87,58 %`.

`.yesmem/perftodo.md` enthält noch veraltete offene B-/C-Checkboxen. Für den tatsächlichen
Status ist das Performance-Regression-Ledger maßgeblich. Kein Agent baut B1–B3/B5/B6,
C1–C4/C6/C9 oder die Consumer-Bridge ein zweites Mal.

Die noch offenen Wave-3-Punkte sind:

1. OpenCode-Praxistest mit dem Wave-3-Overlay;
2. Gesamt-A/B direkt gegen `fccae215`;
3. disjunkte reine Mainthread-CPU-Messung;
4. Rolling-10k-Memory-/Leak-Gate;
5. Layout-/Partial-Skalierungs- und Regressionsgate;
6. C5 nur bei positivem Clone-/Objektaufbauprofil.

Das zusätzliche relative Startupziel `-30 %` gehört **nicht** zum Wave-3-Abschluss. Wave 3
prüft Startup nur auf Regression. Die letzte belastbare Wave-2-Messung bleibt:
Import etwa 29–30 ms p50, TTFMF 148,026/181,982/190,128 ms p50/p95/p99 und gepaart
`-16,44 %` gegen Wave 1.

## 2. Parallele Erstaufteilung

| Loop | Repository | Auftrag                                              | Branch                         | Worktree                                                       |
| ---- | ---------- | ---------------------------------------------------- | ------------------------------ | -------------------------------------------------------------- |
| A    | OpenCode   | echter OpenCode-A/B-Praxistest                       | `wave3-opentui-test`           | `home/user/projects/opencode/.worktrees/wave3-opentui-test`  |
| B    | OpenTUI    | Gesamt-E2E, disjunkte Mainthread-CPU, Startup-Safety | `yesloop/wave3-final-cpu`      | `home/user/projects/opentui/.worktrees/wave3-final-cpu`      |
| C    | OpenTUI    | Rolling-10k-Memory und 100× Lifecycle                | `yesloop/wave3-memory-gate`    | `home/user/projects/opentui/.worktrees/wave3-memory-gate`    |
| D    | OpenTUI    | Layout-/Partial-Skalierung und Safety-Oracles        | `yesloop/wave3-render-scaling` | `home/user/projects/opentui/.worktrees/wave3-render-scaling` |

Die vier Loops dürfen Implementierung, Tests und kurze Diagnoseläufe parallel ausführen.
Formale Performance- und Memory-Endmessungen laufen seriell. Der Koordinator vergibt dafür
ein ruhiges Messfenster; kein Agent startet eigenmächtig n=30-Läufe während anderer Bun-,
Zig-, OpenCode- oder Buildprozesse.

Nicht parallel in einem fünften Erstloop:

- C5 kompakte Worker-Spans/Transferables;
- Layout-/Partial-Optimierungen E1–E6/F1–F7;
- Startup-FFI-Umbauten oder `.so`-Aufteilung;
- OpenCode-eigene Summaries/Eventlog/SQLite/MCP-/Provideroptimierungen;
- Frameworkadapter, Audio, Image oder native Renderer-Feinoptimierungen.

Loops B–D bauen Mess- und Abnahmefähigkeit. Sie ändern keine Produktionspolicy. Findet ein
Gate eine Regression, endet der Loop mit reproduzierbarem FAIL/UNCLEAR und einer präzisen
Ursachenlokalisierung. Er zieht nicht ungeplant die nächste Optimierungswelle in Wave 3.

## 3. Vorbereitung durch den Koordinator

### 3.1 OpenTUI-Quellen prüfen

```bash
git -C home/user/projects/opentui/.worktrees/wave3-integration status --short
git -C home/user/projects/opentui/.worktrees/wave3-integration branch --show-current
git -C home/user/projects/opentui/.worktrees/wave3-integration rev-parse HEAD
git -C home/user/projects/opentui/.worktrees/wave3-integration \
  merge-base --is-ancestor ab2b9ebcdc7bb56cbfe7e00f871351d1aa4de325 HEAD
git -C home/user/projects/opentui/.worktrees/wave3-integration \
  diff --exit-code ab2b9ebcdc7bb56cbfe7e00f871351d1aa4de325 HEAD -- packages/core
git -C home/user/projects/opentui/.worktrees/wave3-baseline status --short
git -C home/user/projects/opentui/.worktrees/wave3-baseline rev-parse HEAD
jq -r '.name + "@" + .version' \
  home/user/projects/opentui/.worktrees/wave3-integration/packages/core/package.json
```

Erwartet: Der Integrationsbranch enthält `ab2b9ebc...` als gemeinsamen Agenten-Basiscommit
(inkl. Parser-Tree-Ownership-Fix) und hat danach höchstens Plan-/Dokumentcommits, aber keinen
weiteren `packages/core`-Diff. Die Baseline steht detached auf exakt `fccae215...`; beide
Worktrees sind sauber und melden `@opentui/core@0.5.3`.

### 3.2 Drei OpenTUI-Agentenworktrees anlegen

Existiert ein Pfad oder Branch bereits, nichts löschen oder überschreiben. Erst Branch, HEAD
und Status melden und bei Abweichung stoppen.

```bash
cd home/user/projects/opentui

git worktree add -b yesloop/wave3-final-cpu \
  home/user/projects/opentui/.worktrees/wave3-final-cpu \
  ab2b9ebcdc7bb56cbfe7e00f871351d1aa4de325

git worktree add -b yesloop/wave3-memory-gate \
  home/user/projects/opentui/.worktrees/wave3-memory-gate \
  ab2b9ebcdc7bb56cbfe7e00f871351d1aa4de325

git worktree add -b yesloop/wave3-render-scaling \
  home/user/projects/opentui/.worktrees/wave3-render-scaling \
  ab2b9ebcdc7bb56cbfe7e00f871351d1aa4de325
```

Danach in jedem neuen OpenTUI-Worktree einmal `bun install`.

### 3.3 OpenCode-A/B-Worktrees anlegen

OpenCode-Branchregeln erlauben höchstens drei Wörter und keine Slash-Präfixe. Der Agent
arbeitet nicht im dirty Hauptworktree und nicht im älteren `perf-integration`-Worktree.

```bash
cd home/user/projects/opencode

git worktree add --detach \
  home/user/projects/opencode/.worktrees/wave3-opentui-baseline \
  54565da2792fdac495a266261d81bf8e980d33e7

git worktree add -b wave3-opentui-test \
  home/user/projects/opencode/.worktrees/wave3-opentui-test \
  54565da2792fdac495a266261d81bf8e980d33e7
```

In beiden Worktrees `bun install --frozen-lockfile`. Die Bun-Stores der beiden Arme dürfen
nicht geteilt oder durch Hardlinks gegenseitig verändert werden. Vor dem Overlay prüft der
Agent die realen Zielpfade mit `realpath`.

### 3.4 Pflichtmeldung jedes Agents

Vor der ersten Änderung:

```bash
git branch --show-current
git rev-parse HEAD
git status --short
bun --version
node --version
```

OpenTUI-Agenten melden zusätzlich Paketversion, Zig-Version und beide Native-Pfade/-Hashes.
Loop A meldet zusätzlich OpenCode-Version und bestätigt, dass Baseline und Kandidat denselben
OpenCode-Commit besitzen.

## 4. Native-, Runtime- und Messprovenienz

### 4.1 Runtimes

- Bun: `1.3.14` primär;
- Node: exakt `26.4.0` über den vorhandenen Repository-Seam;
- Zig: `0.16.0` für C9-Nativebuild/-tests;
- andere Versionen werden protokolliert, aber nicht als formales Gate gewertet.

Auf dem aktuellen Host liegt Zig 0.16 unter `home/user/.local/zig-0.16.0`. Vor Native-
Kommandos explizit prüfen:

```bash
PATH=home/user/.local/zig-0.16.0:home/user/.bun/bin:/usr/local/bin:/usr/bin:/bin \
  zig version
```

Für parallele Worktrees getrennte lokale Cachepfade verwenden; kein Agent leert oder teilt
einen aktiven Zig-Local-Cache eines anderen Loops.

### 4.2 Native-Artefakte

Wave 3 enthält eine Nativeänderung. Das alte „identische Binary für beide Arme“-Protokoll ist
für den Gesamtvergleich deshalb falsch. Es gilt `native-policy=per-arm`:

| Arm       | Source                        | Native-SHA-256                                                     | kanonischer Pfad                                                                                    |
| --------- | ----------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Baseline  | `fccae215`                    | `e7e9764462f2ee7f2c808856b60101ff659c6bda4a1df7cf235e418cf481a15c` | `.worktrees/wave3-baseline/packages/core/node_modules/@opentui/core-linux-x64/libopentui.so`        |
| Candidate | `11b1fdec`/Runtime `b4e6d8b1` | `deacf8067c0078664c30931020172bfcf2f601549816fe4a849e5d042da73804` | `.worktrees/wave3-textbuffer-tail/packages/core/node_modules/@opentui/core-linux-x64/libopentui.so` |

`packages/core/src` ist zwischen `11b1fdec` und dem integrierten Runtimecommit `b4e6d8b1`
bytegleich. Vor Wiederverwendung des Candidate-Artefakts wird dies erneut geprüft. Ein lokal
neu gebautes Binary darf wegen Buildpfad-/Debugmetadaten einen anderen Hash besitzen; dann
sind Sourcecommit, Zig-Version, Flags, Pfad, Größe, Symbolset und Hash neu zu dokumentieren.

Verboten:

- publiziertes altes Native-Binary mit neuen FFI-Signaturen mischen;
- `.so` committen;
- private `.yesmem/native-assets` in Tests hardcodieren;
- Hardlinks zwischen Baseline und Kandidat;
- einen unerwarteten Hash stillschweigend akzeptieren.

### 4.3 Gemeinsame Messinstrumentierung

Ein CPU- oder Skalierungsvergleich ist ungültig, wenn nur der Candidate instrumentiert ist.
Produktionsneutrale Messseams werden deshalb in eigenen Commits gehalten und für das finale
Gate semantisch identisch auf beide temporären Messarme angewendet. Alternativ bleibt die
Instrumentierung vollständig außerhalb der Runtime und nutzt bereits gemeinsame öffentliche
Seams.

Für jede Runtimeinstrumentierung gilt:

1. Off-State höchstens ein billiger Boolean-Guard;
2. kein Clockread, Objekt, Array, String oder Event im Off-State;
3. keine Scheduling-, Await-, Queue-, Render- oder Commitänderung;
4. On-State-Spans disjunkt und eindeutig einem Sample zugeordnet;
5. Off-State-p95 familywise upper höchstens `+3 %`;
6. eigener Test beweist Off-State ohne Events/Allokationspfad;
7. Messcommit und Ergebnis-/Runtimecommit bleiben getrennt.

## 5. Gemeinsamer Statistik- und Hostvertrag

Formale CPU-, Wall-, Startup-, Layout- und Partial-Gates verwenden:

- mindestens 30 balancierte A/B-Paare je Primärszenario;
- drei Warmups je Arm und Szenario;
- 20.000 stratifizierte Bootstrap-Samples;
- deterministischen Seed und bytegleichen Input;
- alternierende Reihenfolge, gleich häufig A→B und B→A;
- frischen Prozess pro Arm für Cold-/Gesamtclaims;
- p50, p95, p99, gepaarte Änderung und familywise 95-%-CI;
- append-only Rohdaten mit Commit-, Runtime-, Native- und Hostprovenienz.

Vor und nach jedem formalen Lauf:

1. `ps -C bun` und relevante OpenCode-/Node-/Zig-Prozesse prüfen;
2. fremde Prozesse nicht beenden; Messung verschieben;
3. eigene verwaiste Worker vollständig beenden;
4. Load Average, CPU/Governor, freie Memory-/Swaplage protokollieren;
5. Gitstatus beider Arme und Native-SHAs erneut prüfen.

Der Host muss nicht „absolut ruhig“ sein. Er muss aber unter dem im Harness festgelegten
Load-Limit liegen und darf keine konkurrierenden Benchmarks/Builds ausführen. Ist das
Konfidenzintervall zu breit, lautet das Ergebnis `UNCLEAR`; Samples werden nicht selektiv
verworfen.

`process.cpuUsage()` allein ist kein Mainthread-CPU-Beleg, weil Worker-CPU enthalten sein
kann. Workerwartezeit ist keine Mainthread-CPU. Stagezeiten dürfen nur summiert werden, wenn
sie disjunkt sind.

## 6. Gemeinsame Agentenregeln

1. Das zum jeweiligen Repository gehörende `AGENTS.md` und diesen Plan vollständig lesen.
2. Abschnitt 0 in der ersten Statusmeldung bestätigen.
3. Vor Änderungen bestehende Seams, Tests und Ergebnisberichte lesen.
4. Bei Bugfix/Instrumentierungsinvariante zuerst beobachtbaren RED-Test ausführen.
5. Kleinste Änderung bis GREEN; keine zweite Policy-/Owner-/Queuequelle erfinden.
6. Nur Loop-Ownership-Dateien und eigene Belege committen.
7. Fremde/untracked Dateien nie löschen, stagen oder formatieren.
8. `oxfmt` ist in OpenTUI die Formatquelle; OpenCode folgt seinem eigenen Formatter/Style.
9. Keine Byte-/Codepoint-/Graphem-/Displayzellen-Verwechslung.
10. Cleanup/Error/Timeout/Destroy settlen Owner und Ressourcen genau einmal.
11. Keine öffentliche API nur für einen Benchmark erweitern, wenn ein interner opt-in Seam
    genügt.
12. Kein Bun-only Verhalten in gemeinsamem OpenTUI-Runtimecode.
13. Keine Netzwerkprovider, echten Benutzerkonfigurationen oder produktiven Sessions in
    reproduzierbaren OpenCode-Tests verwenden.
14. Ein belegtes `NO-OP`/`UNCLEAR` ist gültiger als ein synthetischer PASS.
15. Der Branch endet sauber; kein Agent hinterlässt Bun-/Worker-/OpenCode-Prozesse.

## 7. Loop A – OpenCode-Praxistest

### 7.1 Auftrag

Beweisen, dass der integrierte OpenTUI-Stand in einer echten OpenCode-TUI funktioniert und
die Wave-3-Streaminggewinne im Consumer nicht durch Build-, Overlay-, Solid-, Startup- oder
Sessionpfade verloren gehen.

Vergleich:

- identischer OpenCode-Commit `54565da...`;
- Baseline mit unverändertem katalogbasiertem `@opentui/*@0.5.3`;
- Candidate mit lokalem, vollständig gebautem OpenTUI-Wave-3-Overlay;
- identische OpenCode-Konfiguration, Fixtures, Terminalgröße und Inputs.

### 7.2 Kritischer Overlay-Hinweis

`script/sync-opentui-overlay.ts` am OpenCode-Basiscommit ist auf alten OpenTUI-Commit
`568db413`, Tag patched.98, Version 0.5.1 und alte Hashes gepinnt. Er darf nicht unverändert
auf Wave 3 angewendet werden.

Loop A erstellt im eigenen OpenCode-Branch einen testbaren, atomaren Wave-3-Pin:

- erwarteter OpenTUI-Sourcecommit und Paketversion 0.5.3;
- Hashes von Core-Dist, Solid-Dist und Nativepaket;
- Zielpfade müssen im lokalen Worktree-Bun-Store liegen;
- Apply arbeitet staged + rename + rollback;
- Checkmodus verändert nichts;
- Mismatch/fehlende Datei/halber Apply bricht hart ab;
- `bun install` nach dem Apply ist verboten, weil es das Overlay ersetzen kann;
- keine globale Bun-Cachemutation, keine Hardlinks und keine eingecheckten Buildartefakte.

Der dirty Hauptworktree enthält eine fremde Änderung an diesem Script. Sie wird weder kopiert
noch überschrieben.

### 7.3 Ownership

Loop A darf im OpenCode-Branch ändern:

- `script/sync-opentui-overlay.ts` und fokussierte Overlaytests;
- additive Offline-/PTY-/Performancefixtures unter `packages/tui/test/perf/`;
- additive Paket-Scripts nur wenn für reproduzierbare Ausführung nötig;
- versionierten Bericht unter `packages/tui/test/perf/wave3-opentui-results.md`;
- kleine Testseams im bestehenden TUI-Testfixture, ohne Produktionspolicy.

Loop A darf nicht ändern:

- OpenTUI-Quellen;
- OpenCode-Startup-, Session-, Tool-, Provider- oder Renderpolicy;
- Catalog-Versionen für einen Release;
- produktive Datenbank-, Config- oder Benutzerdateien;
- die anderen OpenCode-Performancebranches.

### 7.4 Workloads

Mindestens:

1. Cold Start bis erster sinnvoller Frame und Eingabebereitschaft;
2. Home → Sessionroute → zurück, inklusive Resize und Destroy;
3. 1.000 TypeScript-Zeilen als geschlossener Markdown-Fence;
4. 100 monotone Textdeltas, die denselben Fence wachsen lassen;
5. unfertiger und anschließend geschlossener Fence;
6. gemischte Prosa/Liste/Tabelle/Code-Injection;
7. großes Tool-/Diff-Resultat mit Scroll, Selection, Link und Cursor;
8. sofortiges Beenden während laufender Highlight-/Renderarbeit.

Die Sessiondaten kommen aus bestehenden lokalen Event-/Fetch-/TUI-Fixtures. Kein echter
Provider, MCP-Server oder Netzwerkzugriff. Terminalmatrix mindestens 80×24 und 250×60.

### 7.5 Beobachtungen

- Prozessstart → erster sinnvoller Frame;
- Prozessstart → Eingabebereitschaft;
- Delta → final gestylter Frame;
- p50/p95/p99 Framewall und Eventloop-Lag;
- Frame-/Layoutpasszahl und Folgeframes, soweit über bestehende Seams messbar;
- Peak-/End-Heap als Diagnose;
- sichtbarer finaler Text, Styles, Links, Cursor, Scrollposition und Resizezustand;
- Exitzeit und zurückbleibende Prozesse/Handles.

Ein Screenshot allein ist kein Performance- oder Stylebeweis. Ein Plaintext-Zwischenframe
zählt nicht als finaler gestylter Frame.

### 7.6 Gates

- Baseline und Candidate bauen und starten aus demselben OpenCode-Commit;
- alle funktionalen Oracles exakt gleich;
- keine Crashs, Hänger, fehlenden Symbole oder Overlay-Drift;
- Startup-/Input-ready-p95 familywise upper höchstens `+3 %`;
- Stream-Delta→styled-frame darf nicht schlechter sein; Gewinn wird separat ausgewiesen;
- Frame-/Layoutpasszahl nicht höher ohne erklärten sichtbaren Zusatz;
- Destroy/Exit begrenzt und ohne übrig bleibenden OpenCode/Bun/Worker;
- Candidate-Overlay-Hash stimmt vor und nach jedem Lauf.

Der OpenCode-Praxistest muss keinen `-30-%`-Consumergewinn erzwingen: OpenCode-eigene Arbeit
kann den OpenTUI-Anteil verdünnen. Er darf aber keinen belastbaren Rückschritt zeigen.

### 7.7 Verifikation

Aus den jeweiligen Paketverzeichnissen, niemals aus dem OpenCode-Root:

```bash
cd packages/tui
bun test test/app-lifecycle.test.tsx
bun test test/cli/tui/session-message-window.test.ts test/cli/tui/diff-viewer.test.tsx
bun typecheck

cd ../opencode
bun typecheck
OPENCODE_VERSION=1.18.18-wave3-test bun run build:patched --single --skip-install
```

Zusätzlich Overlaytests, neuer Offline-Praxisharness und ein lokaler PTY/tmux-Smoke. Falls die
Session keine Terminal-Control-Fähigkeit bereitstellt, verwendet der Agent den vorhandenen
PTY-/TestRenderer-Seam und dokumentiert die fehlende manuelle Achse.

### 7.8 Stop-Kriterien

- Baseline und Candidate besitzen verschiedene OpenCode-Quellcommits;
- Overlay verändert globalen Cache oder anderen Worktree;
- realer Provider/Benutzerdaten wären für Reproduktion nötig;
- Test verlangt OpenCode-Produktionspolicy statt eines Fixtures zu ändern;
- Candidate-Binary/Dist/Native-Provenienz ist nicht eindeutig;
- Startup-/Funktionsregression wird durch Warmcache oder Sampleauswahl kaschiert.

## 8. Loop B – Gesamt-E2E, Mainthread-CPU und Startup-Safety

### 8.1 Auftrag

Das bislang offene Wave-3-Primärgate direkt `fccae215` gegen `ab2b9ebc` schließen:

- echte Real-Worker-Kette;
- disjunkte Mainthread-Stufen statt Gesamtprozess-CPU;
- Update → finaler gestylter nativer Commit;
- Code- und Markdown-Streaming;
- Startup-Sicherheitsmessung nach C9.

Der vorhandene `wave3-real-worker-probe.ts` nutzt `process.cpuUsage()` und diagnostische
Callbacks/Monkeypatching. Diese Werte reichen nicht für den reinen Mainthread-Claim. Der Loop
ersetzt nur die Messmethode, nicht die Runtimepolicy.

### 8.2 Ownership

Loop B darf ändern:

- `packages/core/scripts/wave3-real-worker-*`;
- `packages/core/scripts/wave3-clean-gate*` und Tests;
- neue `packages/core/src/benchmark/wave3-*cpu*`-Dateien;
- `packages/core/src/telemetry.ts` für additive opt-in Stage-Spans;
- ausschließlich additive opt-in Observer in `renderables/Code.ts`, `text-buffer.ts` und
  `lib/styled-text-append.ts`;
- additive Benchmark-Scripts in `packages/core/package.json`;
- `.yesmem/bench/wave3-final-cpu/` und `.yesmem/wave3-final-cpu-results.md`.

Loop B darf nicht ändern:

- `renderer.ts` oder `Renderable.ts` – diese gehören Loop D;
- Tree-sitter-Client/Worker/Types/Plattformworker – diese gehören Loop C;
- Produktionsqueue, Highlight-, Append-, Layout- oder Commitpolicy;
- Zig/FFI-Signaturen oder Nativecode;
- OpenCode-Dateien.

### 8.3 Disjunkte Stufen

Mindestens getrennt erfassen:

1. synchroner Contentsetter/Markdownparse;
2. Mainthread-Jobpost/-annahme;
3. Workerwartezeit separat und ausdrücklich nicht in Mainthread-Summe;
4. Worker parse/query separat;
5. akzeptierte Generation → Highlight-Konvertierung;
6. Safe-Append-Klassifikation;
7. TextBuffer Full-Replace oder Native-Append;
8. Layout/render-list/draw aus Loop-D-Spans;
9. nativer Commitaufruf;
10. gesamte Update→styled-Commit-Walltime.

Spans dürfen weder überlappen noch Wartezeit doppelt zählen. Fehlen Loop-D-Spans im isolierten
Branch, meldet Loop B zunächst eine partielle CPU-Summe. Der finale Gesamtclaim wird erst nach
Integration von B+D berechnet.

### 8.4 Szenarien

- TypeScript cold 100/1k/5k Zeilen;
- TypeScript warm 1.000 Zeilen + 1/10/100 monotone Same-turn-Appends;
- langsame Appends mit Workerabschluss zwischen Updates;
- Markdown Prosa/mixed/unfertiger und geschlossener Fence/Liste/Tabelle/Injection;
- 80×24 und 250×60;
- feste Geometrie und Autoheight;
- Full-Oracle gegen finalen Buffer/Chunks/Styles/Links.

### 8.5 Pflicht-RED/GREEN

RED:

- `process.cpuUsage()` kann Workerzeit nicht ausschließen;
- bisherige Diagnoseevents überlappen oder lassen Post-Chunk/Layoutarbeit unattribuiert;
- Candidate-only-Instrumentierung könnte einen unfairen Vergleich erzeugen.

GREEN:

- Analyse lehnt überlappende/invertierte/fehlende Stufen ab;
- Workerwarte-/Worker-CPU kann nicht in Mainthreadsumme gelangen;
- Baseline und Candidate tragen denselben Messvertrag;
- falscher Commit, Native-Hash, Szenario, uncleaner Arm oder Plaintext-Abschluss bricht hart ab;
- Frame-/Span-/Chunk-Digests und Finaloutput stimmen exakt;
- `PASS`, `FAIL` und `UNCLEAR` sind getrennte Ergebnisse.

### 8.6 Startup-Safety

Den vorhandenen Cold-Import-/TTFMF-Harness wiederverwenden, aber `renderer-entry` gegen
`renderer-entry` und die echten per-arm Native-Artefakte messen. Ausweisen:

- Import p50/p95/p99;
- TTFMF p50/p95/p99 bis echtem nativen Textcommit;
- gepaarte Änderung und familywise CI;
- Native-Load-/Bindingphase, soweit beobachtbar.

Wave-3-Gate: p50/p95 familywise upper höchstens `+3 %`, p99 höchstens `+5 %`. Das historische
relative `-30-%`-Startupziel wird nur als offener Folgestrang notiert und nicht in diesem Loop
optimiert.

### 8.7 Verifikation

```bash
cd packages/core
bun test scripts/wave3-clean-gate.test.ts
bun test src/benchmark/wave3-harness.test.ts
bun test src/renderables/Code.test.ts src/lib/styled-text-append.test.ts src/text-buffer.test.ts
bun run test:js
bun run build:lib
bun run test:js:node
bun run test:dist --skip-build
```

Format-/Lint-/Dist-Abschluss gemäß Abschnitt 15. Kurze Diagnoseläufe dürfen im Branch laufen;
der formale n=30-Lauf wartet auf die gemeinsame B+D-Messintegration.

### 8.8 Stop-Kriterien

- reine Mainthread-Stufen bleiben nur aus Gesamtprozess-CPU schätzbar;
- Instrumentierung müsste Scheduling oder Runtimepolicy ändern;
- Baseline und Candidate können nicht gleichwertig instrumentiert werden;
- finaler Styled-Commit ist nicht von einem Plaintext-Zwischenframe unterscheidbar;
- Off-State-Regressionsbudget wird überschritten;
- Host/CI erlaubt keine Aussage – dann `UNCLEAR`, kein künstlicher PASS.

## 9. Loop C – Rolling-Memory und Lifecycle

### 9.1 Auftrag

Das offene Rolling-10k-/Leak-Gate reproduzierbar schließen. Nicht nur ein wachsendes Dokument
messen, sondern begrenzte Steady-State- und Lifecycle-Phasen mit expliziten Ressourcenownern.

### 9.2 Ownership

Loop C darf ändern:

- neue `packages/core/scripts/wave3-memory-*`-Dateien und Tests;
- neue `packages/core/src/benchmark/wave3-memory-*`-Dateien;
- additive, read-only/opt-in Diagnosesnapshots in
  `lib/tree-sitter/client.ts` und `platform/worker.ts`, falls vorhandene Stats nicht reichen;
- neue testinterne Resource-Inventarseams unter `packages/core/src/testing/`;
- additive Benchmark-Scripts in `packages/core/package.json`;
- `.yesmem/bench/wave3-memory/` und `.yesmem/wave3-memory-results.md`.

Loop C darf nicht ändern:

- `renderer.ts`, `Renderable.ts`, `Code.ts`, TextBuffer-/Appendpolicy;
- Workerqueue-/Restart-/Cleanupverhalten;
- Native-/Zig-Code;
- Cache-/Queuebudgets ohne gemessenen Leak;
- OpenCode-Dateien.

Findet der Loop einen echten Leak, dokumentiert er zuerst reproduzierbaren RED-Beleg und Owner.
Die Behebung erfolgt nach Audit in einem separaten Follow-up, nicht versteckt im Harnesscommit.

### 9.3 Drei Phasen

#### A. Rolling Steady State

- 10.000 Updates;
- feste Dokument- und Viewportobergrenze;
- 1.000-Zeilen-Fenster mit Append-Epochen und periodischem sicherem Full-Replacement, damit
  C9-Snapshots und Fallbacks beide exercised werden, ohne Dokumentwachstum als Leak zu zählen;
- 80×24 und 250×60;
- kontrollierte GC-Fenster nach Warmup;
- Queuejobs/-bytes, Worker, Heap, ArrayBuffers, RSS, Nativeallocations und Eventloop-Lag.

#### B. Lifecycle

- 100× create → Buffer/Renderer/Worker benutzen → Destroy;
- normal, Workerfehler, Timeout, Filetypewechsel und Destroy während In-flight;
- nach jedem Zyklus Pending Work begrenzt; nach End-GC keine monotonen Ownerreste.

#### C. Fault-/Bound-Matrix

- 100 same-turn Updates;
- Workerexit, Unsupported, superseded Pending, Fallback;
- maximale Payload-/Queue-HWM;
- Destroy räumt Active/Pending/Listener/Timer/Worker exakt einmal.

### 9.4 Metriken

- `heapUsed`, `heapTotal`, `arrayBuffers`, RSS;
- kontrollierte GC-Pausen und Eventloop-p50/p95/p99;
- Native `getAllocatorStats().activeAllocations` vor/nach Warmup/Destroy;
- Tree-sitter active/pending jobs, pending bytes und HWM;
- Worker-, Listener- und Timerowner über bestehende explizite Seams/FakeClock;
- FFI-/Renderer-/TextBufferhandles, soweit öffentlich/intern beobachtbar;
- Snapshot-/Style-Run-Größe und Dokumentgröße zur Normalisierung.

RSS allein beweist keinen Leak. Undokumentierte private Runtime-APIs dürfen höchstens als
Diagnose dienen, nicht als einziges Gate. Heapdumps oder Sessioninhalte werden nicht committed.

### 9.5 Gates

- letzter Post-Warmup-Heapfenster-Median höchstens erster Median
  `+ max(5 %, 4 MiB)`;
- ArrayBuffer-/Pending-Bytes folgen der festen Workloadgrenze, nicht Updateanzahl;
- Queue-HWM höchstens ein Active + ein Pending pro Buffer;
- nach Destroy active/pending Jobs und Bytes null;
- Native active allocations nach 100 Zyklen zurück auf Warm-Baseline;
- Worker/Listener/Timer/FFI-Owner nach Endcleanup auf Baseline/null;
- GC-/Eventloop-p99 höchstens `+5 %` gegen `fccae215`;
- keine unhandled Rejection, Late Commit oder zurückbleibender Prozess.

### 9.6 Verifikation

```bash
cd packages/core
bun test <neue-memory-harness-tests>
bun test src/lib/tree-sitter/client.test.ts src/renderables/Code.test.ts src/text-buffer.test.ts
bun test src/tests/allocator-stats.test.ts
bun run test:js
bun run build:lib
bun run test:js:node
bun run test:dist --skip-build
```

Node-GC-Läufe verwenden den vorhandenen Node-26-Seam und `--expose-gc`; Bun-spezifische
GC-Aufrufe bleiben im Benchmarkrunner, nicht in Shared Runtimecode.

### 9.7 Stop-Kriterien

- Dokument- oder Cachewachstum wird fälschlich als Leak gewertet;
- nur RSS ohne Heap-/Ownerbeleg steigt;
- GC ist zwischen den Armen nicht kontrolliert;
- Diagnoseänderung beeinflusst Queue-/Cleanupverhalten;
- ein echter Leak verlangt Dateien außerhalb der Loop-Ownership – dann separater Follow-up;
- Host-Swap/Load macht Memory-/p99-Aussage unbrauchbar.

## 10. Loop D – Layout-/Partial-Skalierung

### 10.1 Auftrag

Die Wave-3-Sicherheitsachsen für große Bäume und Partial Rendering schließen. Dieser Loop
misst und attribuiert R-08/R-09; er implementiert noch keine E-/F-Optimierung.

### 10.2 Ownership

Loop D darf ändern:

- neue `packages/core/src/benchmark/wave3-layout-*`- und `wave3-partial-*`-Dateien;
- neue `packages/core/scripts/wave3-render-scaling*`-Dateien und Tests;
- ausschließlich additive opt-in Counter/Spans in `renderer.ts` und `Renderable.ts`;
- TestRenderer-/Benchmarkhilfen, wenn sie keine Produktionspolicy verändern;
- additive Benchmark-Scripts in `packages/core/package.json`;
- `.yesmem/bench/wave3-render-scaling/` und `.yesmem/wave3-render-scaling-results.md`.

Loop D darf nicht ändern:

- `Code.ts`, TextBuffer-/StyledAppend-Dateien – Loop B;
- Client/Worker/Platformworker – Loop C;
- Layout-, Renderlist-, Culling- oder Partial-Entscheidungslogik;
- Zig/Nativecode;
- OpenCode-Dateien.

### 10.3 Layoutmatrix

- 10/1.000/10.000 stabile Geschwister;
- ein streamendes Kind bei fixer Geometrie und bei Autoheight;
- Culling 100/1k/5k/10k;
- ein Dirty-Leaf in flachem und tiefem Baum;
- Scroll, Resize, Reparent, zIndex, Selection, Focus und Hit-Test;
- 80×24 und 250×60.

Erfassen:

- besuchte stabile Nodes;
- `updateFromLayout`-/Yoga-FFI-Aufrufe;
- Layoutgenerationen und Dirty-Teilbäume;
- Renderlist reuse/rebuild und Commands;
- Frames/Folgeframes/Fullframes;
- Layout-, JS-Render- und Commitzeit disjunkt.

### 10.4 Partialmatrix

- Painter: 10/100/1.000;
- Targets: 1/10/100;
- Tiefe: 1/10/50;
- sparse, dense, nested und weit getrennte Targets;
- lokale Änderung auf 80×24 und 250×60;
- transparente/opaque, overlap/no-overlap und offscreen;
- Unionfläche, Screenfläche und Promotiongrund.

Erfassen:

- gescannte spätere Painter und Boundswalks;
- `hasSafePartialComposition`-Kosten;
- Partial→Full-Promotionsgrund;
- Regionsfläche und Commitstatus;
- Framebuffer, Styles, Links, Cursor, Hit-Grid und Imagesafety.

### 10.5 Oracles

Jedes Partial-Szenario wird gegen einen erzwungenen Full-Render desselben finalen Zustands
verglichen. Null Abweichungen bei:

- Zellen/Text/Styles/Links;
- Cursorposition/-sichtbarkeit;
- Hit-Grid/Mausziel;
- Scroll/Selection/Focus;
- Commitstatus und finaler Frame.

Eine schnellere, aber visuell oder interaktiv andere Partialausgabe ist ein harter FAIL.

### 10.6 Gates

- Wave 3 gegen `fccae215`: sekundärer p50/p95 familywise upper höchstens `+3 %`;
- p99 höchstens `+5 %`;
- keine zusätzlichen Folge-/Fullframes bei fixer Geometrie;
- Outputoracles null Mismatches;
- Counter skalieren plausibel mit Target/Painter/Treegröße und überlaufen nicht;
- Telemetrie-Off-State innerhalb `+3 %`;
- bei nachgewiesener O(K·N·D)- oder Full-Traversal-Kurve: reproduzierbarer Befund für Wave 4,
  aber kein ungeplanter Umbau in diesem Branch.

### 10.7 Verifikation

```bash
cd packages/core
bun test <neue-layout-und-partial-harness-tests>
bun test src/tests/renderer.partial-render.test.ts src/tests/renderable.test.ts
bun test src/testing/test-renderer.wait.test.ts
bun run bench:render-traversal
bun run test:js
bun run build:lib
```

Node/Dist zusätzlich, falls eine gemeinsam exportierte/gebaute Datei geändert wird.

### 10.8 Stop-Kriterien

- Benchmark müsste Produktionslayout-/Partialpolicy verändern;
- Full-Oracle ist nicht deterministisch;
- Counter selbst treiben die Skalierung;
- Candidate und Baseline erhalten verschiedene Messsemantik;
- Befund verlangt E-/F-Umbau – als Wave-4-Ticket übergeben, nicht hier implementieren.

## 11. Bedingter fünfter Loop – C5 kompakte Worker-Spans

C5 startet **nicht**, bevor Loop B den Worker→Main-Anteil im integrierten Real-Worker-Profil
belegt hat.

### 11.1 Go/No-go

- Clone + Objektaufbau unter 10 % der relevanten E2E-Main-/Wartezeit: `NO-OP`.
- Anteil mindestens 10 %, aber erwartbarer E2E-Gewinn unter 5 %: `DEFER`.
- Anteil mindestens 10 % und klarer Nutzen: eigener A2-Branch nach grüner Erstintegration.

Dann:

- Branch: `yesloop/wave3-compact-spans`
- Worktree: `home/user/projects/opentui/.worktrees/wave3-compact-spans`
- Basis: vom Koordinator dokumentierter grüner Zwischenintegrationscommit nach B+C+D,
  **nicht** `ab2b9ebc` und nicht ein Einzelbranch.

### 11.2 Regeln

- zuerst kompakte strukturklonbare Spans;
- keine Semantikreduktion bei Injection, Concealment, Links oder Equal-Boundaries;
- kein zweiter Queue-/Versionsowner;
- Transferlisten nur über einen portablen `PlatformWorkerHandle`-Seam;
- Bun- und Node-Workerpfad müssen dieselbe Ownership-/Detach-Semantik testen;
- direktes Bun-only `postMessage(value, transfer)` in Shared Code ist verboten;
- nach Destroy/Workerfehler keine retained/detached Buffer.

### 11.3 Gate

- Clone-/Objektaufbaustufe mindestens 30 % schneller;
- Gesamt-E2E-p95 mindestens 5 % besser;
- Queue-/Memory-/Output-/Node-/Dist-Gates weiter grün;
- Startup und andere Primärbenchmarks innerhalb der allgemeinen Budgets.

Nach C5 werden die formalen Loops A–D gegen den neuen Kandidaten wiederholt. Ohne Wiederholung
ist C5 nicht mergefähig.

## 12. Loop-Handoff

Berichte:

- A, OpenCode: `packages/tui/test/perf/wave3-opentui-results.md` im Agentenbranch;
- B: `.yesmem/wave3-final-cpu-results.md`;
- C: `.yesmem/wave3-memory-results.md`;
- D: `.yesmem/wave3-render-scaling-results.md`;
- optional C5: `.yesmem/wave3-compact-spans-results.md`.

Rohdaten bleiben unter eindeutigem loopbezogenem Pfad. Keine `.so`, Heapdumps,
Benutzerdaten, SQLite-Datenbanken oder unredigierten Sessioninhalte committen.

Jede Übergabe enthält:

1. Repository, Branch, Worktree, Basiscommit, finalen HEAD und sauberen Status;
2. Commitfolge/Cherry-pick-Reihenfolge;
3. Paket-, Bun-, Node-, Zig- und Native-Provenienz;
4. geänderte Dateien und Ownershipbegründung;
5. RED- und GREEN-Belege;
6. Tests mit echten Counts und Exitcodes;
7. A/B-Arme, Szenario, n, Warmups, Bootstrap, p50/p95/p99 und CI;
8. Host/Load/Governor und Prozesshygiene;
9. Correctness-, Output- und Cleanuporacles;
10. `PASS`, `FAIL`, `UNCLEAR`, `DEFER` oder `NO-OP`;
11. Grenzen, offene Risiken und explizit nicht erledigte Punkte;
12. Bestätigung, dass kein Prozess zurückblieb.

Ein Report ohne Rohdaten, Commit-/Binaryprovenienz oder sauberen Worktree ist nicht
integrationsreif.

## 13. Audit vor Integration

Jeder Branch wird aus einem sauberen Git-Archiv oder frischen Worktree reproduziert:

- tatsächliche Basis stimmt;
- keine fremden Mergecommits;
- Ownership eingehalten;
- Instrumentierung und Runtimepolicy getrennt;
- Report/Rohdaten passen zum HEAD;
- Tests hängen nicht an unversionierten `.yesmem`- oder absoluten privaten Assetpfaden;
- keine Native-/Build-/Heapartefakte committed;
- Formatter, Lint und `git diff --check` grün;
- No-op/Unclear ist messungsbasiert;
- OpenCode-Arme haben denselben Quellcommit und getrennte lokale Stores;
- alle Kindprozesse sind terminiert.

Mängel werden im jeweiligen Agentenbranch durch Follow-up-Commit korrigiert. Der Integrator
repariert sie nicht still im Integrationsbranch.

## 14. Integration und Reihenfolge

### 14.1 Ausgangspunkt

```bash
cd home/user/projects/opentui/.worktrees/wave3-integration
git branch --show-current
git rev-parse HEAD
git status --short
```

Erwartet wird die aktuelle `yesloop/wave3-streaming-integration`-Linie mit dem Plancommit über
Runtimebasis `ab2b9ebc`, sauber.

### 14.2 Reihenfolge

1. Loop D Messinstrumentierung/Harness integrieren.
2. Loop B CPU-/E2E-Harness integrieren und mit D-Spans verbinden.
3. Kombinierten B+D-Fokustest; disjunkte Stufensumme beweisen.
4. Loop C Memory-Harness/Diagnostik integrieren.
5. Volle funktionale Matrix, bevor formale Messungen starten.
6. B+D Gesamt-A/B und Startup-Safety seriell messen.
7. C Rolling-/Lifecycle-Endlauf seriell messen.
8. C5-Go/No-go aus dem integrierten Profil entscheiden.
9. Falls C5 GO: separaten Loop integrieren und Schritte 5–8 vollständig wiederholen.
10. Loop A OpenCode-Endmessung gegen den endgültigen Runtimekandidaten durchführen; sein
    Overlay-/Harnesscommit wird nicht automatisch in OpenTUI cherry-gepickt.
11. OpenCode-Ergebnis in den OpenTUI-Abschlussbericht übernehmen.
12. Regression-Ledger und finalen Wave-3-Bericht aktualisieren.

Messinstrumentierung, die nur für das Gate nötig ist, darf nach der Messung aus dem
Produktionskandidaten entfernt werden. Dann müssen Off-State- und Funktionsgates auf dem
tatsächlich mergefähigen Endstand erneut laufen.

## 15. Finale Wave-3-Gates

### 15.1 Primärclaim

Für identische Code-/Markdown-Streams muss die familywise obere Grenze des gepaarten
95-%-Bootstrap-CI sowohl für

1. die Summe disjunkter Mainthread-Stufen als auch
2. Update → finaler gestylter nativer Commit

höchstens `-30 %` gegenüber `fccae215` betragen. Schneidet das Intervall `-30 %` oder sind
Stufen nicht disjunkt, lautet das Ergebnis `UNCLEAR`/`FAIL`.

### 15.2 Harte Teilgates

| Bereich        | Gate                                                                           |
| -------------- | ------------------------------------------------------------------------------ |
| Queue          | höchstens 1 active + 1 pending pro Buffer                                      |
| Burst          | 100 Updates → höchstens 2 Workerjobs, mindestens 98 superseded                 |
| Stale          | Prüfung vor Convert und Commit; exakt eine finale sichtbare Generation         |
| Converter      | 1k p95 <8 ms; 5k mindestens 50 % unter Baseline                                |
| C9             | sichere Appends, unsichere Fälle Full-Replacement, null Differentialmismatches |
| Output         | Frame/Chunks/Styles/Links/Injection/Concealment exakt                          |
| Startup        | p50/p95 ≤+3 %, p99 ≤+5 %                                                       |
| Layout/Partial | p50/p95 ≤+3 %, p99 ≤+5 %, null Oraclemismatches                                |
| Memory         | Heapfenster, Queuebytes und Owner innerhalb Abschnitt 9.5                      |
| OpenCode       | funktional gleich, Startup/Input-ready ≤+3 %, kein Stream-Rückschritt          |
| Allgemein      | keine sekundäre p50/p95-Regression >3 %, p99 >5 %                              |

### 15.3 Funktion und Portabilität

- Bun 1.3.14;
- Node 26.4 Source und Packed Dist;
- Zig 0.16 Native-Suite;
- Unicode/Grapheme/CRLF/ZWJ/Flags/Hangul/Keycaps;
- Injection, Concealment, Links, Selection, Cursor, Hit-Grid;
- Plaintext-Fallback, Workerfehler, Restartbudget und Destroy;
- kein Late Commit, Dead-End-Promise, unbounded Owner oder Prozessrest.

## 16. Finale Verifikation

OpenTUI, aus `packages/core`:

```bash
bun run test:js
bun run test:native
bun run build:lib
bun run test:js:node
bun run test:dist --skip-build
```

Nach Native-/Cross-Package-Änderung zusätzlich aus dem OpenTUI-Root:

```bash
bun run build
bun run fmt:check
bun run lint
git diff --check
```

Ohne Nativeänderung bleiben vollständige Native-Suite und Root-Build dennoch Teil der finalen
Wave-3-Abnahme, weil C9 bereits Nativecode enthält und genau dieser Integrationsstand nach
Fastpatch gehen soll.

OpenCode, aus den Paketverzeichnissen:

```bash
cd packages/tui
bun test
bun typecheck

cd ../opencode
bun typecheck
OPENCODE_VERSION=1.18.18-wave3-test bun run build:patched --single --skip-install
```

Zusätzlich fokussierte Overlay-, App-Lifecycle-, Session-Streaming- und PTY-Tests. Keine
Tests aus dem OpenCode-Root starten.

## 17. Abschlussbericht und Mergeentscheidung

Der Integrator erstellt `.yesmem/wave3-final-results.md` und aktualisiert
`.yesmem/performance-regression-ledger.md` mit:

- kompletter Baselineleiter und allen Source-/Binaryhashes;
- A–D-Einzelergebnissen und optional C5;
- OpenCode-Praxisergebnis;
- CPU-/Wall-/Worker-/Converter-/TextBuffer-/Layout-/Commitanteilen;
- Startup-Safety;
- Rolling-Memory-/Lifecyclewerten;
- Layout-/Partial-Skalierung;
- Testmatrix und Prozesshygiene;
- verworfenen Experimenten/No-ops;
- verbleibendem Wave-4-/Startup-Scope.

Entscheidung:

- **MERGE-READY:** alle harten Funktions-/Ownershipgates grün, Primärclaim belegt, Memory und
  Safetyachsen grün, OpenCode-Praxis grün;
- **PARTIAL:** ausschließlich klar unabhängige Mess-/Fixcommits behalten; kein Fastpatch-Merge
  ohne dokumentierte Freigabe;
- **UNCLEAR:** Host/CI/Attribution reicht nicht; Lauf wiederholen, nicht schönrechnen;
- **NO-GO:** Output-, Ownership-, Memory-, Startup-, OpenCode- oder Reproduktionsfehler.

Erst nach `MERGE-READY` wird `yesloop/wave3-streaming-integration` in `fastpatch` übernommen.
Der Merge selbst ist eine separate, vom Benutzer freizugebende Aktion. Danach wird der neue
Fastpatch-Commit als Baseline für Wave 4 dokumentiert.
