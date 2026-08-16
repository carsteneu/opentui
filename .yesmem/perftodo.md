# OpenTUI Performance-TODO (fastpatch)

Stand: 2026-08-15 · Branch `fastpatch` @ `2cd44364513f59a7a5937ef257042ddb0fca4fb7`

**Quellen (Herkunfts-Tag je Task):**

- `[P]` = statische Analyse `.yesmem/ptomanalyse.md`
- `[W01]…[W06]` = yesresearch-Wiki `yesdocs/opentui-perf/wiki/<cluster>/` (Code-verifiziert, `Datei:Zeile`-Belege)
- `[X-P0.x]/[X-§y]` = Codex-Messanalyse `.worktrees/fastpatch/.yesmem/codexanalyse.md` (messtragend)
- `[O6]/[O8]` = OpenCode-Restplan `.yesmem/plan/remaining-performance-work.md`, nur die OpenTUI-Punkte 6 und 8

**Geist (verbindlich):** Grundsätzlich **erst messen, dann umbauen** (Go-Gates). Kein Rückbau des retained/Partial-Pfads auf Fullscreen-Kopie. Nicht-tun-Liste am Ende einhalten. Code-Zeilen stehen auf fastpatch-Stand und können sich durch Umsetzung verschieben — beim Bearbeiten am Quelltext gegenprüfen.

Legende Prio: 🔴 hoch · 🟠 mittel · 🔵 niedrig
Status: `[ ]` offen · `[x]` erledigt · `[~]` teilweise/blockiert

Diese Datei ist die **einzige operative Abarbeitungsliste** für die Fastpatch-Performancearbeit. Plan, PTO, Research-
Wiki und Codexanalyse bleiben Beleg- und Entscheidungsquellen; neue Aufgaben werden hier einsortiert, statt eine zweite
TODO-Liste zu eröffnen.

## Definition of Done je Arbeitspaket

Ein Punkt darf erst auf `[x]`, wenn alle zutreffenden Bedingungen erfüllt sind:

1. **Reproducer zuerst:** beobachtbares Verhalten oder Invariante als fokussierter Regressionstest; bei reiner
   Performancearbeit zusätzlich reproduzierbare Baseline vor der Änderung.
2. **Provenienz:** Sourcecommit, Native-Binarypfad/Hash/Symbolset, Bun-/Node-Version, CPU, Energiemodus, Geometrie,
   Datenmenge, Warmup und Samplezahl in den Rohdaten festhalten.
3. **Messung:** alternierendes A/B auf derselben Maschine; Median, p95 und bei interaktiven/async Pfaden p99 sowie
   verarbeitete Bytes, Frames, Layoutpasses, Jobs oder FFI-Aufrufe erfassen. Versprechen verschiedener Änderungen
   nicht addieren.
4. **Korrektheit:** Zellbuffer, Styles, Links, Cursor, Hit-Grid, Selection und relevante Ownership-/Destroy-
   Invarianten bleiben identisch. Byteoffset, Codepoint, Graphem und Displayzelle bleiben getrennt.
5. **Verifikation:** engster Test zuerst, danach betroffene Paketsuite. Bei Native-/FFI-/Exportänderung zusätzlich
   `test:native`, `test:js:node`, `test:dist` und gegebenenfalls Root-Build gemäß `AGENTS.md`.
6. **Performance-Gate:** Primärziel erreicht, keine >3-%-Regression in anderen Primärbenchmarks und keine >5-%-
   Verschlechterung im p99 ohne dokumentierte Freigabe. Ergebnis und verworfene Variante in der Analyse verlinken.
7. **Rollback/Ownership:** neue Caches, Timer, Worker, FFI-Handles und Listener haben Owner, Grenze und Cleanup auf
   jedem Exitpfad; die Änderung kann isoliert zurückgenommen werden.

## Eingefrorene Ausgangswerte

| Bereich                             | Fastpatch-Baseline / heutiger Beleg                                   |
| ----------------------------------- | --------------------------------------------------------------------- |
| Core-Root Sourceimport              | 380,41 ms Median                                                      |
| Time to first meaningful frame      | 392,63 ms Median; erster Frame selbst 2,93 ms                         |
| eager vollständiger Native-Aufbau   | rund 144,73 ms gepaarte Root-Differenz                                |
| Ein-Symbol-`dlopen`                 | 1,90 ms Median; Wrapper-/Bindingmenge ist der größere Hebel           |
| Tree-sitter → TextChunks Mainthread | 18,40 ms @1k / 85,29 ms @5k Zeilen                                    |
| 10k-Node-Culling                    | rund 6 ms                                                             |
| Partial 80×24 lokal                 | 0,0461 ms, damit teurer als Full 0,0212 ms                            |
| Partial 250×60 lokal                | 0,0661 ms, damit günstiger als Full 0,0934 ms                         |
| Markdown-Parser                     | 32/32 fokussierte Tests grün                                          |
| Tree-sitter-Client-Lifecycle        | 49/49 Tests grün; unerwarteter `exit` ohne `error` noch nicht gedeckt |

Absolute Werte werden vor Implementierungsbeginn durch A1 auf dem dann aktuellen Commit neu eingefroren.

## Verbindliche Abarbeitungsreihenfolge

| Welle | Inhalt                                        | Eintrittsbedingung                | Ausgang/Gate                                           |
| ----: | --------------------------------------------- | --------------------------------- | ------------------------------------------------------ |
|     0 | A1–A4, B7: Harness, Counter, Rohdaten         | keine                             | belastbare Baseline, deaktivierte Telemetrie ≤3 %      |
|     1 | G1–G3, C7/C8/C10: Hänger und Lifecycle        | Fault-Harness aus Welle 0         | kein ungebundenes Pending/Retry/Destroy                |
|     2 | B1–B6: Startup, lean FFI, UI-first            | Import-/First-frame-Spans         | Cold-TTFMF −30 %, Root/API kompatibel                  |
|     3 | C1–C6/C9 und D3–D5: Streaming                 | Queue-/Payload-/Frame-Counter     | Mainthread-CPU −30 %, Queue bounded, Ausgabe identisch |
|     4 | E1–E6 und I1–I4: Layout/Framework             | F7-/Commit-to-frame-Benchmark     | Kosten folgt Dirty-/Viewportmenge                      |
|     5 | F1/F6 messen, danach bedingt F2–F5/F7         | reale K-/Overlap-Verteilung       | adaptiver Partialpfad ohne Zell-/Hit-Grid-Fehler       |
|     6 | K und L: Memory, PTY, Runtime-/Artefaktmatrix | stabile Hauptarchitektur          | kein Treppeneffekt; Bun/Node/dist/PTY konsistent       |
|     7 | H1–H4: Native Feinschliff                     | Profil zeigt verbleibenden Anteil | messbarer E2E-Gewinn, nicht nur Mikrobenchmark         |
|     8 | M1–M4: Gesamtverifikation und Übergabe        | alle übernommenen Gates grün      | releasefähiger Fastpatch-Stand                         |

Wellen geben die Abhängigkeit vor. Innerhalb einer Welle dürfen unabhängige Benchmarks parallel vorbereitet werden;
Sourceänderungen bleiben isolierte, einzeln messbare Commits.

---

## Serie A — Observability & harte Baseline (Pflicht-Voraussetzung)

Fundament für jeden weiteren Punkt; ohne Zähler/Reason-Histogramm keine Umbau-Freigabe.

> Welle 0 wurde auf `yesloop/wave0-observability` implementiert. Review-R3/R4 hat jedoch gezeigt, dass die frühere
> Abnahme statistisch nicht belastbar war: `wave0-r3` entschied nur über den Median der Paarquoten und ist deshalb
> **ungültig/superseded**. Sein historischer Bericht trägt jetzt einen entsprechenden Warnhinweis; die Rohdaten bleiben
> append-only unverändert.
>
> Korrigierter Stand 2026-08-16: Harness v4 nutzt den bestehenden reihenfolgestratifizierten Bootstrap-Seam,
> deterministischen 15/15-Order-Split, Rohwerte je Paar und ein gemeinsames 95-%-Familien-Gate für `importMs` und
> TTFMF. Beide Arme verwenden vollständige eigene JS-Bäume; ein gemeinsames Fastpatch-Native-Artefakt wird explizit
> gepinnt und per Pfad, SHA-256 und Symbolset geprüft. Bun-Minimal/Root/Zig/Dist sowie exakt Node v26.4.0 Dist sind in
> `packages/core/bench/base/wave0-r4/` eingefroren. Lifecycle enthält echten Feed-Write und Destroy-Start/-Ende.
>
> **Aktuelles Ergebnis:** Punktwerte fastpatch → branch-disabled: Import +0,69 %, TTFMF +1,06 %. Wegen hoher
> Hoststreuung reichen die familienweisen 97,5-%-Intervalle aber bis +11,92 % beziehungsweise +12,17 %; das ≤3-%-
> Gate ist daher korrekt **FAIL/unklar**, nicht PASS. Auch die Recording-Kosten sind mit oberen Grenzen +6,08 % /
> +5,35 % nicht freigegeben. Welle 0 ist funktional vollständig, die A3-Performanceabnahme bleibt offen.
>
> Verifikation: fokussierte Telemetrie-/Feed-/Statistiktests 88/88, reguläre Core-JS-Suite 5451 pass / 0 fail,
> `build:lib`, Lint und gepackter Bun-/Node-Dist-Test grün. `test:js:node` erreicht weiterhin die zwei bereits in
> Fastpatch vorhandenen `Code.test.ts`-Typfehler bei `requestPartialRender`; identischer Fehler im Basisworktree
> gegengeprüft. Der Root-Formatcheck wird nur von acht fremden, ungetrackten `.yesmem`-Dateien blockiert; alle hier
> geänderten Dateien bestehen `oxfmt --check` und `git diff --check`.

- [x] **A1 · Mess-Harness für Cold-Import + Time-to-First-Frame** als reproduzierbares Script im Repo (Benchmark-Inventar + Opt-in-Tracing) [`[W01-Messagenda]` `[X-4.1/4.2]`] 🔴
  - Rohdatenformat: Commit, Runtime (Bun/Node), CPU, Geometrie, Warmup, Samples, Median/p95/p99, RME.
  - Baseline auf Bun **und** Node + Dist-Pfad einfrieren.
  - Szenarien: Root, Minimalentry, `zig.ts`, Rendererbau, First JS render, First native commit, First output write und Destroy; Source und gebautes Paket nicht vermischen.
  - Rohdaten append-only unter einem eindeutig benannten Benchmark-Artefakt ablegen; Bericht wird daraus generiert, nicht manuell abgeschrieben.
- [x] **A2 · Reason-Histogramm / Frame-Counter** (`[W01] [W03]`): Requestquelle, normal/partial/live/RAF, Folgeframegrund, Partial-Promotiongrund, native statuses, Queue-/Feedwartezeit. [`[X-7.1]`] 🔴
  - Go-Gate Serie A: Counter erklären ≥95 % der Frames; deaktivierter Pfad verschlechtert Primärbenchmarks nicht >3 %.
- [~] **A3 · Opt-in-Performanceevents/Counter mit ~Nullkosten im deaktivierten Zustand** [`[X-Serie A]`] 🔴
  - Funktionaler Off-State ist getestet; Performance noch nicht abgenommen. R4-Punktwerte liegen innerhalb 3 %, die
    familienweisen Obergrenzen (+11,92 % Import / +12,17 % TTFMF) sind auf dem belasteten Host zu breit.
- [x] **A4 · A/B-Rahmenwerk** auf identischer Hardware/Commitbasis (nicht addierbare Versprechen; jede einzelne Änderung isoliert messen) [`[X-1/15]`] 🔴
  - Alternierende Reihenfolge, Warmupstrategie und Outlierregel vor dem Lauf festlegen; Vergleich bricht bei
    Runtime-Drift ab und pinnt oder verwirft Native-Artefaktdrift explizit.
  - Smoke-Gate im normalen CI klein halten; lange p95/p99-, PTY-, Memory- und `perf`-Läufe als explizite Performancejobs.

---

## Serie B — Startup / Importgraph / UI-first

Der größte gemessene Hebel: ~380 ms Import vs. ~3 ms erster Frame. [`[X-P0.1] [W06]`]

- [ ] **B1 · Granularer, unterstützter Runtime-Entrypoint** (z. B. `@opentui/core/renderer`, `.../renderable`) der nur Renderer, Basis-Renderables, Text, Farben + nötige FFI-Seams exportiert; Root bleibt kompatibel (additiv) [`[P-F11] [W06§4.3] [X-P0.1]`] 🔴
  - Abnahme: Minimal-Entrypoint lädt keine optionalen Module/Worker; keins von Audio/Image/Tree-sitter im Importtrace.
- [ ] **B2 · Audio/Image/Markdown-Code/Tree-sitter/Console als Subpath-Exports** (`.../audio`, `.../image`, `.../markdown-tree-sitter`) [`[W06§4.3] [X-§9.3]`] 🟠
  - `sideEffects:false` nur dort, wo nachweislich keine Modul-Scope-Seiteneffekte (siehe B3/B4) existieren.
- [ ] **B3 · Eager Native-Setup aus dem Modul-Scope entfernen** — `zig.ts:175` löst den Assetpfad auf und `zig.ts:6267` baut `FFIRenderLib` inklusive Hunderten Bun-FFI-Wrappern schon bei `import "@opentui/core"`. Kontrolliertes A/B: erfolgreicher eager Aufbau gegenüber fehlschlagendem Load rund **144,73 ms Median**; Ein-Symbol-`dlopen` nur 1,90 ms. [`[W06§1.2/2] [X-4.1/P0.1]`] 🔴
  - Zuerst nur eager `new FFIRenderLib(...)` entfernen; `resolveRenderLib()` bleibt synchroner Ownership-Seam und lädt beim ersten echten nativen Objekt. Das bewahrt `setRenderLibPath()` und benötigt noch keinen dynamischen Import.
  - Gate: Importzeit und TTFMF getrennt ausweisen. Bei unmittelbar folgendem Rendererbau wird die Last sonst nur vom Import in den Konstruktor verschoben.
  - ⚠️ Export-Split allein reicht **nicht** (B4); `resolveRenderLib`-Pfad-Ordnung/Kontrakt `setRenderLibPath` vor `resolveRenderLib` (`zig.ts:6241-6250`) wahren.
- [ ] **B4 · Lean-FFI-Seam und optionale Binding-Gruppen** — ein First-frame-Satz für Basisrenderer/Text/Layout statt aller FFI-Definitionen; Audio/Image/Clipboard usw. erst bei Bedarf binden. Erst danach entscheiden, ob eine physische `.so`-Aufteilung zusätzlich lohnt. [`[X-4.1/P0.1]`] 🔴
  - Ein direktes `await import("./zig.js")` in `OptimizedBuffer.create()` oder synchronen Renderable-Konstruktoren ist nicht kompatibel. Wenn auch `zig.js` selbst aus tree-only Graphen verschwinden soll, braucht es eine explizite `preload`/`ready`-Stufe oder eine lean statische Fassade — keine still async gewordene API.
  - Abnahme: identische Bun-/Node-Signaturen, Callback-/Handle-/`dlclose`-Ownership und `setRenderLibPath`-Reihenfolge; First-frame-Binding-Zahl und Wrapper-JIT-Zeit als Rohdaten.
- [ ] **B5 · `parser.worker`-Assetauflösung messen und gegebenenfalls dämpfen** — `runtime-assets.bun.ts:14-20` löst/bündelt per `type: "file"` den Pfad, evaluiert das Worker-JavaScript laut lokaler Side-Effect-Probe aber **nicht** im Main Thread (`executed=false`). [`[X-17.5]`] 🔵
  - Nur optimieren, falls Assetauflösung/-einbindung im Importtrace relevant ist; Worker-, WASM- und Parserauswertung bleiben first-use Messpunkte in Serie C.
- [ ] **B6 · UI-first-Rahmen mit expliziten Ready-Stufen** (Core ready → First frame committed → Enhanced ready → Application ready) **ohne** `setupTerminal()` zu serialisieren (Capabilities laufen bereits parallel, kein 5-s-Capability-Timeout im First-Frame-await). [`[X-P0.2]`] 🟠
  - Skeleton funktional (Fokus, Escape/Cancel, Lade-/Fehlerzustand); Fehlschlag optionaler Pakete darf sichtbare UI nicht zurücksetzen.
- [x] **B7 · Import-/First-commit-Spans als Low-overhead-Telemetrie** (module ready, native loaded, renderer created, terminal setup started, first JS render, first native commit, first output write) [`[X-P0.1]`] 🟠
- [ ] **B8 · `--delay-start` (5 s, Debug-only) aus Produktionsmessungen ausschließen** — bereits als F3 verifiziert, kein Fund [`[W06§3]`] 🔵 (nur Messprotokoll-Hinweis)
- [ ] **Go-Gate Serie B:** Cold-TTFMF p50 ≥30 % unter Baseline (392,63 ms); Root-API unverändert; Bun & Node laden dieselben nativen Assets; UI bleibt bei fehlgeschlagenem optionalem Import nutzbar. [`[X-P0.1]`]

---

## Serie C — Streaming Code / Tree-sitter

Primärer Streaming-Hebel (konsistent F10 / Cluster 05). [`[P-F10] [W05] [X-P0.3]`]

- [ ] **C1 · CodeRenderable auf inkrementellen Tree-sitter-Bufferpfad** — `updateBuffer`/`createBuffer` (`client.ts:568-669`, `tree.edit`+`parse(content,oldTree)` `parser.worker.ts:548-606`) statt `highlightOnce`-Fullcontent-ONESHOT (`Code.ts:460`, `client.ts:395-422`, `parser.worker.ts:820-879`). [`[W05§F10-A/B/6.3] [X-P0.3]`] 🔴
- [ ] **C2 · Latest-wins-Koaleszierung pro Buffer + Worker-ACK-/Concurrency-Grenze** — die `updateBuffer`-FIFO-`ProcessQueue` (`client.ts:84,642-652`) begrenzt weder Workerjobs noch Payload-Backlog; höchstens 1 laufend + 1 pending pro Buffer. [`[X-7.3]`] 🔴
- [ ] **C3 · Main-Thread-Chunk-Konvertierung algorithmisch reduzieren** (`treeSitterToTextChunks`, `Code.ts:507`): Sweep-Line statt O(H log H), kompakte Style-/Injection-Daten, monotone Pointer, direkt Chunk-Merge. Gemessen 18,4 ms @1k / 85,3 ms @5k Zeilen. [`[X-P0.3] [W05§F10-B]`] 🔴
- [ ] **C4 · Stale-Rerun-Supersede vor Konvertierung UND vor UI-Commit** — `_highlightSnapshotId`/`retryLatestHighlight` vorhanden (`Code.ts:448/462/483/516/556-566`); Version vor Parse, vor Chunks, vor Commit prüfen. [`[W05§F10-C] [X-P0.3]`] 🟠
- [ ] **C5 · Kompakte Style-Spans in Transferables vom Worker** (reduziert Structured Clone O(n) je Rerun) [`[X-P0.3-5] [W05§F10-B/7]`] 🟠
- [ ] **C6 · Queue-Längen-/Bytes-/Superseded-Counter** + Rapid-append-Regressionstest für denselben Buffer (begrenzte Queue, deutlich weniger real geparste Versionen als Updates) [`[X-7.3]`] 🔴
- [ ] **C7 · Reset-Debounce-Dead-End beheben** — `client.ts:766`: ersetzte Promise bleibt unresolved; beim Ersetzen/Clear Promise definiert abbrechen/erfüllen/Superseded-Fehler. [`[X-7.3]`] 🟠
- [ ] **C8 · Nicht gecancelten Dispose-Timer** (3 s, `client.ts:671`) nach schneller Antwort canceln — unnötiger Wakeup [`[X-7.2]`] 🔵
- [ ] **C9 · Korrekter inkrementeller nativer TextBuffer-Tail-Reflow** — vorhandenes `TextBuffer.append()` nicht unverändert reaktivieren: Code nutzt wegen fehlerhaftem Wrap-/Graphem-Reflow bewusst `setText`/`setStyledText`. Append-only beweisen, letzte beeinflusste Wrap-/Graphemregion neu segmentieren, sonst Full-Replacement. [`[X-P1.1]` `[O6]`] 🟠
  - Differentialtests gegen Full-Replacement: Word-/Char-Wrap, CRLF, Surrogate, ZWJ, Flags, Skin-Tones, Hangul, Keycaps, Styles/Highlights sowie Width-/Wrap-Wechsel.
  - Native Bufferzeit, Layout und Terminalframes separat messen; nur aktivieren, wenn der E2E-Anteil relevant und die Ausgabe zellidentisch ist.
- [ ] **C10 · Unerwarteten Tree-sitter-Worker-Exit terminieren und Recreate begrenzen** — korreliertes `ERROR`, `worker.onerror` Reject-all und Plain-Text-Fallback sind **vorhanden**; offen sind Exit-Propagation im `PlatformWorkerHandle`/Node-Shim sowie Restartbudget/Circuit-Breaker. [`[X-7.3]` `[O8]`] 🔵
  - Faulttests: Exit vor/während Init, während One-shot und Bufferupdate, wiederholter deterministischer Fehler, Exit/Destroy-Race; kein Pending Request und sichtbarer Plain Text.
- [ ] **Go-Gate Serie C:** ≥30 % weniger Main-Thread-CPU im identischen Markdown/Code-Stream; 1k-Zeilen-Konvertierung p95 < 8 ms; Highlightoutput zell-/styleidentisch (Injections, Concealment, Unicode, Links); Appends mit klassierbaren Metacharakter-Tails (Fences/Listen/Tabellen) korrekt.

---

## Serie D — Streaming Markdown

Inkrementell bereits vorhanden = **großteils erledigt**. Nur Rest-Messung.

- [x] **D1 · VORHANDEN:** inkrementeller Parser `parseMarkdownIncremental` (Fast-Paths, stabiler Präfix byte-verglichen + Token-Reuse, kein Re-Lex des Präfix) [`[W04§1]`] — verifiziert 32/32 Tests
- [x] **D2 · VORHANDEN:** Block-Reconciliation (`updateTopLevelBlocks`/`updateBlocks`, Binärsuche O(log K), Renderable-Reuse, `rerenderBlocks` ohne Parse-Rebuild) [`[W04§3]`]
- [ ] **D3 · Wall-Clock-Timing** von `parseMarkdownIncremental` bei wachsendem Puffer (1k→100k Bytes, Prose- vs. Block-last) [`[W04§5.1] [X-PTO 11.1]`] 🔵
- [ ] **D4 · Tail-Re-Lex-Klassen zählen** (Anteil Appends mit 0/1-Inline-Lex vs. Block-Lex) [`[W04§5.2]`] 🔵
- [ ] **D5 · Render-Pass-Anteil der stabilen Geschwister je Chunk** (→ Serie E/F7; die Markdown-Reconciliation ersetzt Parse-, nicht Layout-Traversal) [`[W04§5.3] [W03]`] 🟠
- [ ] **Go-Gate Serie D:** bestehende 32 Parserregressionen bleiben grün; stabile Präfixe/Tokens/Renderables werden weiterverwendet; nur bei belegtem Restanteil wird zusätzlicher Parsercode gebaut. Layoutkosten werden Serie E zugerechnet, nicht als Markdown-Parsegewinn doppelt gezählt.

---

## Serie E — Layout, Render-List & Große Bäume

F7 = zentraler struktureller Streaming-Hotspot. [`[P-F7] [W03] [X-P0.4]`]

- [ ] **E1 · Visible-child-API ohne per-frame ID-Array/Set-Doppelscan** — bei Childfilter läuft `updateLayout` je Kind `updateFromLayout` (FFI), dann `_getVisibleChildren()`+`new Set`+Rescan (`Renderable.ts:1494-1498`, `1478`). 10k-Culling ~6 ms. [`[W03§6] [X-P0.4]`] 🔴
  - Vorher Benchmark 1/100/10k Kinder mit 0/1/100 % sichtbar, Scroll- und Resizeburst; besuchte Kinder, FFI-Aufrufe, Allokationen und p95 zählen.
  - API liefert bestehende Renderable-Referenzen oder wiederverwendbare Membershipdaten; keine zweite Children-/Visibility-Source-of-Truth.
- [ ] **E2 · Layout-/Bounds-/Membership-Caches an bestehende Generationen koppeln** — statische unsichtbare Kinder nicht per FFI abfragen; dirty Teilbäume + letzte Layoutgeneration cachen [`[X-P0.4]`] 🟠
  - UpdateFromLayout-Guard (`Renderable.ts:1131-1133`) existiert (1 FFI/Node/Frame); Render-Liste-Reuse existiert (`Renderable.ts:2025-2048`) — aber global ganz-oder-gar-nicht.
  - Cachekey mindestens Layoutgeneration, Renderlistrevision und relevante Scissor-/Translate-/Visibilityrevision; Mutationstests für Reparent, zIndex, Resize, Scroll, Selection und Destroy.
- [ ] **E3 · Subtree-Layout-Dirty (Plan 10.1) evaluieren** — derzeit kein Subtree-Scope; jeder geometry-dirty Chunk bumpt `bumpLayoutGeneration` → volle Traversal über stabile Geschwister (`Renderable.ts:2094/2101`, `2025-2028`). Größerer Umbau → **erst F7-Messung**, dann A/B. [`[W03§5] [P-F7]`] 🟠
  - F7-Matrix: feste Geometrie vs. Autoheight, Text/Markdown/Code, 10/1k/10k stabile Geschwister; Yoga-Dirtyquelle und wiederbesuchte stabile Nodes ausweisen.
  - No-Go, wenn reale Streams fast immer im bestehenden Generation-Reuse bleiben oder Umbaukosten den p95-Gewinn neutralisieren.
- [ ] **E4 · Setter-Batch-/Invalidierungs-Seam** — mehrere Setter je Framework-Commit invalidieren potenziell mehrfach `requestRender`+`bumpRenderListRevision` (Trigger `Renderable.ts:381/405/566/580/706/899/1276/1355/1405`); „Requests je Commit"-Messung (Plan 13) zuerst [`[W03§4] [P-F8]`] 🟠
  - Batch besitzt klaren Commitowner und flushes auch bei Throw/Unmount; effektive Setterwerte weiterhin sofort lesbar, nur abgeleitete Arbeit wird koalesziert.
- [ ] **E5 · `collectPendingCodeRenderables()` iterativ** statt rekursiv mit Array-/Spread-Allok (Stackrisiko) [`[X-7.4]`] 🔵
  - Flacher/breiter und 10k-tiefer synthetischer Baum; Reihenfolge und Auswahl exakt gegen bisherigen Walk testen.
- [ ] **E6 · Scrollback: eine Highlight-Welle pro konsistentem Snapshot** statt Voll-Surface-Redraw je Welle [`[X-7.4]`] 🔵
  - Snapshotgeneration bindet Highlights, Layout und Commit; stale Wellen dürfen keinen Zwischenframe oder neuen Settle-Zyklus starten.
- [ ] **Go-Gate Serie E:** 10k-Culling p95 mindestens 50 % niedriger; stabile Streams skalieren mit Dirty-/Viewportmenge; keine Regression bei Scroll, Resize, Reparent, zIndex, Selection, Focus, Hit-Test und Destroy.

---

## Serie F — Partial Rendering & Overlap

- [ ] **F1 · `hasSafePartialComposition` O(K·N·D) — Kostenmodell + Promotions-Telemetrie** (`Renderable.ts:1966-1989`): Targets, gescannte spätere Painter, Boundswalks, Unionfläche vs. Screenfläche, Promotiongrund. [`[P-F4] [W02] [X-6.2]`] 🔴 (nur bei Befund umbauen)
  - Paradoxon: teuerster Fall = _kein_ Overlap (Suffix-Scan läuft voll durch, `Renderable.ts:1981-1986`).
- [ ] **F2 · Bounds/Opaque-Composition an Renderlistrevision + Layoutgeneration cachen** [`[X-6.2]`] 🟠
  - Invalidation für Layout, Translate, Scissor, Opacity, zIndex, Visibility, Reparent und Destroy; Cachehit und vermiedene Boundswalks zählen.
- [ ] **F3 · Räumlicher Index/zeilenweise Intervalle für spätere Painter** (Source of Truth = Renderreihenfolge bleibt) [`[X-6.2]`] 🟠
  - Nur nach F1/F6, wenn reales K/N/D den linearen Suffixscan sichtbar macht; kleine K bleiben auf billigem linearem Pfad.
- [ ] **F4 · Regio-Union-Limits (mehrere entfernte Targets vereinigen sich zu 1 Bounding-Rect, ≈ Full-Diff)** — native Multi-Region-API oder begrenzte nicht-überlappende Regionen evaluieren [`[W02§F5] [X-6.2]`] 🟠 (F5 selbst = Positiv, ein nativer `renderPartial` vorhanden)
  - 1/2/8 nahe und entfernte Regionen; Wide-/Graphem-Nachbarzellen, Scissor, Opacity, Images, Hit-Grid und Cursor in jede Correctnessprobe aufnehmen.
- [ ] **F5 · Adaptive Partial-Entscheidung** — Partial nur, wenn geschätzte JS-Prüfkosten + Regionsfläche < Fullpfad; 80×24-Kleinstfall wählt nicht den teureren Partialpfad, 250×60-Lokalupdate darf Partial wählen (`renderer.ts:4736-4750` + `loop`) [`[X-4.3/6.2-5]`] 🟠
  - Entscheidung deterministisch aus beobachtbaren Größen; Thresholds aus Benchmarkdaten, nicht gerätespezifischen magischen Konstanten ohne Fallback.
- [ ] **F6 · Kein bestehender Partial-Harness → Painter×Target-Scaling-Benchmark** über `testing/test-renderer.ts` (Knie suchen, wo Framezeit linear→quadratisch kippt; realistisches K: wie viele `_partialEligible` invaliden im selben Frame) [`[W02-Messagenda]`] 🔴
  - K×N×D, no/sparse/dense Overlap, Targetposition früh/spät, Unionfläche/Screenfläche, Promotiongrund und echte K-Histogramme.
- [ ] **F7 · no-filetype-`CodeRenderable` erzeugt unnötigen Folge-Fullframe** — gleiche Bufferrevision/bekannte feste Geometrie sollen zweiten Text-/Layoutdurchlauf überspringen [`[X-6.4]`] 🟠
  - Regressionstest zählt Frames/Layoutpasses bei festem und autoheight Content; später eintreffendes Highlight/Resize muss weiterhin korrekt invalidieren.
- [ ] **Reiner Allok-Minor Partial/Frame:** `[...this.partialRequests]` (`renderer.ts:4746`) nur bei Allocation-Profil-Beleg anfassen [`[W02§canPartial]`] 🔵
- [ ] **Go-Gate Serie F:** 80×24 wählt keinen teureren Partialpfad, 250×60 behält den lokalen Gewinn; kein schwarzer/staler Frame und Zellbuffer, Hit-Grid, Cursor, Images und Commitstatus bleiben Full-Render-identisch.

---

## Serie G — Hänger-/Backpressure-Härtung

- [ ] **G1 · Frame-Callbacks budgetieren/abortbar machen** — `CliRenderer.loop()` awaited alle `frameCallbacks` serial (`renderer.ts:4601`); nie auflösender Callback hält `rendering=true`, verwirft Folgeframes, blockiert Destroy. [`[X-P0.5]`] 🔴
  - Kein pauschales `Promise.all` (Ordnungs-/Mutierungsvertrag). `AbortSignal`/Destroy-Pfad; optional hartes Budget mit definierter Fehlerpolitik (Promise kann nicht erzwungen abgebrochen werden → spätes Ergebnis darf keinen State mehr committen).
  - Regressionstests: never-resolving, rejecting, destroying-during-callback, removed-during-iteration.
- [ ] **G2 · Feed-/Sink-Lifecycle für Custom-Writable** — `NativeSpanFeed` pinnt Chunk bis alle async `onData` erfüllt; stillstehender `stdout.write`-Callback blockiert `idle()`, Startup, Backpressure-Retry, Shutdown. [`[X-P0.6]`] 🔴
  - Writable `error`/`close`/`finish` + Renderer-Destroy in expliziten Sink-Lifecycle (jede offene Op genau einmal beenden); konfigurierbares Backpressure-Budget. **Kein** Refcount-Release nach Timeout allein (UAF-Risiko).
  - Fake-Writable-Tests: Callback nie/spät, synchroner Throw, error, close, Destroy mit gepinntem Chunk, wiederholtes Close.
- [ ] **G3 · Timerhandles/Generationen für delayed activation + Dispose** — `requestRender` außerhalb Running speichert Timeout-Handle nicht; Dispose-Timer (C8) canceln [`[X-7.2]`] 🟠
  - Fake-/ManualClock-Tests für Start/Pause/Stop/Suspend/Destroy, stale Wakeup und wiederholte Aktivierung; höchstens ein Owner je Timer/Retry.
- [ ] **Go-Gate Serie G:** Faultmatrix endet immer in begrenzter Zeit; Renderloop und Input bleiben responsiv; Destroy lässt keine gepinnten Chunks, Timer oder Late Commits zurück; Normalpfad p95 innerhalb 3 %.

---

## Serie H — Native Feinschliff (niedrige Prio, erst nach JS/Startup/Streaming)

- [ ] **H1 · Doppel-Clear messen & zustandssicher eliminieren** — TS leert `nextRenderBuffer`, danach bereitet native `clear_next=true` erneut geleert vor (`renderer.ts` Full-Pfad + prepareRenderFrameWithWriter) [`[X-8.2]`] 🟠 (braucht Bufferzustand + Full/Partial/Backpressure/Image/Destroy-Tests)
  - Zustandsautomat für Current/Next, committed/skipped/failed/backpressured; kein Clear entfernen, solange Ownership nach Fehl-/Retrypfad unklar ist.
- [ ] **H2 · Row-Equality-Heuristik** — 4 Array-Vergleiche/Zeile; vollbreite Kopfzeile deaktiviert schnellen Gleichheitspfad für Folgezeilen; adaptiv/RowHash benchmarken [`[X-8.3]`] 🔵
  - No-op, lokale Änderung, vollbreite Kopfzeile und random dense update; Hashberechnung und Kollisionskorrektheit gegen direkten Vergleich rechnen.
- [ ] **H3 · Image-Quadratik** — `prepareSnapshotImages`/`computeImageDirtyFlags` paarweise; erst Image-scaling-Benchmark, dann Sweep-/Spatial-Index oder region-aware Partial [`[X-8.4]`] 🔵
  - 0/1/10/100/1k Placements, statisch/animiert, Overlap/Resize/Protocol switch; ohne aktive Images darf kein zusätzlicher globaler Pass entstehen.
- [ ] **H4 · ANSI-Bytes/Syscalls/Run-Batching** unter lokalem Update [`[X-Serie F]`] 🔵
  - Sichtbarer Output bleibt bytefunktional gleich; Cursor-/Stylezustand und tmux/screen wrapping berücksichtigen, nicht nur Bytezahl minimieren.
- [ ] **Go-Gate Serie H:** Änderung nur übernehmen, wenn `perf`/Flamegraph den Anteil bestätigt und ein E2E-/Kapazitätsgewinn außerhalb Messrauschen entsteht; Native-, FFI-, Node-, PTY- und Imagepfade grün.

---

## Serie I — Framework-Adapter (React/Solid Commit-Batch)

- [ ] **I1 · Commit-Batch-Seam für Core-Setter** — Styleprops einzeln gesetzt; mehrere Setter je Commit koaleszieren Layout-/Buffer-/Invalidierungsarbeit ohne State-Duplikation [`[X-9.1/9.2]`] 🟠
  - Counter: Setter, effektive Änderungen, Renderrequests, Layoutgenerationen, Frames und Terminalcommits pro Frameworkcommit.
- [ ] **I2 · Solid `_removeNode` rekursives Destroy-`nextTick` → Destroy-Batch je Commit** [`[X-9.2]`] 🔵
  - Keyed/unkeyed reorder, nested unmount, throw during cleanup und immediate remount; keine verzögert lebenden Listener/Handles.
- [ ] **I3 · React `createInstance`+`finalizeInitialChildren` doppelte Prop-Setzung via Mount-Counter prüfen** [`[X-9.1]`] 🔵
  - Nur umbauen, wenn effektive doppelte Coreinvalidierung gemessen wird; React-Vertragsreihenfolge nicht anhand eines Microbenchmarks ändern.
- [ ] **I4 · Framework-End-to-End-Benchmarks** (1/100/10k Nodes Mount/Update/Unmount, Text-/Markdownstream): Reconcilerzeit, Requests, Layoutpasses, Frames, Commit-to-terminal [`[X-4.6/9]`] 🟠
  - React/Solid getrennt; keyed/unkeyed, Style/Text, Portal/Slot, concurrent/batched Updates und Destroy erfassen.
- [ ] **Go-Gate Serie I:** weniger Requests/Layoutpasses/Frames je Commit bei identischem Corezustand; Mount/Update/Unmount p95 verbessert oder neutral; keine Lifecycle-/Ordering-Regression.

---

## Serie J — Messagenda-Masterliste (konkrete erste Messungen, priorisiert)

Nach Welle 0 werden diese Messungen zuerst geschlossen. Die Implementierungsreihenfolge bleibt von ihren Go-Gates
abhängig; ein negativer Befund beendet den zugehörigen Umbau.

1. **[B] Node/Dist-Native-Setup wiederholen:** Bun-Probe vorhanden; Wrapperdefinition, Callbacksetup und native Init getrennt instrumentieren. [`[X-4.1]`] 🔴
2. **[B] Minimaler First-frame-Binding-Satz A/B gegen alle Definitionen:** Importzeit und echtes TTFMF getrennt; `parser.worker` nur als Assetauflösung tracen. [`[X-P0.1/17.5]`] 🔴
3. **[G] Feed-/Frame-Fault-Injection:** Sinkdelay 0 ms → nie, never-resolving Framecallback, pinned bytes, Feed-idle und Destroyzeit. [`[X-P0.5/P0.6]`] 🔴
4. **[C] Worker-Payload-Bytes + Parse-/Clone-/Convert-Zeit je Chunk:** `highlightOnce` gegen inkrementelles `edit`, 1/10/100 schnelle Updates. [`[W05] [X-4.5]`] 🔴
5. **[C9] Native TextBuffer:** `setText` gegen sicheren Tail-Reflow bei 1k→100k Bytes; Buffer, Layout und Frame getrennt. [`[O6] [X-P1.1]`] 🟠
6. **[E] Reason-/Layout-Quoten:** `getComputedLayout`, stabile besuchte Geschwister und Renderlist-Reuse pro Streamchunk. [`[W03] [X-5.5]`] 🔴
7. **[F] Painter×Target×Tiefe:** no/sparse/dense Overlap, zwei entfernte Regionen, reale K-Verteilung und Promotionsgrund. [`[W02]`] 🔴
8. **[A/K] Allocation-/Memory-Profil:** Frame-Spreads, Worker/Queue-High-water, Idle, 100 Lifecyclezyklen und Rolling Stream. [`[X-10]`] 🟠

Für jede Messung wird vorab notiert: Hypothese, Metrik, Schwellenwert, erwartete Correctness-Invariante und Entscheidung
bei negativem Ergebnis. „Interessante Zahl“ ohne Go/No-Go-Entscheidung schließt keinen Punkt.

---

## Serie K — Memory, GC und begrenzte Ressourcen

- [ ] **K1 · Drei reproduzierbare Memory-Harnesses** [`[X-10]`] 🟠
  - Steady idle: 10 Minuten nach vollständiger Initialisierung.
  - Lifecycle: 100× create/use/destroy plus explizite GC-Beobachtung, soweit Runtime unterstützt.
  - Rolling Stream: 10.000 Updates bei begrenztem sichtbaren Fenster statt stetig wachsendem Dokument.
  - Metriken: JS heap, RSS, native Allocatorstats, Worker, Listener, Timer, offene FFI-Handles, Queue-/Pinned-Byte-High-water.
- [ ] **K2 · Owner-/Cleanup-Inventar als Testinvariante** für Renderer, NativeSpanFeed, Tree-sitter, Parsercache, Clipboard, Images, Audio, Frameworkroots und Custom-Writables. [`[X-7/10]`] 🟠
  - Nach Destroy keine neue Arbeit/Frames; Late Results durch Generation abweisen; Cleanup idempotent und auf Fehlerpfaden identisch.
- [ ] **K3 · Cache- und Queuebudgets festlegen** [`[X-7.3/10]`] 🟠
  - Tree-sitter-Parser/Queries, Highlightresultate, Renderlisten, Bounds, Text-/Wrapdaten und optionale Module nach Einträgen **und Bytes** begrenzen.
  - Eviction darf keinen aktiven nativen Pointer oder Workerjob invalidieren; Trefferquote und Evictionkosten messen.
- [ ] **K4 · Nur belegte Leaks/GC-Hotspots beheben** 🔵
  - Ein wachsendes Dokument ist kein Leakbeweis. Optimierung erst bei Treppeneffekt nach Steady-State/Destroy oder profilerbelegter GC-Pause.
- [ ] **Go-Gate Serie K:** kein monotones Ressourcenwachstum nach Warmup/Destroy; Queue-/Cache-/Pinned-Byte-Grenzen werden im Faulttest eingehalten; keine p99-Pause >5 % gegenüber Baseline.

---

## Serie L — PTY-, Unicode-, Runtime- und Distributionsparität

- [ ] **L1 · Differential-/Golden-Korpus für Textgrenzen** [`[P] [X-P1.1]`] 🔴
  - Bytes, Codepoints, Grapheme und Displayzellen separat prüfen: CRLF, Combining Marks, Surrogate, ZWJ, Flags, Skin-Tones, Hangul, Keycaps, Wide Cells, Tabs und defekte UTF-8-Ränder.
  - Full-Replacement ist Oracle für C9; Wrapmodi, Breitenwechsel, Selection, Cursor, Links und StyledText einschließen.
- [ ] **L2 · Reale PTY-/Output-Matrix** [`[X-12/18]`] 🟠
  - 80×24, 160×50 und 250×60; Full/Partial, Backpressure, Resizeburst, Split-scrollback, Kitty/Sixel/Fallback, Cursor und Capability-Late-Arrival.
  - ANSI-Bytes, Writes/`writev`, Syscalls, First-write und Flicker/Golden erfassen; TestRenderer allein reicht nicht für Freigabe.
- [ ] **L3 · Bun/Node/Source/dist/packed Matrix** [`[X-P0.1]`] 🔴
  - Gemeinsame FFI-Signaturen und Pointerownership; `test:js:node`, `test:dist`, Assetroot, `setRenderLibPath`, Minimalentry und optionale Subpaths.
  - Ein Bun-spezifischer Gewinn darf den unterstützten Node-Pfad weder eager laden noch funktional brechen.
- [ ] **L4 · Native-Artefakt-Provenienz automatisieren** [`[W04] [X-17.5]`] 🟠
  - Hash, Größe, Buildmodus und erforderliche Symbole (`renderRetained`, `renderPartial`) vor Nativebenchmarks prüfen; bei Drift hart abbrechen.
- [ ] **Go-Gate Serie L:** Zell-/Style-/Cursor-/Hit-Grid-Goldens identisch; Bun und Node bestehen gepackte Distribution; keine Messung mit unbekanntem Binary.

---

## Serie M — Abschluss, statische Checks und Übergabe

- [ ] **M1 · Taskbezogene Verifikationsmatrix vollständig schließen** 🔴
  - Engster Regressionstest → betroffene Paketsuite; Nativeänderung `bun run test:native`; FFI/Runtime/Export `test:js:node` und `test:dist`; Cross-package/native bei Bedarf Root-`bun run build`.
- [ ] **M2 · Finale Repositorychecks** 🟠
  - Root: `bun run fmt:check`, `bun run lint` und betroffene Tests. Unrelated Format-/Lintchurn vermeiden; Warnungen nicht durch globale Deaktivierung verstecken.
- [ ] **M3 · Gesamt-A/B gegen eingefrorene Fastpatch-Baseline** 🔴
  - Cold TTFMF, TTI/First-input, 1k/5k Streaming, 10k Layout, Partialmatrix, Fault-p99, RSS/GC und PTY-Ausgabe.
  - Einzelgewinne und Gesamtgewinn getrennt berichten; Regressionsbudget pro Szenario, keine addierten Marketingwerte.
- [ ] **M4 · Fastpatch als neue Integrationsgrundlage dokumentieren** 🟠
  - Commit-/Binary-Provenienz, aktivierte Featureflags, bekannte Fallbacks, verworfene Experimente und Overlay-/Pin-Anforderungen für OpenCode festhalten.
  - Nur geprüfte, konfliktfreie Commits übernehmen; jeder Performancecommit hat Test, Messartefakt und isolierte Rückfallmöglichkeit.
- [ ] **Release-Gate:** alle P0/P1-Punkte erledigt oder mit negativem Messbefund geschlossen; keine offenen Hänger-/Ownershipfehler; Primärziele erreicht; Funktionsmatrix grün.

---

## Serie N — Nicht tun (Do-not)

- Kein Rückbau des retained Partialpfads auf Fullscreen-Kopieren (alte Black-Frame-Ursache) [`[X-14] [W02]`]
- Kein globales „alles lazy" mit stillschweigend async gewordenen synchronen APIs [`[X-14] [W06]`]
- Kein `Promise.all` aller Frame-Callbacks ohne geklärten Ordnungsvertrag [`[X-14] [X-P0.5]`]
- Kein Refcount-Release gepinnter Feedchunks allein wegen Timeout (UAF) [`[X-14] [X-P0.6]`]
- Keine Zusammenführung von Byteoffset/Codepoint/Graphem/Terminalzellbreite [`[X-14]`]
- Kein unbegrenzter Highlight-/Parser-/Module-Cache; keine Deaktivierung von Images/Postprocessing/Console/Capability-Erkennung für schönere Benchmarks [`[X-14]`]
- Keine Interpretation wachsender Dokument-Benchmarks als Leakbeweis (erst zyklischer Lifecycle-Test) [`[X-10] [W04§6]`]
- Keine native Hochrisiko-Optimierung, bevor JS-/Startup-/Streamingkosten entfernt und erneut profiliert [`[X-14]`]
- `zig.js`/runtime-assets **nicht** als `sideEffects:false` markieren (Modul-Scope-Dlopen/-Eval könnte bundler-wegoptimiert werden) [`[W06§4.3]`]

---

## Offene Belege/Blockaden zu dokumentieren

- [x] Frühere Research-Blockade aufgelöst: Bun 1.3.14 ist verfügbar; das lokale Fastpatch-Binary exportiert `renderRetained` und `renderPartial`. Das publizierte Root-0.5.3-Binary bleibt nur ein dokumentiertes Driftbeispiel. [`[W04§6] [X-17.5]`]
- [ ] Node-/dist-Wiederholung der Native-Setup-Probe und exakte Phaseninstrumentierung fehlen weiterhin; die 144,73 ms sind Bun-Source-A/B, kein runtimeübergreifendes Versprechen. [`[X-4.1]`]
- Drei Memorytests fehlen für Leakaussagen: steady idle (10 min), zyklischer Lifecycle (100× create/use/destroy + GC), Streaming-Window (Rolling-Buffer, 10k Updates) [`[X-10]`]
- Die konkrete Toolregistry und deren Lazy-Import liegen im OpenCode-Consumer, nicht in OpenTUI. OpenTUI liefert Minimalentry, Ready-/Fehlervertrag und Telemetrie; Consumerpolitik wird nicht im Core dupliziert. [`[X-P0.2]`]
- PDFs/Visuals: nicht zutreffend (Coderecherche, keine Webquellen) — Beleg = `Datei:Zeile` [`[INDEX]`]

---

_Erstellt aus: `.yesmem/ptomanalyse.md` (P) + yesresearch-Wiki `yesdocs/opentui-perf/wiki/` (W01–W06) + Codex `codexanalyse.md` (X) + OpenCode-Restplan, ausschließlich OpenTUI-Punkte 6/8 (O6/O8)._
