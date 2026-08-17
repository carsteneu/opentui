# Loop C — B5: Parser-Worker-/Asset-Auflösung (NO-OP mit Beleg)

Loop: C (B5 — Parser-Worker-/Asset-Auflösung)
Branch / Worktree: `yesloop/wave2-parser-assets` / `.worktrees/wave2-parser-assets`
Basis-Commit: `bf23ea84`
Head-Commit: gezielter Fix-Commit dieses Reports; finale SHA steht in der Integrationsübergabe
Status: **NO-OP-MIT-BELEG**

## Auftrag und Befund

`runtime-assets.bun.ts` löst den gebündelten `parser.worker`-Pfad im Modulscope per
Top-Level-`await import("@opentui/core/parser.worker", { with: { type: "file" } })` auf (Zeile 14–20).
Zu verifizieren war: (a) wird der Worker dabei **ausgeführt** oder nur als Asset aufgelöst, und (b) wie groß
ist der Anteil dieser Auflösung am Import-/First-Frame-Pfad. Unter 2 % des Root-Imports und ohne
First-Frame-Einfluss → laut Plan §6.3 **keine Runtime-Änderung**.

## (a) Worker wird auf dem Main Thread NICHT ausgeführt — verifiziert

Empirischer Probe-Test mit einem Marker-Modul unter Bun 1.3.14:
`import(mod, { with: { type: "file" } })` gibt als `default` nur den **Pfad-String** zurück und
**führt den Modul-Body nicht aus** (Seiteneffekt-/Zähler-Marker des importierten Moduls blieb unausgelöst).
Der eager Modulscope-Import berechnet also ausschließlich einen Pfad-String; der Worker-Thread und der
Tree-sitter/WASM-Start bleiben vollständig lazy (`resolveWorkerPath()` → `startWorker()` → `initialize()`
in `client.ts:239/252`, erst bei echtem Tree-sitter-Bedarf). Damit ist der bekannte Befund aus der Analyse
bestätigt — nicht nur vermutet.

## Messung (C1) — 30 gepaarte Cold-Samples, Bun 1.3.14

`bun scripts/measure-parser-worker.ts 30`, Parent spawnet je Sample einen frischen `bun`-Subprozess,
Szenarien pro Sample im Round-Robin (gepaart gegen Drift). Warm-up getrennt (3). Median/p95 aus 30 Samples.

| Szenario                                 | median (ms) | p95 (ms) | min (ms) | max (ms) |
| ---------------------------------------- | ----------: | -------: | -------: | -------: |
| worker-resolve (eager Op isoliert)       |       0.664 |    2.290 |    0.410 |    4.991 |
| runtime-assets (Modul-Eval inkl. Worker) |      64.490 |  110.746 |   24.300 |  113.823 |
| root (`@opentui/core` Import)            |     302.319 |  551.961 |  139.320 |  611.227 |

**Anteil worker-resolve / root (Median): 0,220 %**; selbst im p95 nur ~0,4 % (2,29 / 551,96).
Weit unter der 2-%-Schwelle.

Rohdaten: `packages/core/scripts/measure-data/parser-worker-raw.json` (30×3 ns-Samples).
Skript: `packages/core/scripts/measure-parser-worker.ts`.
Probe (reproduzierbar): `bun scripts/measure-parser-worker.ts --verify-executed` → PASS. Ein eigener
Regressionstest belegt außerdem, dass ein nicht startbarer Probe-Child nicht als PASS durchrutscht:
`BUN_PATH=/bin/false bun scripts/measure-parser-worker.ts --verify-executed` → Exit 1.

Worst-Case-Einordnung: Auch die ungünstigste Paarung (worker-p95 2.29 ms gegen den schnellsten Root-Import
139 ms) bliebe bei ~1,6 % und damit unter der 2-%-Schwelle; der Median-Anteil (0,220 %) ist ungefähr neunmal
kleiner als das Gate.

## Weitere C1-Punkte

- **Runtime-assets-Eval (64,5 ms Median)**: dominiert vom statischen Importgraph-Transpile (string-width,
  strip-ansi, node-asset-target, assets, runtime + Bun-Start), der von der worker-Auflösung unabhängig ist.
  Der isolierte worker-resolve-Anteil daran ist ~1 %.
- **Node-Verhalten**: `runtime-assets.node.ts` enthält **keinen** Modulscope-`await`/Import — die
  Workerpfad-Auflösung dort ist bereits synchron und lazy (`resolveDefaultTreeSitterWorkerPath`, nur bei Bedarf).
  Node ist von der eager-Auflösung **nicht** betroffen; Bun und Node bleiben semantisch gleich.
- **First-Frame-Einfluss**: Der Workerpfad wird ausschließlich in `startWorker()`/`initialize()` konsumiert.
  Der Worker selbst läuft nicht im Import-/Erstcommit-Pfad; die eager Pfadauflösung liegt mit rund 0,7 ms im
  Importpfad, aber deutlich unter dem Priorisierungsgate.
- **Lean-Renderer-Import (Loop B)**: Loop B war während C1 noch nicht integriert. Da Loop C keine Runtime-Datei
  ändert, bleibt die kombinierte Lean-Closure-Prüfung gemäß Plan §8 ein Integrationsgate nach B+C.

## Entscheidung

**0,22 % < 2 % und keine Worker-Ausführung im First-Frame-Pfad → keine Runtime-Änderung. NO-OP.**

C2 (lazy Auflösung) wird **nicht** implementiert: Die Auflösung ist messbar vernachlässigbar, und das Erkaufen
einer Lazy-Änderung brächte keinen messbaren Import-/TTFMF-Gewinn, aber zusätzliche Ownership-/Parity-Risiken.

## Beobachteter Hinweis (außerhalb des Änderungsumfangs, für den Integrator)

Auf **Bun** ist der eager Modulscope-`await import(..., {type:"file"})` in `runtime.ts` `resolveBundledFilePath`
**nicht** try/catch-gekapselt (Zeile 74–79). Würde das Worker-Asset fehlen, könnte der Bun-Root-Import werfen
und den sichtbaren Basisrenderer gefährden — Node ist davon wegen des lazy/seam-Pfads nicht betroffen. Da das
2 %-Gate keinen Eingriff verlangt und das Asset im normalen Build immer vorhanden ist, bleibt dies ein
dokumentierter Robustheits-Risikopunkt, **kein** aktiver Fehlerpfad. Ein späterer Härtungsvorschlag
(Robustheit, nicht Performance) kann den `loadBundledFile()`-Aufruf im Worker-Zweig absichern.

## Verifikation

- Regressionstest:
  `bun test scripts/measure-parser-worker.test.ts`
  → 2 pass, 0 fail, exit 0 (False-PASS-Child und Median bei gerader Samplezahl).
- Reale No-exec-Probe:
  `bun scripts/measure-parser-worker.ts --verify-executed`
  → PASS, exit 0; der Default-Export ist ein nicht leerer absoluter Pfad-String und der Modulbody lief nicht.
- Negativprobe:
  `BUN_PATH=/bin/false bun scripts/measure-parser-worker.ts --verify-executed`
  → erwarteter Fehler `probe child failed`, exit 1.
- Fokussierte Assettests (kein `OTUI_ASSET_ROOT`):
  `bun test src/platform/runtime.test.ts src/node-assets.test.ts src/lib/tree-sitter/client.test.ts`
  → 69 pass, 0 fail (479 expects), exit 0. (Vorher, ohne `build:lib`-Artefakt, schlug `node-assets.test.ts`
  fehl, weil `dist/parser.worker.js` fehlte — baseline Build-Dependency, kein Regressionsbefund.)
- Vollständige JS-Suite:
  `bun run test:js`
  → 5494 pass, 23 skip, 0 fail, exit 0.
- `bun run build:lib` → Erfolg; `dist/parser.worker.js` (172 KB) gebaut.
- Dist-Paketprüfung mit dem vorgeschriebenen Node 26:
  `PATH=home/user/.nvm/versions/node/v26.4.0/bin:… bun run test:dist --skip-build`
  → Node ESM, Node CJS und Bun grün, exit 0. `--skip-build` verwendet das unmittelbar zuvor mit
  `build:lib` erzeugte Dist; der vollständige Build benötigt die lokal fehlende Zig-Version 0.16.
- `bun run test:js:node` mit Node 26 erreicht die Tests nicht: TypeScript meldet in
  `src/renderables/Code.test.ts:1457/1479`, dass `"requestPartialRender"` kein `keyof CodeRenderable` sei.
  Derselbe Fehler ist auf der unveränderten Runtime-Baseline `f33c8019` reproduziert und daher kein Loop-C-Befund.
- Native-Artefakt für Messung und Bun-Suite:
  `packages/core/node_modules/@opentui/core-linux-x64/libopentui.so`, SHA-256
  `e7e9764462f2ee7f2c808856b60101ff659c6bda4a1df7cf235e418cf481a15c`, aus dem gepinnten
  `@opentui/core-linux-x64`-Paket; `nm -D --defined-only` meldet 1890 Symbole.
- Da keine Runtime-/Source-Datei geändert wurde, gibt es keinen Vorher/Nachher-Gewinn; der NO-OP-Befund oben
  ist der Nachweis.

## Commits in Reihenfolge

1. `0bc9fe3e` — `perf(core): isolate parser-worker asset resolution — no-op (0.2% of root import)`
2. `9f744136` — `test(core): add reproducible no-exec probe to parser-worker measure script`
3. gezielter Fix-Commit dieses Reports — Probe-Fehlerpfad, korrekte Medianberechnung, Format und Übergabe

Keine Runtime-/Policydatei wurde geändert. Eigene versionierte Dateien sind das Messskript, dessen Regressionstest,
die Rohdaten und dieser Report.
