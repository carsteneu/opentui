# Wave 2 Loop D: Handoff und Readiness-Messbericht

Stand: 2026-08-17

## Übergabe nach §9

- Loop: D – B6 UI-first/Ready-Stufen
- Branch / Worktree: `yesloop/wave2-ui-ready` / `.worktrees/wave2-ui-ready`
- Basis-Commit: `bf23ea84c0a` (Runtime-Basis laut Plan: `f33c801981fe45a58bd688575427bbffddf7daa0`)
- Runtime-Head: `6693c47ae161f476d46b94a1d761e99f9673977e`
- Status: GREEN
- Öffentlicher Export: absichtlich nicht geändert; `createRendererReady` muss der Integrator mit Loop B exportieren.

Commits in Reihenfolge:

1. `277fe881` – First-frame-/Ready-Helper und Grundtests
2. `9deeea86` – UI-first-Referenzfixture
3. `8c130086` – definierter Deferred-Reject-Pfad
4. `ea783bd8` – Listener nach Application-ready entfernen
5. `75ce10a0` – Renderfehler auf die Pre-first-frame-Phase begrenzen
6. `83152416` – frühen Renderfehler im State sichtbar machen
7. `6693c47a` – strikte Stufenreihenfolge und zusätzliche Destroy-/Monotonietests

Geänderte Runtime-/Testdateien:

- `packages/core/src/renderer-ready.ts`
- `packages/core/src/tests/renderer.ready.test.ts`
- `packages/core/src/tests/renderer.ready.fixture.test.ts`
- `packages/core/src/tests/fixtures/ready-ui-fixture.ts`

Nicht geändert wurden `renderer.ts`, FFI/`zig.ts`, Package-Exports, Parser-Worker-Assetpolicy und OpenCode-Code. Der Helper
liegt additiv über den bestehenden Events `FRAME`, `RENDER_ERROR` und `DESTROY`; es wurde keine zweite Renderer-
Lifecycle-State-Machine eingeführt.

## RED/GREEN und Semantik-Audit

Der Review-Test `application ready is consumer-marked and resolves only after base frame and enhanced settle` war vor
`6693c47a` RED: Nach `markApplicationReady()` löste `applicationReady` bereits beim ersten Frame auf, obwohl
`enhancedSettled` noch offen war (`Expected false, Received true`). Der Fix hält nun verbindlich diese monotone Ordnung
ein:

1. Core ready;
2. erster erfolgreicher Frame-Commit;
3. Enhanced settled (`ok` oder kontrolliert `failed`);
4. Application ready.

Wiederholte oder widersprüchliche Marker ändern einen bereits festgelegten Zustand nicht. Ein früher Renderfehler oder
Destroy vor dem Basisframe verwirft alle offenen Waiter definiert. Destroy zwischen Basisframe und Enhanced lässt den
erfolgreichen Basisframe stehen, verwirft aber Enhanced/Application. Nach Application-ready sind alle drei vom Helper
installierten Listener entfernt. Der Helper enthält weder `setTimeout` noch `setInterval` oder Polling.

Ausgeführte Prüfungen:

```text
cd packages/core
bun test src/tests/renderer.ready.test.ts src/tests/renderer.ready.fixture.test.ts
=> 14 pass, 0 fail, 62 expect()

bun run test:js
=> vollständiger Bun-Lauf abgeschlossen; die 12 Readiness-Unit-Tests waren grün

bun run build:lib
=> exit 0; Node- und Bun-Bundles, Deklarationen, Worker und Assets gebaut

bunx oxfmt --check \
  packages/core/src/renderer-ready.ts \
  packages/core/src/tests/renderer.ready.test.ts \
  packages/core/src/tests/renderer.ready.fixture.test.ts \
  packages/core/src/tests/fixtures/ready-ui-fixture.ts \
  .yesmem/bench/wave2-loop-d/measure-ready.ts
=> alle Dateien formatiert
```

Node-/Dist-Prüfung in dieser Umgebung:

```text
PATH=home/user/.nvm/versions/node/v26.4.0/bin:$PATH NODE_OPTIONS= bun run test:js:node
PATH=home/user/.nvm/versions/node/v26.4.0/bin:$PATH NODE_OPTIONS= bun run test:dist --skip-build
```

Beide Befehle stoppen vor dem eigentlichen Testlauf in `scripts/node26.mjs`: Der direkte
`home/user/.nvm/versions/node/v26.4.0/bin/node --version`-Aufruf meldet korrekt `v26.4.0`, aber Buns
`spawnSync("node", ...)` liefert in dieser Session leeres stdout. Das ist ein reproduzierter Umgebungsblocker, kein
Readiness-Testfehler. `--skip-build` vermeidet dabei bewusst den bekannten lokalen Zig-0.15.2/benötigt-0.16-Blocker.

## Reproduzierbare Messung

Skript: `measure-ready.ts`

Rohdaten: `raw-2026-08-17.json`

- Rohdaten-SHA-256: `a36b5d689940b8e050a7fce11085dfab18b7986e49120135976dc405c875520e`
- Messskript-SHA-256: `a495842ac2593c162fb160e1bdd8b2e4b0bb9a082a88d94050a9a0560981cd69`
- Source-Commit bei der Messung: `6693c47ae161f476d46b94a1d761e99f9673977e`
- Bun: `1.3.14`
- Native-Artefakt: private, nicht versionierte Kopie unter
  `packages/core/.yesmem/native-assets/@opentui/core-linux-x64/libopentui.so`
- Native-SHA-256: `e7e9764462f2ee7f2c808856b60101ff659c6bda4a1df7cf235e418cf481a15c`
- Herkunft: im Worktree bereitgestellte Kopie des in Wave 1 verifizierten aktuellen Artefakts; Hash ist in §2.3 des
  Wave-2-Plans festgeschrieben. Die `.so` wird nicht committed.

Reproduktion aus dem Worktree-Root:

```bash
OTUI_ASSET_ROOT="$PWD/packages/core/.yesmem/native-assets" \
OTUI_NATIVE_ORIGIN="private per-worktree copy of the Wave-1 verified current native artifact; expected hash fixed by plan section 2.3" \
bun .yesmem/bench/wave2-loop-d/measure-ready.ts \
  --samples=30 \
  --output=.yesmem/bench/wave2-loop-d/raw-2026-08-17.json
```

Das Skript verweigert unbekannte Native-Artefakte. Der Median für gerade Stichproben ist der Mittelwert der beiden
mittleren sortierten Werte; p95 verwendet den Nearest-Rank-Wert. Jede folgende Zeile hat 30 Samples:

| Pfad                                | p50 (ms) | p95 (ms) |
| ----------------------------------- | -------: | -------: |
| Kontroll-Render ohne Ready-Helper   |    0,543 |    1,663 |
| Render mit Ready-Helper             |    0,496 |    0,849 |
| Fast optional: First frame          |    0,515 |    1,597 |
| Fast optional: Enhanced nach Frame  |    0,111 |    4,072 |
| Fast optional: Application gesamt   |    0,660 |    4,594 |
| Slow 25 ms: First frame             |    0,509 |    2,635 |
| Slow 25 ms: Enhanced nach Frame     |   32,392 |   40,731 |
| Slow 25 ms: Application gesamt      |   33,098 |   41,294 |
| Kontrollfehler: First frame         |    0,473 |    2,669 |
| Kontrollfehler: Enhanced nach Frame |    0,134 |    3,614 |
| Kontrollfehler: Application gesamt  |    0,756 |    7,655 |

Die optionale Arbeit beginnt in der Probe erst nach dem Basisframe. Deshalb liegt die First-frame-Verteilung in allen
drei Szenarien weiterhin im gleichen Sub-Millisekundenbereich; die absichtlich injizierten 25 ms erscheinen erst in
Enhanced/Application. Der Cleanup-Audit zeigt vor Frame, nach Frame und nach Application jeweils Listener-Delta
`FRAME=0`, `RENDER_ERROR=0`, `DESTROY=0`; die unterstützte Active-Handle-Probe war vor und nach dem Audit leer. Der
Source-Audit zählt null Timer-/Interval-Aufrufe im Helper.

Dies ist eine alternierende, aufgewärmte In-Process-Charakterisierung des kleinen Helpers, keine Cold-Process-Messung
und kein Wave-2-TTFMF-Gate. Insbesondere wird aus dem niedrigeren gemessenen Helper-p50 kein Performancegewinn
abgeleitet. Ein belastbarer Performancegewinn darf erst aus dem geplanten gepaarten Integration-A/B mit mindestens 30
Cold-Samples berichtet werden.

## API-/Ownership-Invarianten und offene Risiken

- Alle Milestones sind monoton und settlen höchstens einmal.
- Enhanced-Fehlschlag ist kontrolliert und macht einen sichtbaren Basisframe nicht rückgängig.
- Application-ready wartet auf Basisframe und Enhanced-settled.
- Pre-first-frame Renderfehler und Destroy beenden alle offenen Waiter definiert.
- Post-first-frame Renderfehler werden nicht fälschlich zur Startup-Lifecycle-Policy.
- Listener werden auf Erfolg, Fehler und Destroy entfernt; der Helper besitzt keine Timer oder Native-Handles.
- Öffentlicher Export und Source-/Dist-Vertrag müssen in der Integration mit Loop B ergänzt und dort unter Bun/Node
  geprüft werden.
- Die Node-/Dist-Abnahme muss in einer Session wiederholt werden, in der Buns `spawnSync` Node 26 stdout korrekt erhält.
- Die Messung bewertet nicht Cold-Import oder TTFMF und darf nicht als Erreichen des Wave-2-30-%-Gates verwendet werden.

Empfohlene Integrationsreihenfolge bleibt A1 → B → C → D. Für D sind die sieben Runtime-/Testcommits in obiger
Reihenfolge und anschließend dieser versionierte Mess-/Handoff-Nachweis zu übernehmen.
