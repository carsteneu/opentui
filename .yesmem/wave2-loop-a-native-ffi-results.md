# Wave 2 Loop A: Native-/FFI-Laden

Stand: 2026-08-17

## Übergabe

- Loop: A, B3/B4
- Branch / Worktree: `yesloop/wave2-native-ffi` / `.worktrees/wave2-native-ffi`
- Runtime-Basis: `f33c801981fe45a58bd688575427bbffddf7daa0`
- Implementierungsbasis: `bf23ea84`
- A1/B3: **GREEN**
- A2/B4: **NO-OP-MIT-BELEG / DEFERRED**
- Runtime-Commits in Reihenfolge: `e440c0fc`, `6f7cb23b`

Loop A änderte ausschließlich `packages/core/src/zig.ts`, die fokussierten Lazy-FFI-Tests und diesen Bericht. Package-
Exports, Renderer-Readiness, Runtime-Asset-Policy und Zig-/Native-Quellen blieben unverändert.

## A1/B3: Ergebnis und Invarianten

`e440c0fc` entfernt ausschließlich die eager Konstruktion von `FFIRenderLib` am Ende von `zig.ts`. Die asynchrone
Auflösung des Native-Pfads im Modulscope bleibt bewusst unverändert. Dadurch bleiben `resolveRenderLib()` und alle
öffentlichen Konstruktoren synchron.

Die Regressionstests belegen:

1. Der Import von `zig.ts` setzt keinen `opentui.nativeLoaded`-Marker und konstruiert somit mit einem gültigen
   Native-Artefakt keine `FFIRenderLib`.
2. Der erste explizite Resolve lädt genau einmal; weitere Resolves liefern dieselbe Objektidentität.
3. `setRenderLibPath()` funktioniert vor dem Resolve und wirft danach weiterhin.
4. Ein fehlgeschlagener Resolve cached kein teilweise initialisiertes Singleton. Der Fehler ist reproduzierbar und ein
   anschließender Resolve mit explizit gesetztem gültigem Pfad ist möglich.
5. Zweimaliges `dispose()` führt nur zu einem Library-Close und einem Event-Sink-Destroy.

Der letzte Punkt beobachtet den vorhandenen, TypeScript-privaten Library-Owner nur im Child-Test; es wurde kein
Production-Testhook ergänzt. `packages/core/src/platform/ffi.test.ts` belegt separat, dass ein einmaliges Library-Close
die verwalteten Callbacks genau einmal und erst nach dem Native-Close freigibt.

## Test-first-Protokoll

Die ursprüngliche Übergabe war nicht aus einem reinen Git-Stand reproduzierbar: Der Test verwies auf die lokale,
unversionierte Datei `packages/core/.yesmem/native-assets/@opentui/core-linux-x64/libopentui.so`. Ein Git-Archiv von
`6f7cb23b` ohne diesen privaten Ordner ergab **2 bestanden / 4 fehlgeschlagen**.

Die Korrektur löst das zum aktuellen `getNativeAssetDescriptor(getCurrentNodeAssetTarget())` gehörende optionale Paket
über dessen regulären installierten Package-Export auf. Erfolgreiche Resolve-/Dispose-Child-Modi erhalten diesen Pfad
explizit. `OTUI_ASSET_ROOT` wird nur für die absichtlichen Fehler-/Recovery-Szenarien gesetzt. Damit existiert weder ein
Linux-x64-Hardcoding noch eine Abhängigkeit von einer unversionierten `.yesmem`-Datei.

Vor der Exact-once-Instrumentierung schlug der erweiterte Test erwartungsgemäß fehl:

```text
bun test src/tests/zig-lazy-ffi.test.ts
5 pass, 1 fail
Expected libraryCloseCalls: 1; Received: undefined
```

Nach der kleinsten Fixture-Erweiterung ist derselbe Test mit **6 bestanden / 0 fehlgeschlagen** grün.

## Native-Provenienz

Der Test verwendet nach `bun install` das reguläre optionale Native-Paket für die aktuelle Plattform. Der geprüfte
Linux-x64-Host löste auf:

- Paket: `@opentui/core-linux-x64@0.5.3`
- Datei: `packages/core/node_modules/@opentui/core-linux-x64/libopentui.so`
- SHA-256: `e7e9764462f2ee7f2c808856b60101ff659c6bda4a1df7cf235e418cf481a15c`
- Größe: 20.901.984 Bytes
- `nm -D --defined-only`: 1.890 exportierte Symbole

Der Test bestimmt Paketname und Dateiname nicht selbst, sondern benutzt die bestehende Plattform-/Asset-Beschreibung.

## Messungen

### Explorative Importmessung

Die vorhandenen lokalen Rohdateien wurden nicht committed, weil sie weder gepaart/abwechselnd aufgenommen wurden noch
den gemessenen Commit in ihrem JSON festhalten. Sie bleiben als lokale Arbeitsartefakte erhalten und sind ausdrücklich
kein Wave-2-Go-Gate. Ihre ehrlichen Stichprobengrößen und linearen Quantile sind:

| Ziel     | Zustand                  |   n |          p50 |          p95 |
| -------- | ------------------------ | --: | -----------: | -----------: |
| `zig.ts` | als Baseline beschriftet |  30 |   913,279 ms | 1.563,381 ms |
| `zig.ts` | A1-Kandidat              |  30 |   168,521 ms |   279,005 ms |
| Root     | als Baseline beschriftet |  15 | 1.260,021 ms | 2.552,357 ms |
| Root     | A1-Kandidat              |  15 |   313,092 ms |   530,001 ms |

Die explorativen p50-Punktwerte entsprechen damit rund **−81,5 %** für `zig.ts` und **−75,2 %** für Root. Die Root-
Messung hat nur 15 Samples. Wegen fehlender Paarung, Hostdrift und unvollständiger Commit-Provenienz dürfen diese Werte
nicht als abschließender statistischer Gewinn verwendet werden.

### Verschobener Native-Resolve und TTFMF

30 neue, isolierte A1-Resolve-Samples ergaben für `resolveRenderLib()` p50 **170,865 ms** und p95 **208,211 ms**. Das
ist die beim Import entfernte, beim ersten echten Native-Bedarf weiterhin anfallende Arbeit.

Eine diagnostische, nicht gepaarte Root-/Textframe-Probe ergab Import **81,449 ms**, First-native-commit **267,093 ms**
und TTFMF **267,447 ms**. Eine Einzelprobe ist kein Performance-Gate. A1 verkürzt den Import, entfernt aber keine Arbeit
aus Import plus unmittelbar anschließendem Rendererbau. Der bestätigte TTFMF-Gewinn von A1 ist daher **unverändert / 0
belegt**. Die gepaarte Wave-1-gegen-Wave-2-TTFMF-Matrix bleibt Aufgabe der Integration.

## A2/B4: Symbol- und Ownership-Befund

Der aktuelle `getOpenTUILib()` übergibt **394 Definitionen** in einem einzigen `dlopen`. Eine reproduzierbare statische
Präfixklassifikation ergibt:

| Gruppe                             | Definitionen |
| ---------------------------------- | -----------: |
| Renderer/Terminal                  |           41 |
| Buffer/Hitgrid                     |           45 |
| Text                               |           56 |
| Editor                             |           75 |
| Yoga/Layout                        |           50 |
| Audio                              |           43 |
| Image                              |           24 |
| Clipboard                          |           20 |
| Sonstige/Logging/Event/Span/Syntax |           40 |

Eine `OTUI_TRACE_FFI=1`-Probe für genau einen Textframe plus Teardown rief 59 verschiedene Bindings auf. Darunter war
kein Audio- und kein Clipboard-Symbol. Aus der Image-Gruppe wurde `imageRetainIccCache` wegen der bestehenden
`FFIRenderLib`-Ownership bereits beim Konstruktor verwendet. Der First-frame-Satz ist also erheblich kleiner als die
Definitionstabelle, aber nicht vollständig von optionalem Image-State getrennt.

Es gibt gegenwärtig keinen vorhandenen Owner für nachträglich synchron geladene Binding-Gruppen. Eine Aufteilung der
Definitionstabelle würde entweder mehrere `dlopen`-Handles derselben Bibliothek oder eine neue gemeinsame Handle-
Abstraktion erfordern. Für Bun und Node sind dabei Referenzzählung, `dlclose`-Reihenfolge, Callback-Lebensdauer,
Event-Sink und ICC-Cache-Ownership nicht gemeinsam belegt. Das verletzt die A2-Voraussetzungen 2–4 und trifft das
Stop-Kriterium „nicht beweisbarer Handle-/Callback-Owner“.

Deshalb wurde **keine B4-Runtimeänderung** erfunden. Der Befund rechtfertigt eine spätere eigene Design-/Messwelle,
aber noch keinen sicheren Cherry-pick. Eine physische `.so`-Aufteilung war für Wave 2 ohnehin ausdrücklich verboten.

## Verifikation und Restpunkte

Ausgeführt:

```text
bun test src/tests/zig-lazy-ffi.test.ts src/platform/ffi.test.ts
29 pass, 0 fail

Git-Archiv von HEAD plus exakt den beiden geänderten Testdateien,
ohne packages/core/.yesmem, mit regulär installiertem optionalem Native-Paket:
bun test src/tests/zig-lazy-ffi.test.ts
6 pass, 0 fail

bun run test:js
5500 pass, 23 skip, 0 fail

bun run build:lib
exit 0

bun run test:dist --skip-build
Node ESM, Node CommonJS und Bun dist smoke tests: pass
```

`bun run test:js:node` wurde mit dem vorgeschriebenen Node v26.4.0 gestartet, erreicht aber wegen zweier bestehender,
nicht von Loop A berührten TypeScript-Fehler in `src/renderables/Code.test.ts:1457` und `:1479` nicht den Testlauf:
`"requestPartialRender" is not assignable to keyof CodeRenderable`. `bun run test:dist` ohne `--skip-build` scheitert
vor den Dist-Tests, weil lokal kein kompatibles `zig` im `PATH` liegt; der zuvor separat erfolgreiche `build:lib` plus
der gepackte Dist-Test mit `--skip-build` trennt diesen Umgebungsblocker von Loop A.

Die drei geänderten Dateien wurden mit `oxfmt` formatiert. Das strenge gepaarte TTFMF-Go-Gate bleibt bewusst im
Integrationsloop.

Empfohlene Integrationsreihenfolge: `e440c0fc` → `6f7cb23b` → portabler Test-/Berichts-Ergänzungscommit. Es existiert
kein A2/B4-Runtimecommit.
