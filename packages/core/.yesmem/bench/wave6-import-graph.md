# Wave-6 M1: Import-Graph-Audit (Hebel 2 — Import-Block-Entschlackung)

Datum: 2026-08-20 · Basis: `c13f0b645` (post-Wave-5) · Worktree: `.worktrees/wave6-import-lean`
Methode: `bun build --metafile` (renderer-entry-Closure) + isolierte Kaltimports
(1 Prozess pro Lauf, je 2–6 Wiederholungen, Host-Load vorhanden → als UNCLEAR nur
ausgewiesen wo nötig). Werkzeuge: `bun v1.3.14`, `bun build --target=node --external events`.

## 1. Kernergebnis: Die im Plan genannten statischen Sünden sind im Basis bereits gefixt

Der Plan (§2) nennt als Hebel: `renderer.ts` importiere statisch `TerminalConsole`
(console-Entry-Graph) und `destroyTreeSitterClient` (tree-sitter-Client-Graph).
**Diese Annahme ist im Basis-Branch `c13f0b645` nicht mehr wahr.** Commit
`03c67c69 perf(core): detach optional renderer subsystems` (in Basis, und auch im
Coordinator-Worktree fastpatch) hat genau diese Aufgabe bereits erledigt:

- `renderer.ts:29` ist heute `import type { ConsoleOptions, TerminalConsole }` (type-only, erased)
- `destroyTreeSitterClient` kommt in `renderer.ts` gar nicht mehr vor
- Der Seam existiert: `renderer-integration.ts` (getRendererConsoleIntegration /
  getRendererLastDestroyCleanups); console- und tree-sitter-Integrationen werden
  extern registriert (`renderer-console.integration.ts`, `renderer-tree-sitter.integration.ts`)

### Verifikation (dreifach)

1. `git show 03c67c69 -- renderer.ts` zeigt die Diff-Removale:
   `-import { TerminalConsole, ... }`, `-import { destroyTreeSitterClient }`,
   `+import type { ConsoleOptions, TerminalConsole }`, `_console` → lazy `| null`.
2. `src/tests/entrypoint-import-graph.test.ts` (existiert in Basis, 4/4 grün) prüft
   exakt das Plan-RED-Test-#1-Ziel: renderer-entry-Bundle enthält NICHT
   `class TerminalConsole extends`, `destroyTreeSitterClient`, `getTreeSitterClient`,
   `class TreeSitterClient extends`, image/markdown/audio-Marker.
3. Eigene Bundle-Analyse `bun build src/renderer-entry.ts` (719 KB, 73 Module):
   keiner der Oben-Marker im Output; auch kein `node:worker_threads`, kein `webp`,
   kein `parseMarkdown`. `AudioStream`-Treffer ist nur FFI-Struct (AudioStreamCreateOptionsStruct).

→ **Der primäre Hebel des Plans ist im Basis bereits eingebaut.** Der Plan ist auf
Stand Wave-2-Loop-B geschrieben und veraltet relativ zum tatsächlichen Basisstand.

## 2. renderer-entry-Closure (73 Module, bun build --metafile)

Vollständige Liste siehe unten (§5). Zentrale Klassifikation der Top-Level-Module.

## 3. Geordnete Kaltimport-Kosten (isoliert, 1 Prozess/Lauf)

| Modul | ms (Wiederholungen) | Klassifikation | Statisch nötig? |
|---|---|---|---|
| **renderer-entry** | 61–76 (n=6) | — | Produktions-Entry |
| **renderer.ts** allein | 64–75 (n=3) | — | = Entry-Kern |
| **zig.ts** allein | 27–37 | **CTOR** (`resolveRenderLib()` im Ctor, renderer.ts:1095) | ja — Ctor nutzt lib sofort |
| **host-clipboard.native** allein | 36–38 | **CTOR/Feature** (importiert resolveRenderLib; Clipboard wird im Ctor erzeugt, renderer.ts:1270) | Ctor |
| **edit-buffer** / editor-view / text-buffer | 27–33 | **CTOR/Feature** (EditBufferRenderable → renderer.ts:37 value-import `isEditBufferRenderable`) | Ctor/Feature |
| **yoga** allein | 27–30 | **FIRST-FRAME** (Renderable layout) | erster Frame |
| **renderable-entry** (Text/Box/Renderable) | 32–38 | **FIRST-FRAME** | erster Frame |
| **extmarks** allein | 17 | CTOR/Feature (via editor-chain) | Feature |
| **console-entry** | 37–46 | LAZY (Separat-Entry) | NICHT im renderer-entry |
| **tree-sitter/client** allein | 22–25 | LAZY (Separat-Entry) | NICHT im renderer-entry |
| **stdin-parser / palette / capability / viewport / RGBA / ansi / styled-text / fonts** | 1–6 | FIRST-FRAME | erster Frame |

### Schlussfolgerung Kostenliste

- Das dominante Modul im renderer-entry-Graph ist **zig.ts (~30–37 ms)**, aber es ist
  **CTOR-klassifiziert**: der `CliRenderer`-Ctor ruft `resolveRenderLib()` synchron
  (renderer.ts:1095) und braucht `this.lib` sofort für `createRenderer`/Buffers.
  Zusätzlich value-importieren es `EditBufferRenderable`, `TextBufferRenderable`,
  `host-clipboard.native` — d.h. selbst wenn renderer.ts den value-Import abgäbe,
  bliebe zig.ts über drei weitere Pfade im Entry-Closure. → **nicht lazyfähig ohne
  Zig-Interface-Change (durch Plan §3.3 verboten).**
- Die edit-buffer/editor-view/extmarks-Kette ist über `isEditBufferRenderable`
  (renderer.ts:37, value-import) drin, aber überlappt mit zig.ts und ist
  CTOR/Feature-klassifiziert — kein eigenständiger Wurf.
- console/tree-sitter sind NICHT im Entry-Closure (bereits abgehängt).
- Alles weitere ist FIRST-FRAME (yoga, Renderable/Text/Box, stdin-parser, palette, …)
  und darf nach Planregel `FIRST-FRAME/CTOR = statisch` (Plan §3.2) nicht lazy werden.

## 4. Fazit M1

- RED-Test #1 (renderer-entry importiert NICHT console/tree-sitter) existiert bereits
  als `entrypoint-import-graph.test.ts` und ist **grün in Basis** → M1-Testziel erfüllt,
  kein neuer Test nötig (Duplikat wäre sinnlos).
- Es gibt **keine verbleibende LAZY-klassifizierbare Sünde** im renderer-entry-Graph:
  console + tree-sitter sind schon draußen; zig.ts ist CTOR (Pflichtimport mit drei
  unabhängigen Pfaden); der Rest ist FIRST-FRAME.
- Damit ist der Plan-Hebel (Import p50 ≥ −25 %) im Basis **weitgehend bereits
  gezogen**; weiterer Import-Gewinn liegt außerhalb des Plan-Erlaubnisraums
  (CTOR/FIRST-FRAME bleiben statisch; kein Zig-Change; keine neuen Entry-Brüche).
- Empfehlung an Koordinator: entweder (a) Wave-6 als "bereits erfüllt/verifizieren"
  parken (Test- und Mess-Nachweis genügen), oder (b) neues, explizites Mandat für
  CTOR-Reduktion (z. B. zig.ts-Split) — liegt außerhalb dieses Plans §3.3.

## 5. Vollständige Closure-Liste (73 Module exkl. node_modules-Standard)

```
NativeSpanFeed, Renderable, ansi, buffer, edit-buffer, editor-view,
lib/KeyHandler, lib/RGBA, lib/ascii.font, lib/border, lib/bunfs, lib/clipboard,
lib/clock, lib/env, lib/extmarks, lib/extmarks-history, lib/fonts/{block,grid,huge,
pallet,shade,slick,tiny}.json, lib/highlight-completion, lib/host-clipboard.internal,
lib/host-clipboard.native, lib/keybinding.internal, lib/objects-in-viewport,
lib/parse.keypress, lib/parse.keypress-kitty, lib/parse.mouse, lib/render-geometry,
lib/renderable.validations, lib/selection, lib/singleton, lib/stdin-parser,
lib/styled-text, lib/terminal-capability-detection, lib/terminal-palette,
lib/yoga.options, node-asset-target, platform/assets, platform/ffi,
platform/runtime-assets.node, platform/runtime, renderables/Box,
renderables/EditBufferRenderable, renderables/Text, renderables/TextBufferRenderable,
renderables/TextNode, renderables/composition/vnode, renderer-entry,
renderer-integration, renderer-ready, renderer-theme-mode, renderer, syntax-style,
telemetry, text-buffer-view, text-buffer, types, utils, yoga, zig-structs,
zig-symbol-stage, zig
```

(Hinweis: `lib/index.ts` ist NICHT im renderer-entry-Closure; `renderables/index.ts`
(Barrel) ebenfalls nicht — nur die direkt gezogenen Renderables.)
