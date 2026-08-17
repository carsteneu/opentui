# Wave 2: paralleler Implementierungsplan für vier Subagenten

Stand: 2026-08-17

Zielbranch nach Integration: `yesloop/wave2-startup-integration`

Verbindliche Runtime-Baseline: `f33c801981fe45a58bd688575427bbffddf7daa0` (`yesloop/wave1-lifecycle`)

Maßgebliche Aufgabenliste: `.yesmem/perftodo.md`, Abschnitt B1–B6

## 1. Ziel und harte Grenzen

Wave 2 verkürzt den Weg vom Prozessstart bis zur ersten wirklich sichtbaren Ausgabe. Dafür werden vier getrennte
Arbeitsbereiche parallel bearbeitet:

| Loop | Umfang                             | Branch                        | Worktree                         |
| ---- | ---------------------------------- | ----------------------------- | -------------------------------- |
| A    | B3/B4: Native-/FFI-Laden           | `yesloop/wave2-native-ffi`    | `.worktrees/wave2-native-ffi`    |
| B    | B1/B2: schlanke Entry-Points       | `yesloop/wave2-entrypoints`   | `.worktrees/wave2-entrypoints`   |
| C    | B5: Parser-Worker-/Asset-Auflösung | `yesloop/wave2-parser-assets` | `.worktrees/wave2-parser-assets` |
| D    | B6: UI-first-/Ready-Stufen         | `yesloop/wave2-ui-ready`      | `.worktrees/wave2-ui-ready`      |

Die vier Loops dürfen gleichzeitig laufen. Innerhalb eines Loops gilt die angegebene Reihenfolge. Die Integration ist
eine fünfte, koordinierende Phase und wird erst begonnen, wenn alle vier Übergaben vorliegen.

Harte Grenzen:

- Die Root-API `@opentui/core` bleibt vollständig kompatibel. Neue Entry-Points sind additiv.
- Synchrone öffentliche Konstruktoren und `resolveRenderLib()` bleiben synchron.
- Keine native `.so` physisch aufteilen. Das wäre eine spätere, separate Native-Welle.
- Keine Bun-only API in gemeinsamem Runtime-Code.
- Keine Vermischung von Byte-, Codepoint-, Graphem- und Display-Cell-Längen.
- Keine globalen `sideEffects: false`-Behauptungen ohne einen beweisenden Import-/Bundle-Test.
- Keine neue Anwendungsschicht in OpenTUI erfinden. OpenTUI stellt Mechanismen bereit; die OpenCode-UI bleibt im
  OpenCode-Repository.
- Keine Optimierung nur aufgrund einer Vermutung. B4 und B5 dürfen mit einem belegten No-op enden.
- Ein Loop ändert weder `.yesmem/perftodo.md` noch die Dateien eines anderen Loops.

## 2. Gemeinsame Vorbereitung durch den koordinierenden Agenten

Diese Schritte müssen abgeschlossen sein, bevor die vier Implementierungsagenten beginnen.

### 2.1 Ausgangszustand fixieren

1. Prüfen, dass `yesloop/wave1-lifecycle` sauber ist und die Wave-1-Ergebnisse enthält.
2. Den Commit, der dieses Dokument enthält, als Implementierungsbasis notieren.
3. Für Performancevergleiche trotzdem ausschließlich den Runtime-Stand
   `f33c801981fe45a58bd688575427bbffddf7daa0` verwenden. Der Plan-Commit ändert keine Runtime-Dateien.
4. Einen unveränderten Baseline-Worktree anlegen. Die folgenden Worktree-Befehle werden aus
   `home/user/projects/opentui` ausgeführt, nicht aus einem anderen Worktree:

   ```bash
   git worktree add --detach home/user/projects/opentui/.worktrees/wave2-baseline f33c801981fe45a58bd688575427bbffddf7daa0
   ```

5. Vorhandene Branches oder Worktrees niemals ungeprüft löschen oder überschreiben. Bei Namenskollision anhalten und
   dem Koordinator melden.

### 2.2 Vier Worktrees anlegen

Alle vier Branches starten auf demselben Plan-/Wave-1-Stand:

```bash
git worktree add -b yesloop/wave2-native-ffi home/user/projects/opentui/.worktrees/wave2-native-ffi yesloop/wave1-lifecycle
git worktree add -b yesloop/wave2-entrypoints home/user/projects/opentui/.worktrees/wave2-entrypoints yesloop/wave1-lifecycle
git worktree add -b yesloop/wave2-parser-assets home/user/projects/opentui/.worktrees/wave2-parser-assets yesloop/wave1-lifecycle
git worktree add -b yesloop/wave2-ui-ready home/user/projects/opentui/.worktrees/wave2-ui-ready yesloop/wave1-lifecycle
```

Danach in jedem Worktree einmal `bun install` ausführen. Kein Agent arbeitet im Hauptworktree.

### 2.3 Native Testbasis festschreiben

Die Performance- und FFI-Tests müssen in allen Worktrees dieselbe aktuelle Native-Bibliothek verwenden.

- Erwarteter, in Wave 1 verifizierter SHA-256 der `libopentui.so`:
  `e7e9764462f2ee7f2c808856b60101ff659c6bda4a1df7cf235e418cf481a15c`.
- Vor jedem FFI-/Performance-Lauf Pfad, Hash und Symbolherkunft protokollieren.
- Native Dateien pro Worktree als echte Kopie bereitstellen. Keine Hardlinks zu gemeinsam benutzten
  `node_modules`-Dateien verändern.
- `OTUI_ASSET_ROOT` nicht global für die komplette JS-Suite setzen. Das übersteuert auch Parser-/Runtime-Assets und
  erzeugte in Wave 1 nachweislich falsche Fehler.
- Falls der erwartete Native-Stand nicht verfügbar ist: anhalten und dem Koordinator melden. Nicht stillschweigend mit
  einem älteren Paket testen.
- Wave 2 erwartet keine Zig-Quelländerung. Ein lokaler Native-Neubau mit einer inkompatiblen Zig-Version ist kein
  zulässiger Ersatz für die festgeschriebene Testbasis.

### 2.4 Baseline und Messprotokoll

Vor der ersten Änderung werden auf ruhiger Maschine mindestens diese Werte mit Rohdaten erfasst:

- Root-Cold-Import, Bun und Node;
- `zig.ts`-Cold-Import, Bun und Node;
- neuer schlanker Entry-Point, sobald Loop B ihn bereitstellt;
- Zeit bis zum ersten nativen Commit/TTFMF;
- Import → erster Renderer → erster nativer Commit;
- importierte Module und geladene optionale Subsysteme;
- Anzahl der beim ersten Native-Resolve gebundenen FFI-Symbole;
- RSS/Heap nach Root-Import und nach erstem Frame.

Bekannte Vergleichswerte aus der bisherigen Analyse, nicht als Ersatz für eine neue Baseline:

- TTFMF-Baseline: 392,63 ms;
- Zielwert für den Wave-2-Go-Gate: höchstens 274,84 ms im p50, also mindestens 30 % Verbesserung;
- bisher gemessener Root-Import: ungefähr 380,41 ms;
- bisher isoliertes eager Native-Setup: ungefähr 144,73 ms;
- ein isolierter Single-Symbol-`dlopen`: ungefähr 1,90 ms.

Die letzte Zahl beweist ausdrücklich nicht, dass der vollständige aktuelle FFI-Load nur 1,90 ms kostet.

Begriffe für alle vier Loops:

- `Cold import`: neuer Prozess, noch kein Modulcache des Prozesses;
- `Renderer constructed`: der öffentliche Renderer-Konstruktor bzw. die Factory hat erfolgreich geliefert;
- `First native commit`: der erste erfolgreich abgeschlossene Native-Commit, auch wenn er noch leer wäre;
- `TTFMF`: Zeit bis zum ersten inhaltlich sinnvollen, terminalverändernden Frame; ein leerer Flush zählt nicht;
- `First frame committed` in der Ready-API meint den ersten für den Consumer sichtbaren Commit und muss in Tests gegen
  einen leeren bzw. fehlgeschlagenen Commit abgegrenzt werden.

Messregeln:

1. Debug- und Messläufe nicht mit Produktionsläufen vermischen.
2. Warm-up getrennt ausweisen.
3. Mindestens 30 Cold-Samples für einen abschließenden A/B-Vergleich.
4. Baseline und Kandidat gepaart/abwechselnd starten, um zeitliche Drift zu reduzieren.
5. Median, p95, Streuung und Rohdaten speichern; keine Einzelmessung als Ergebnis melden.
6. Der bestehende `--gate` des Cold-Import-Benchmarks darf nicht blind benutzt werden, solange er auf den Fastpatch-
   Worktree statt auf die Wave-1-Baseline zeigt. Entweder expliziten Baseline-Pfad ergänzen oder das abschließende A/B
   im Integrationsloop ausführen.

## 3. Regeln für jeden Implementierungsagenten

Jeder Agent arbeitet exakt nach diesem Ablauf:

1. `AGENTS.md` vollständig lesen.
2. Branch, Worktree, Basis-Commit und `git status --short` in der Übergabe notieren.
3. Zuerst bestehende Seams, Eigentümer und Tests lesen; keine parallele Policy erfinden.
4. Einen fokussierten Test des beobachtbaren Verhaltens hinzufügen und einmal RED ausführen.
5. Die kleinste Änderung implementieren, die den Test GREEN macht.
6. Den fokussierten Test, danach `bun run test:js` im Paket `packages/core` ausführen.
7. Je nach Umfang zusätzlich Node-, Build- und Dist-Tests ausführen.
8. Nur eigene Dateien committen. Fremde oder unerwartete Änderungen nicht anfassen.
9. RED darf dokumentiert werden, aber der übergebene Branch endet GREEN. Ein absichtlich fehlschlagender
   Zwischencommit wird nicht übergeben.
10. Bei einem Stop-Kriterium nicht improvisieren: Befund, Messdaten und kleinstmöglichen nächsten Schritt melden.

Commit-Nachrichten sollen den Loop erkennen lassen, beispielsweise `perf(core): defer native ffi initialization`.

## 4. Loop A – B3/B4: Native- und FFI-Laden

### 4.1 Auftrag

Den eager Native-/FFI-Anteil aus dem Importpfad entfernen und danach nur dann die anfänglich gebundene FFI-Oberfläche
verkleinern, wenn Messung und Ownership-Modell das sicher erlauben.

Loop A ist der riskanteste Loop und erhält die stärkste verfügbare Person. B3 und B4 sind zwei getrennte Checkpoints.
B3 muss vollständig grün und separat committet sein, bevor B4 beginnt.

### 4.2 Eigentumsbereich

Loop A darf ändern:

- `packages/core/src/zig.ts`;
- direkt zugehörige FFI-Facades/Typen unter `packages/core/src/platform/`, falls zwingend erforderlich;
- neue fokussierte Tests für Lazy-Load, Resolve-Reihenfolge und Disposal;
- loop-eigene Benchmark-Rohdaten und einen kurzen Ergebnisbericht.

Loop A darf nicht ändern:

- `packages/core/package.json` oder Exporttabellen;
- Parser-Worker-/Runtime-Asset-Policy in `runtime-assets.*`;
- Renderer-Ready-API;
- Zig-Quellen oder den Inhalt der nativen Bibliothek.

### 4.3 Checkpoint A1 – B3: eager `FFIRenderLib` entfernen

Aktueller Befund:

- `zig.ts` löst im Modulscope den Native-Pfad auf;
- am Dateiende wird eager `new FFIRenderLib(...)` ausgeführt;
- `resolveRenderLib()` und Konstruktoren sind synchron;
- `setRenderLibPath()` darf vor dem ersten Resolve funktionieren und danach nicht mehr.

Verbindliches Ziel für A1:

- Ein Import von `zig.ts` konstruiert keine `FFIRenderLib` und öffnet/bindet keine Native-Bibliothek.
- Der erste echte Aufruf von `resolveRenderLib()` konstruiert genau eine Instanz.
- Wiederholte Resolve-Aufrufe liefern dieselbe Instanz.
- `setRenderLibPath()` funktioniert vor dem ersten Resolve und wirft danach weiterhin.
- Callback-, Image-ICC-, Logging-, Eventbus- und `dlclose`-Ownership bleiben auf allen Exit-Pfaden korrekt.
- Die asynchrone Native-Pfad-Auflösung wird in A1 nicht neu entworfen. Sie darf zunächst eager bleiben, damit die
  synchrone Resolve-API nicht heimlich async wird.

Pflichttests vor der Implementierung:

1. Child-Process-Test: Import von `zig.ts` erzeugt keinen `opentui.nativeLoaded`-Marker und keinen FFI-Load.
2. Erster Resolve erzeugt den Marker genau einmal.
3. Zwei aufeinanderfolgende Resolves ergeben dieselbe Objektidentität.
4. Pfad vor Resolve setzen: erfolgreich; Pfad nach Resolve setzen: definierter Fehler.
5. Resolve-/Konstruktorfehler hinterlassen keinen halb initialisierten globalen Zustand; ein definierter Folgeversuch
   verhält sich reproduzierbar.
6. Disposal ruft native Freigabe und Callback-Disposal nicht doppelt auf.

Nicht zulässige Lösungen:

- `async resolveRenderLib()`;
- `await import()` in einem synchronen Konstruktor;
- Fehler beim ersten Resolve schlucken und ein teilweise initialisiertes Singleton cachen;
- den eager Load nur in einen anderen Root-Import verschieben;
- eine zweite globale Native-Instanz als Abkürzung einführen.

### 4.4 Checkpoint A2 – B4: Binding-Gruppen nur nach Beweis

Zuerst messen:

- vollständige Zeit in `getOpenTUILib()`/`dlopen`;
- Anzahl und Kategorien der gebundenen Symbole;
- Zeit und Symbole, die bis zum ersten Textframe tatsächlich gebraucht werden;
- Bun-/Node-Verhalten bei mehreren Binding-Gruppen für dieselbe Bibliothek;
- Verhalten von `dlclose`, Callback-Ownership und Fehlerpfaden bei mehreren Handles.

Zulässige Gruppen, falls der bestehende Seam dies trägt:

- Basis: Renderer, Text, Layout, Buffer, Terminal-I/O;
- optional: Image;
- optional: Audio;
- optional: Clipboard/weitere seltene Funktionen.

Implementieren nur, wenn alle folgenden Aussagen mit Tests belegt sind:

1. Der erste Textframe benötigt die optionale Gruppe nicht.
2. Die Plattform-Facade kann eine Gruppe später synchron und deterministisch binden.
3. Bun und Node zeigen dasselbe API-Verhalten.
4. Es gibt einen eindeutigen Besitzer jedes Handles und einen getesteten Disposal-Pfad.
5. Eine fehlende optionale Funktion beschädigt weder Basisrenderer noch schon sichtbare UI.
6. Die Messung zeigt einen relevanten Gewinn gegenüber A1.

Wenn eine Aussage nicht belegbar ist, endet A2 als dokumentierter No-op. Dann werden Messung, Blocker und ein späterer
Designvorschlag übergeben; die funktionierende A1-Änderung bleibt trotzdem gültig.

### 4.5 Verifikation Loop A

Mindestens:

```bash
cd packages/core
bun test src/tests/zig-lazy-ffi.test.ts
bun run test:js
bun run test:js:node
bun run build:lib
bun run test:dist
```

Zusätzlich Cold-Import für `zig`, Root und Dist sowie TTFMF messen. Importgewinn und TTFMF-Gewinn getrennt ausweisen;
ein verschobener Load ist noch keine TTFMF-Verbesserung.

### 4.6 Stop-Kriterien Loop A

Sofort anhalten bei:

- notwendiger Änderung einer synchronen öffentlichen API;
- notwendiger physischer `.so`-Aufteilung;
- nicht beweisbarer Handle-/Callback-Ownership;
- Bun-/Node-Abweichung;
- benötigter Zig-Quelländerung;
- Native-Artefakt mit unbekannter oder falscher Herkunft.

## 5. Loop B – B1/B2: granulare Entry-Points

### 5.1 Auftrag

Unterstützte, dokumentierte Subpath-Exports schaffen, über die ein Text-Renderer ohne Audio, Image, Tree-sitter,
Parser-Worker oder Console-Zusatzpfade importiert werden kann. Der Root-Entry-Point bleibt kompatibel.

### 5.2 Eigentumsbereich

Loop B darf ändern:

- neue schlanke Source-Entry-Point-Dateien unter `packages/core/src/`;
- `packages/core/package.json`;
- `packages/core/scripts/build.ts`;
- `packages/core/scripts/dist-test.ts`;
- Export-/Import-Graph- und Package-Tests;
- den Cold-Import-Benchmark nur um eindeutig benannte neue Szenarien erweitern.

Loop B darf nicht ändern:

- `zig.ts` und FFI-Ladepolicy;
- `runtime-assets.bun.ts`/`.node.ts`;
- Renderer-Lifecycle oder Ready-Stufen;
- Root-Exports entfernen, um einen Benchmark künstlich zu verbessern.

### 5.3 Zielstruktur

Die endgültigen Namen werden gegen die vorhandene Namens- und Buildstruktur geprüft. Erwartete additive Entry-Points
sind mindestens:

- `@opentui/core/renderer` – Renderer plus zwingende Basis;
- `@opentui/core/renderable` – Basisklassen/Primitive ohne optionales Sammelmodul;
- `@opentui/core/audio`;
- `@opentui/core/image`;
- `@opentui/core/markdown-tree-sitter`;
- optional `@opentui/core/console`, falls der Importgraph damit sauberer wird.

Der schlanke Renderer-Entry darf nicht einfach `export * from "./index.js"` verwenden. Er importiert seine belegte
minimale Menge direkt. Keine Policy oder Klasse kopieren.

### 5.4 RED-Tests

Vor der Implementierung müssen Tests mindestens zeigen:

1. Die neuen Package-Subpaths sind noch nicht auflösbar.
2. Ein Importtrace des geplanten Lean-Entry lädt aktuell unerwünschte Module oder existiert noch nicht.
3. Die Dist-Prüfung kennt die neuen ESM-/CJS-Exports noch nicht.

Danach GREEN-Anforderungen:

1. Source-, gebaute ESM- und gebaute CJS-Variante exportieren denselben vorgesehenen Vertrag.
2. Lean-Import lädt keine Audio-, Image-, Markdown-, Tree-sitter-, Worker- oder Console-Implementierung.
3. Lean-Import startet keinen Worker. Dass er nach Integration keine optionale Native-Gruppe lädt, prüft der
   Integrator gemeinsam mit Loop A; Loop B belegt dafür mindestens den Source-/Build-Modulgraph.
4. Root-Exportnamen vor und nach der Änderung sind identisch; additive Root-Änderungen nur mit Begründung.
5. Bestehende Importpfade bleiben gültig.
6. TypeScript-Deklarationen und Paketdateien enthalten die Subpaths.
7. Fehlende optionale Laufzeitabhängigkeiten verhindern den Lean-Import nicht.

Importgraph-Beweise dürfen Child-Process-Traces, Modul-Mocks oder Build-Metadaten verwenden. Eine reine Sichtprüfung der
Source-Datei reicht nicht.

### 5.5 `sideEffects`-Regel

`"sideEffects": false` wird nicht global gesetzt, außer ein Test beweist alle betroffenen Entry-Points und Runtime-
Plugins. Bevorzugt werden explizite Entry-Points und echte Importgraph-Trennung. Tree-shaking ist kein Ersatz für einen
sauberen Runtime-Graph.

### 5.6 Benchmark-Anpassung

`packages/core/scripts/bench-cold-import.ts` erhält eigene Szenarionamen für die neuen öffentlichen Entry-Points. Das
bisherige Szenario `minimal`, das intern nur `Renderable.ts` misst, darf nicht stillschweigend umgedeutet werden.
Berichtet werden beispielsweise `renderer-entry`, `renderable-entry`, `root`, `zig` und `dist-root`.

### 5.7 Verifikation Loop B

Mindestens:

```bash
cd packages/core
bun test src/tests/package-entrypoints.test.ts src/tests/entrypoint-import-graph.test.ts
bun run test:js
bun run test:js:node
bun run build:lib
bun run test:dist
```

Zusätzlich Lean- und Root-Cold-Import unter Bun und Node messen. Der Agent meldet die exakte Liste der Module, die der
Lean-Entry nicht mehr lädt.

### 5.8 Stop-Kriterien Loop B

Anhalten und melden, wenn:

- ein schlanker Entry nur durch Kopieren von Implementierung/State möglich wäre;
- die Buildpipeline einen Subpath nicht in ESM, CJS und Typen konsistent abbilden kann;
- Root-Kompatibilität nur durch Breaking Changes erreichbar wäre;
- der gewünschte Entry zwingend ein Modul mit unbekannten Seiteneffekten herauslösen müsste.

## 6. Loop C – B5: Parser-Worker- und Asset-Auflösung

### 6.1 Auftrag

Den tatsächlichen Anteil der eager Bun-Auflösung von `parser.worker` am Import- und First-Frame-Pfad isolieren. Nur bei
relevantem, reproduzierbarem Gewicht wird die Auflösung lazy gemacht.

Bekannter Befund: `runtime-assets.bun.ts` löst den gebündelten Workerpfad im Modulscope auf. Die bisherige Analyse sagt,
dass der Worker dabei auf dem Main Thread nicht ausgeführt wird. Das ist zu verifizieren, nicht neu zu vermuten.

### 6.2 Eigentumsbereich

Loop C darf ändern:

- `packages/core/src/platform/runtime-assets.bun.ts`;
- bei notwendiger Parität die entsprechende Node-Datei;
- fokussierte Runtime-Asset-/Worker-Tests;
- ein isoliertes Messskript oder ein eindeutig benanntes Benchmark-Szenario;
- loop-eigenen Ergebnisbericht und Rohdaten.

Loop C darf nicht ändern:

- `zig.ts` oder FFI-Bindings;
- Package-Exports;
- Renderer-Ready-API;
- Parser-/Worker-Lebenszyklus aus Wave 1 erneut entwerfen.

### 6.3 Messphase C1

Getrennt messen:

1. reine Evaluation von `runtime-assets.bun.ts`;
2. Zeit der `import("@opentui/core/parser.worker", { type: "file" })`-Auflösung;
3. Root-Import mit und ohne Zugriff auf den Workerpfad;
4. Lean-Renderer-Import aus Loop B, sobald verfügbar – für den parallelen Loop zunächst mit lokalem Testfixture;
5. ob Worker-Code ausgeführt oder nur als Asset aufgelöst wird;
6. Bun- und Node-Verhalten;
7. erster echter Tree-sitter-Start nach einer möglichen Lazy-Änderung.

Entscheidung:

- Unter 2 % des Root-Imports und ohne First-Frame-Einfluss: keine Runtime-Änderung; Befund als No-op übergeben.
- Ab 2 % oder bei nachweislicher Blockierung des Lean-/First-Frame-Pfads: C2 implementieren.

Die 2-%-Schwelle ist ein Priorisierungsgate, kein Anspruch auf statistische Präzision. Ein klarer Deadlock-/Fehlerpfad
wird unabhängig von der Zeit behoben.

### 6.4 Implementierung C2, nur wenn Gate positiv

Anforderungen:

- Workerpfad wird erst beim ersten Tree-sitter-/Worker-Bedarf aufgelöst.
- Bestehende synchrone APIs werden nicht heimlich async.
- Falls die Plattform den Assetpfad nur asynchron ermitteln kann, wird ein vorhandener Preload-/Manifest-/Build-Seam
  verwendet. Es wird kein zweiter Cache oder eigener Resolver erfunden.
- Gleichzeitige erste Zugriffe teilen sich genau eine Auflösung.
- Fehler werden nicht dauerhaft als scheinbar erfolgreicher Pfad gecacht.
- Node- und Bun-Verhalten bleiben semantisch gleich.
- Ein fehlender optionaler Worker beschädigt den sichtbaren Basisrenderer nicht.

Pflichttests:

1. Root-/Lean-Import führt keine Worker-Auflösung aus.
2. Erster Workerbedarf löst genau einmal auf.
3. Zwei parallele Anforderungen erzeugen keine doppelte Arbeit.
4. Fehlerpfad ist determiniert und hinterlässt keinen Hänger.
5. Worker kann nach dem Lazy-Resolve gestartet und aus Wave 1 korrekt beendet werden.

### 6.5 Verifikation Loop C

Mindestens fokussierte Assettests, `bun run test:js`, `bun run test:js:node`, `bun run build:lib` und `bun run test:dist`.
Rohdaten vor/nachher oder ein klarer No-op-Bericht sind Pflicht.

### 6.6 Stop-Kriterien Loop C

Anhalten bei notwendiger öffentlicher Sync→Async-Änderung, einem zweiten Asset-Resolver, beschädigter Node-Parität oder
wenn der Test versehentlich nur den Worker mockt und die reale Paketauflösung nicht mehr prüft.

## 7. Loop D – B6: UI-first und Ready-Stufen

### 7.1 Auftrag

Einen kleinen, additiven Vertrag schaffen, mit dem ein Consumer zuerst eine funktionsfähige Basisoberfläche committen
und optionale Werkzeuge danach laden kann. Die vier semantischen Stufen sind:

1. Core ready;
2. First frame committed;
3. Enhanced ready;
4. Application ready.

Loop D optimiert den OpenTUI-Seam. Er baut keine OpenCode-Skeleton-UI und lädt keine echten OpenCode-Tools.

### 7.2 Eigentumsbereich

Loop D darf ändern:

- `packages/core/src/renderer.ts` und direkt zugehörige Lifecycle-/Eventtypen;
- eine kleine neue Readiness-Hilfe, falls die bestehenden Events nicht ausreichen;
- fokussierte `TestRenderer`-/Renderer-Tests;
- ein minimales Testfixture oder Beispiel für verzögert geladene optionale Arbeit.

Loop D darf nicht ändern:

- `zig.ts`/FFI;
- Package-Exporttabellen – ein nötiger öffentlicher Export wird dem Integrator gemeldet;
- Parser-Worker-Assetpolicy;
- OpenCode-Dateien oder OpenCode-Anwendungszustand.

### 7.3 Semantik zuerst festlegen

Vor Codeänderung muss ein Test die genaue Bedeutung beweisen:

- `Core ready`: Kernmodule/Runtime sind verwendbar; dies ist nicht gleichbedeutend mit einem sichtbaren Frame.
- `First frame committed`: Der erste erfolgreiche native Commit ist abgeschlossen. Ein bloßer Render-Request, Timer oder
  Telemetrie-Start reicht nicht.
- `Enhanced ready`: Der Consumer hat seine als optional definierten Erweiterungen abgeschlossen oder kontrolliert als
  fehlgeschlagen markiert.
- `Application ready`: Der Consumer erklärt seine gesamte Startsequenz für abgeschlossen.

`Enhanced ready` und `Application ready` werden vom Consumer markiert. OpenTUI darf nicht raten, welche Tools eine
Anwendung besitzt.

### 7.4 RED-Tests

Mindestens folgende Szenarien zuerst fehlschlagen lassen:

1. First-frame-Waiter löst erst nach einem tatsächlichen erfolgreichen nativen Commit aus.
2. Mehrere Waiter lösen genau einmal und in stabiler Reihenfolge aus.
3. Ein früher Renderfehler meldet einen definierten Fehler; kein Promise bleibt für immer offen.
4. `destroy()` vor dem ersten Frame beendet Waiter definiert; kein Hänger und kein Listener-Leak.
5. Optionale Enhanced-Arbeit kann erst nach dem Basisframe beginnen.
6. Ein Fehler einer optionalen Erweiterung macht den schon sichtbaren Basisframe nicht rückgängig.
7. Fokus, Escape-/Abbruchpfad und Fehleranzeige bleiben im Testfixture funktionsfähig, während optionale Arbeit lädt.
8. Capability-Erkennung bleibt parallel; der First-Frame-Pfad wartet nicht versehentlich auf einen langen Timeout.

### 7.5 Implementierungsregeln

- Bestehende `CliRenderEvents`, Commit-Seams und Wave-0-Telemetrie wiederverwenden.
- Ein Milestone wird monoton höchstens einmal erreicht.
- Listener/Promises auf Resolve, Reject und Destroy vollständig bereinigen.
- Keine Polling-Schleife und kein neuer periodischer Timer.
- Keine künstliche Verzögerung, um Reihenfolgen zu erzwingen.
- Bestehende Render- und Konstruktor-APIs bleiben kompatibel.
- Wenn bestehende Events alle vier Stufen bereits zuverlässig ausdrücken können, reicht eine kleine getestete Helper-
  Schicht oder sogar ein dokumentierter No-op. Keine zweite Lifecycle-State-Machine danebenstellen.
- Das Referenzfixture nutzt eine kontrollierte Fake-Dynamic-Import-Aufgabe; es darf keine reale Netzwerk- oder
  OpenCode-Abhängigkeit einführen.

### 7.6 Verifikation Loop D

Mindestens fokussierte Renderer-/TestRenderer-Tests und `bun run test:js`. Bei öffentlichem Runtime-Code zusätzlich
`bun run test:js:node`, `bun run build:lib` und `bun run test:dist`.

Messen:

- Zeit bis zum ersten Commit ohne Erweiterung;
- Zeit bis Enhanced/Application ready;
- First-frame-Zeit bei schneller, langsamer und fehlschlagender optionaler Aufgabe;
- verbleibende Handles/Timer/Listener nach Destroy in jeder Stufe.

### 7.7 Stop-Kriterien Loop D

Anhalten, wenn die Lösung OpenCode-Anwendungslogik in OpenTUI ziehen, eine zweite Lifecycle-Policy einführen oder einen
öffentlichen Konstruktor asynchron machen würde.

## 8. Konflikt- und Abhängigkeitsmatrix

| Datei/Bereich                                      | A        | B                | C                                         | D             | Integrator                 |
| -------------------------------------------------- | -------- | ---------------- | ----------------------------------------- | ------------- | -------------------------- |
| `src/zig.ts`                                       | Besitzer | nein             | nein                                      | nein          | Review                     |
| `src/platform/runtime-assets.*`                    | nein     | nein             | Besitzer                                  | nein          | Review                     |
| `src/renderer.ts`                                  | nein     | nein             | nein                                      | Besitzer      | Review                     |
| `package.json`, `scripts/build.ts`, `dist-test.ts` | nein     | Besitzer         | nein                                      | nein          | Konflikte lösen            |
| Cold-Import-Benchmark                              | Messung  | Szenarien        | isolierte Ergänzung nur wenn konfliktfrei | nein          | endgültig zusammenführen   |
| öffentliche Readiness-Exports                      | nein     | noch nicht raten | nein                                      | Bedarf melden | endgültig exportieren      |
| `.yesmem/perftodo.md`                              | nein     | nein             | nein                                      | nein          | nach Abnahme aktualisieren |

Abhängigkeiten:

- B darf einen schlanken Entry-Point gegen den unveränderten aktuellen Native-Seam bauen; A wird nicht vorausgesetzt.
- C misst zunächst unabhängig. Den finalen Lean-Import-Test führt der Integrator nach B+C zusammen aus.
- D baut auf dem vorhandenen erfolgreichen nativen Commit-Seam auf. A darf dessen beobachtbare Semantik nicht ändern.
- Öffentliche Exporte einer neuen D-Readiness-Hilfe werden ausschließlich in der Integration mit B abgestimmt.
- B4 wird innerhalb von A erst nach A1 ausgeführt, nicht parallel zu A1.

## 9. Übergabeformat jedes Loops

Jeder Agent liefert exakt diese Informationen:

```text
Loop:
Branch / Worktree:
Basis-Commit / Head-Commit:
Status: GREEN | NO-OP-MIT-BELEG | BLOCKIERT

Commits in Reihenfolge:
Geänderte Dateien:
Nicht geänderte Eigentumsbereiche bestätigt:

RED-Test und beobachteter Fehler:
GREEN-Tests mit exakten Befehlen:
Node-/Dist-Prüfung:

Native-Artefakt: Pfad, SHA-256, Symbolherkunft:
Messung vorher: Median, p95, Samples, Rohdatenpfad:
Messung nachher: Median, p95, Samples, Rohdatenpfad:
Beobachteter Gewinn bzw. No-op-Begründung:

API-/Ownership-Invarianten:
Offene Risiken:
Empfohlene Integrationsreihenfolge:
```

„Tests grün“ ohne Befehle und Ergebnis ist keine gültige Übergabe.

## 10. Integrationsphase

### 10.1 Vor dem Cherry-pick

1. Alle vier Übergaben lesen.
2. In jedem Worktree `git status --short` und Commitliste prüfen.
3. Test- und Messrohdateien stichprobenartig öffnen.
4. No-op-Ergebnisse als Erfolg akzeptieren, wenn das Messgate sauber belegt ist.
5. Keine Branchspitze pauschal mergen; nachvollziehbare Commits einzeln übernehmen.

### 10.2 Empfohlene Reihenfolge

1. Loop A, Checkpoint A1/B3;
2. Loop B, Entry-Points und Buildintegration;
3. Loop C, falls es eine Runtime-Änderung gibt;
4. Loop D, Ready-Semantik;
5. Loop A, Checkpoint A2/B4, nur wenn als separater belegter Commit vorhanden;
6. Integrator: öffentliche Readiness-Exports und Benchmark-Szenarien konfliktfrei zusammenführen.

Die Reihenfolge hält die wichtigste Lazy-Native-Änderung separat und lässt eine riskantere B4-Verfeinerung zuletzt
entfernbar.

### 10.3 Integrationsprüfungen

Funktional:

- Root-Exportoberfläche vergleichen;
- Lean-, Audio-, Image-, Markdown-/Tree-sitter- und Console-Subpaths testen;
- Basisrenderer und erster Textframe unter Bun und Node;
- Audio/Image/Tree-sitter jeweils beim ersten echten Bedarf;
- Destroy vor/während/nach erster Native-Auflösung;
- Destroy vor First frame, zwischen First/Enhanced und nach Application ready;
- optionale Importfehler bei weiterhin sichtbarer Basis-UI;
- keine offenen Worker, Timer, Handles, Callbacks oder Listener.

Statisch und Paket:

```bash
cd packages/core
bun run test:js
bun run test:js:node
bun run build:lib
bun run test:dist
```

Vom Repository-Root danach, soweit für die geänderten Dateien relevant:

```bash
bun run fmt:check
bun run lint
```

Ein Root-Native-Build ist nur bei Native-/Cross-Package-Outputänderungen nötig. Wave 2 soll keine Native-Quelle ändern.

### 10.4 Abschließende Performance-Matrix

Jeweils Wave-1-Baseline gegen integrierten Wave-2-Stand, mindestens 30 gepaarte Cold-Samples:

| Runtime | Import             | Zustand                      |
| ------- | ------------------ | ---------------------------- |
| Bun     | Root               | Import fertig                |
| Bun     | Lean renderer      | Import fertig                |
| Bun     | Lean renderer      | erster Renderer konstruiert  |
| Bun     | Lean renderer      | erster nativer Commit/TTFMF  |
| Bun     | optionaler Subpath | erstes echtes Feature bereit |
| Node    | Root               | Import fertig                |
| Node    | Lean renderer      | Import fertig                |
| Node    | Lean renderer      | erster nativer Commit/TTFMF  |

Zusätzlich pro Fall: p50, p95, RSS, Heap, Modulanzahl, FFI-Bindings und verbliebene Handles.

## 11. Go-/No-Go-Gates

Wave 2 wird nur als neue Grundlage markiert, wenn alle Pflichtgates grün sind:

1. Cold TTFMF p50 ist mindestens 30 % besser als 392,63 ms, also höchstens 274,84 ms, oder der Koordinator
   dokumentiert ausdrücklich, warum die gemessene neue Wave-1-Baseline einen korrigierten Zielwert erfordert.
2. Die Verbesserung ist im p95 sichtbar und kein Median-Ausreißer.
3. Root-API und bestehende Subpaths bleiben kompatibel.
4. Lean-Entry lädt keine ausgeschlossenen optionalen Subsysteme.
5. Bun und Node finden dieselben vorgesehenen Native-/Worker-Assets.
6. First-frame-/Ready-Waiter können auf Fehler und Destroy nicht hängen bleiben.
7. Optionale Importfehler zerstören weder Basisrenderer noch schon sichtbare UI.
8. Keine messbare Steady-State-Renderregression über 3 % ohne separat begründeten Trade-off.
9. Keine neuen offenen Handles, Timer, Worker, Listener oder doppelten Native-Disposals.
10. Alle Pflicht-Tests, Build-/Dist-Prüfungen und Formatchecks sind grün.

Wenn das 30-%-TTFMF-Ziel nicht erreicht wird, bleiben belegte, kompatible Einzelverbesserungen als Commits erhalten,
aber Wave 2 wird nicht pauschal als abgeschlossen bezeichnet. Der Bericht benennt dann den verbliebenen dominanten
kritischen Pfad und die nächste messbare Hypothese.

## 12. Erwartetes Endergebnis

Nach erfolgreicher Integration existieren:

- ein kompatibler Root-Entry und belegbar schlanke öffentliche Subpaths;
- kein eager `FFIRenderLib`-/Native-Binding beim bloßen Import;
- nur bei Beweis eine kleinere First-Frame-FFI-Bindingsmenge;
- nur bei Beweis eine lazy Parser-Worker-Auflösung;
- eine robuste, additive First-frame-/Ready-Semantik ohne Hängerpfade;
- ein reproduzierbarer Bun-/Node-A/B-Bericht gegen Wave 1;
- eine klare Aussage, welcher Anteil von Import, Native Resolve, FFI Binding und optionaler Arbeit tatsächlich
  eingespart oder aus dem sichtbaren kritischen Pfad entfernt wurde.
