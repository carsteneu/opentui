# Wave 2 – Loop B: granulare Entry-Points

Stand: 2026-08-17

## Übergabe nach §9

Loop: B – B1/B2 granulare Entry-Points

Branch / Worktree: `yesloop/wave2-entrypoints` / `.worktrees/wave2-entrypoints`

Basis-Commit / Implementierungsstand vor diesem Bericht:
`bf23ea84af4b8b1afa82e1930c05d3ab8fb88dff` / `1d84007bade83fa1023dd8f8077f7226df9ec0af`.
Der finale Übergabe-Head ist der Commit, der diesen Bericht und den CommonJS-/Format-Fix enthält.

Status: **BLOCKIERT für das vollständige B1-Ziel; Teilziel `./renderable` GREEN, B2-Subpaths GREEN.**

### Commits in Reihenfolge

1. `a9de408e0e674d92f6ad61f9dbf023b84a45a66d` – granulare Entry-Points, Build-, Dist- und Graph-Tests
2. `1d84007bade83fa1023dd8f8077f7226df9ec0af` – Reviewkorrekturen
3. der Commit dieses Berichts – Formatierung und expliziter CommonJS-Vertrag der sechs Subpaths

### Geänderte Dateien

- `packages/core/package.json`
- `packages/core/scripts/bench-cold-import.ts`
- `packages/core/scripts/build.ts`
- `packages/core/scripts/dist-test.ts`
- `packages/core/src/{renderer,renderable,audio,image,markdown-tree-sitter,console}-entry.ts`
- `packages/core/src/tests/package-entrypoints.test.ts`
- `packages/core/src/tests/entrypoint-import-graph.test.ts`
- `packages/core/src/tests/__snapshots__/root-export-surface.json`
- dieser Bericht

Nicht geändert wurden `zig.ts`, die FFI-Ladepolicy, `runtime-assets.*`, der Renderer-Lifecycle und die Ready-Semantik.

### RED und GREEN

Der RED-Zustand bestand aus nicht auflösbaren Package-Subpaths, fehlenden Dist-Exports und fehlenden Source-/Dist-
Graph-Gates. Der implementierte Stand stellt sechs additive Subpaths bereit:

- `./renderer`
- `./renderable`
- `./audio`
- `./image`
- `./markdown-tree-sitter`
- `./console`

Fokussierter Lauf:

```text
bun test src/tests/package-entrypoints.test.ts src/tests/entrypoint-import-graph.test.ts
8 pass, 0 fail, 83 assertions
```

Build und gepackter Dist-Lauf wurden vor der Auditkorrektur erfolgreich ausgeführt:

```text
bun run build:lib
exit 0

bun run test:dist --skip-build   # mit Node v26.4.0 im PATH
Node ESM smoke: pass
Node CommonJS contract smoke: pass
Bun smoke: 1 pass, 0 fail
```

Der CommonJS-Smoke schreibt nun für alle sechs neuen Subpaths das bestehende import-only-Verhalten fest:
`require()` endet deterministisch mit `ERR_PACKAGE_PATH_NOT_EXPORTED`; es wird keine neue CJS-Buildarchitektur
behauptet oder eingeführt. ESM und Bun importieren alle sechs Subpaths aus dem gepackten Artefakt.

Nach der Auditkorrektur liefen der fokussierte Test erneut mit `8 pass, 0 fail`, `bun run build:lib` mit Exit 0 und
ein direkter Node-v26.4.0-Test gegen `dist/package.json` für alle sechs CommonJS-Subpaths erfolgreich. Der erneute
komplette `dist-test.ts --skip-build`-Start war in der eingeschränkten Sandbox nicht möglich, weil dort bereits die
interne `spawnSync`-Selbstprüfung von Node 26 mit `EPERM` scheitert. Ein früherer Lauf desselben gepackten Dist-Tests
außerhalb dieser Einschränkung ist mit Node-ESM-, Node-CommonJS- und Bun-Smokes als PASS protokolliert. Der Integrator
muss den vollständigen Lauf nach dem Cherry-pick in seiner ausführbaren Umgebung wiederholen.

`bun run test:js` lief nach Bereitstellung einer kompatiblen Native-Testbasis mit `5502 pass, 0 fail`. Ein
`test:js:node`-Lauf blieb an bereits vorhandenen TypeScript-Testzugriffen auf die private
`CodeRenderable.requestPartialRender`-Methode hängen und ist daher für diesen Branch nicht als GREEN ausgewiesen.

### Native-Artefakt

Loop B ändert und bindet keine Native-Symbole. Frühere breite Testläufe mit der veröffentlichten
`libopentui.so` schlugen wegen des fehlenden Symbols `renderRetained` fehl; das ist kein Loop-B-Codefehler, aber ohne
die in §2.3 festgeschriebene Native-Testbasis kein gültiges Full-Suite-Ergebnis. Für die fokussierten Importgraph- und
Buildtests wird kein Native-Handle erzeugt. Ein verifizierbarer Pfad/Hash wurde in der ursprünglichen Übergabe nicht
versioniert und wird hier deshalb nicht nachträglich behauptet.

### Messung

Die vorhandenen versionierten/untracked Rohdaten enthalten nur eine Vorhermessung auf `bf23ea84` und keine
vergleichbare Nachhermessung des Loop-B-Heads. Loop B beansprucht daher keinen eigenständigen Laufzeitgewinn. Die
abschließende A/B-Messung gehört in den Integrationsloop. Die Graphreduktion ist funktional belegt, nicht als
Zeitgewinn ausgegeben.

### API- und Ownership-Invarianten

- Die Root-Exportoberfläche ist durch Snapshot unverändert.
- Alle Entry-Dateien sind reine Re-Exports bestehender Implementierungen; Policy, State und Klassen wurden nicht
  kopiert.
- `./renderable` lädt laut Source-Bundle und Bun-/Node-Dist-Closure keine Audio-, Image-, Markdown-, Tree-sitter-,
  Worker- oder Console-Implementierung.
- Die optionalen Subpaths exportieren ihre jeweils vorgesehenen vorhandenen APIs.
- Es wurde kein globales `sideEffects: false` gesetzt.

### Offener B1-Blocker

`./renderer` erfüllt den vollständigen Lean-Vertrag aus §5.1/§5.4 noch nicht. `renderer.ts` importiert weiterhin
statisch `TerminalConsole` und `destroyTreeSitterClient`; der Importgraph-Test weist diese beiden Marker ehrlich als
vorhanden aus. Die Aussage, `./renderer` vermeide Console und Tree-sitter vollständig, ist für diesen Commitstand
falsch. Assertions dürfen das nicht kaschieren.

Die Korrektur benötigt einen separaten Architekturauftrag: Console-Overlay und Tree-sitter-Teardown müssen hinter
bestehende optionale/lazy Seams verschoben werden, ohne Lifecycle-, Listener- oder Worker-Ownership zu duplizieren.
Das liegt außerhalb dieses kleinen Loop-B-Übergabefixes.

### Integrationshinweis

Loop D führt `createRendererReady` ein. Da die Datei auf diesem parallelen Branch nicht existiert, bleibt deren
öffentlicher Export bewusst Aufgabe des Integrators: nach Loop D über `@opentui/core/renderer` re-exportieren und in
Source-, Deklarations- und gepackten Bun-/Node-Smokes prüfen.

Empfohlene Reihenfolge: `a9de408e` → `1d84007b` → Ergänzungscommit dieses Berichts. Der Branch ist nur für die B2-
Subpaths und `./renderable` GREEN; `./renderer` wird erst nach dem genannten Architekturfix als vollständiges B1
abgenommen.
