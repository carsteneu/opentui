# Wave 3 – Loop B: Code-Highlight-Consumer-Vertrag (C1/C4)

Stand: 2026-08-18

## Übergabe nach §9

Loop: B – C1/C4-Consumer-Vertrag für `CodeRenderable` (Konsument des Highlight-Sources-Seams)

Branch / Worktree: `yesloop/wave3-code-buffer` / `.worktrees/wave3-code-buffer`

Basis-Commit: `fccae2158d5c98949fc050913b918621af918111`
(@opentui/core@0.5.3, Linie fork: opencode-1.18.16-patched.98-Inkrement W0..W2)

Status: **GREEN für den Code-Pfad (Source-Tests, Full-`test:js`, Build, Dist-Smoke, fmt, lint).**
`test:js:node` ist **nicht** vollständig GREEN – siehe Abschnitt „test:js:node“.

## Zweck

Der Plan (§6) fasst C1/C4 als Konsumenten-Vertrag: `CodeRenderable` besitzt genau einen Highlight-Vorgang mit
monotoner Generation, verwirft veraltete (stale) Worker-Ergebnisse vor **convert** und erneut vor **commit**,
klassifiziert Edits (initial/append/fullReplace/filetypeChange) und schließt bei `destroy()` sauber ab. Der reale
Buffer-Client (Loop C) steckt später über denselben Seam ein; der Konsument ändert sich nicht.

## Neue Artefakte

- `packages/core/src/renderables/CodeHighlightSession.ts` – `CodeHighlightSession` (Kernvertrag):
  - fünf Ownership-Intents `HighlightOwner = "initial" | "append" | "fullReplace" | "filetypeChange" | "destroy"`
  - monotone `generation` via `revise(owner)`; `isCurrent(generation)` = offen UND Generation aktuell
  - `run(owner, ctx, pipeline)` = `source.highlight` → stale-check → `convert` → **stale-check → commit**
  - `close()` setzt `closed` und bumpst auf `"destroy"`; danach weder convert noch commit, keine neuen Runs an die Quelle
  - `CodeHighlightSource`-Seam (`highlight(content, filetype)`), den heute `TreeSitterClient.highlightOnce` und später der versionierte Buffer-Client von Loop C erfüllen
- `packages/core/src/renderables/CodeHighlightSession.test.ts` – 7 Contract-Unit-Tests (RED→GREEN, §6.3)
- `packages/core/src/renderables/CodeHighlightConsumer.test.ts` – 6 Consumer-/Lifecycle-Tests durch `CodeRenderable`

## Integration in `CodeRenderable` (Code.ts)

`_highlightSnapshotId` (Zähler) wurde durch `_session: CodeHighlightSession` ersetzt, Verhalten gleichwertig:

- `invalidateHighlights(owner = "fullReplace")` → `_session.revise(owner)`; alle 13 Aufrufstellen unverändert
- `set filetype` → `invalidateHighlights("filetypeChange")`
- `startHighlight`: `snapshotId = _session.generation`; Quelle via `_session.source.highlight`; die vier Stale-Checks →
  `_session.isCurrent(snapshotId)` (je vor convert, vor commit, nach transform und im catch)
- `clearPendingHighlight` → `_session.revise("fullReplace")`
- `destroy()` → `clearPendingHighlight()` + `_session.close()` + `super.destroy()`

Nicht geändert: `client.ts`, `parser.worker.ts`, `types.ts`, `tree-sitter-styled-text.ts`, Platform-Worker,
`TextBuffer`, Zig, `index.ts` (CodeHighlightSession bleibt interner Consumer-Typ).

## RED und GREEN

RED: Die Stale-Guards in `run()` wurden kurzzeitig entfernt → 5 von 7 Session-Tests schlugen fehl
(stale-before-convert, stale-before-commit, 100 same-turn, filetype-change, close). Guard wiederhergestellt → GREEN.

```text
bun test src/renderables/CodeHighlightSession.test.ts
7 pass, 0 fail, 33 Assertions
```

Consumer-/Lifecycle-Tests (§6.3): 100 same-turn → genau ein sichtbares Endergebnis (`["0","100"]`), filetype-Change →
eindeutige neue Generation, destroy→kein Commit/kein Throw, worker-error→Plain-Text-Fallback, feststehender Content so
streaming→kein Nachlauf-Highlight, final-state-Oracle-Match (keyword/string-Span-Farben).

```text
bun test src/renderables/CodeHighlightConsumer.test.ts
6 pass, 0 fail
```

## Verifikationsmatrix (§6.4)

| Gate                                                  | Ergebnis                                     |
| ----------------------------------------------------- | -------------------------------------------- |
| `bun test src/renderables/Code.test.ts`               | 76 pass, 1 skip, 0 fail                      |
| fokussiert (Code+Session+Consumer+scrollback-surface) | 101 pass, 1 skip, 0 fail                     |
| `bun run test:js` (gesamte JS-Suite)                  | **5551 pass, 23 skip, 0 fail** (200 Dateien) |
| `bun run build:lib`                                   | exit 0, TS-Deklarationen erzeugt             |
| `bun run test:dist --skip-build` (Node v26.4.0)       | 1 pass (Dist-Smoke)                          |
| `bun run fmt:check`                                   | sauber                                       |
| `bun run lint` (oxlint)                               | 0 warnings, 0 errors                         |
| `git diff --check`                                    | sauber                                       |
| `bun run test:js:node` (Node v26.4.0)                 | **nicht vollständig GREEN** (siehe unten)    |

Ausgangsbasis (vor Änderungen): `bun test src/renderables/Code.test.ts` = 76 pass, 1 skip, 0 fail – identisch zum
finalen Stand, d. h. **keine Regression** durch die Session-Integration (fable: Vorher/Nachher verglichen).

## test:js:node – vorbestehender Blocker, ehrlich ausgewiesen

`test:js:node` war **bereits am Basis-Commit rot**, noch bevor Loop B begann:

1. **tsc-Schritt (vorbestehend):** TypeScript-Testzugriffe `spyOn(codeRenderable, "requestPartialRender")`
   (Code.test.ts:1457/1479) scheiterten mit TS2345, weil diese Methode nicht im öffentlichen `keyof CodeRenderable`
   liegt (sie lebt auf dem Render-Kontext, nicht am Renderable). Der Nutzer des Wave-2-Loops-B hat denselben Blocker
   bereits dokumentiert (`.yesmem/wave2-loop-b-entrypoints-results.md`: „blieb an bereits vorhandenen
   TypeScript-Testzugriffen auf die private CodeRenderable.requestPartialRender hängen“). **Baseline-Proof:** mit
   auf Basis-Commit zurückgestellter Dateien tritt exakt derselbe TS2345 auf.
2. **Behebung (Inhalt von Loop Bs owned `Code.test.ts`):** beide Spy-Ziele typ-sicher auf
   `"requestPartialRender" as keyof CodeRenderable` gecastet (nur Typ, Laufzeit identisch; die Tests selbst wurden
   bewusst nicht umformuliert). Danach läuft der tsc-Schritt durch.
3. **Nächste, unabhängige, vorbestehende Ebene:** die nun tatsächlich ausführbaren `.node-test`-Yoga-/TextBuffer-
   Fixtures (`yoga-callback-stress`, `yoga-setters`, `text-buffer-view`, `text-buffer`) scheitern mit
   „Promise resolution is still pending but the event loop has already resolved“. Diese liegen in `TextBuffer`/`Yoga`,
   referenzieren keines meiner Artefakte (per grep belegt) und sind außerhalb der Loop-B-Ownership; sie waren wegen des
   früheren tsc-Abbruchs nie sichtbar und sind kein Loop-B-Regression.

Loop B weist `test:js:node` daher – dem Wave-2-Präzedenzfall folgend – als „nicht vollständig GREEN“ aus und überlässt
die unabhängigen .node-test-Yoga-/TextBuffer-Fehler dem Integrator/Loop mit der dazugehörigen Ownership.

## Messung

Kein eigenständiger Laufzeitgewinn beansprucht; die Änderung ist verhaltensgleich zur bestehenden
`_highlightSnapshotId`-Logik und macht den C1/C4-Generations-/Ownership-Vertrag strukturell und testbar. Die
abschließende A/B-Messung gehört in den Integrationsloop.

## Integrationshinweis

Loop C ersetzt die `CodeHighlightSource` hinter `CodeHighlightSession` (heute `highlightOnce`) durch den versionierten
Buffer-Client (`INITIALIZE_PARSER`/`HANDLE_EDITS`, siehe `types.ts`). Der Konsument (CodeRenderable) und der
Ownership-/Stale-Vertrag bleiben unverändert. Empfohlene Reihenfolge: Commit von Loop B, dann Loop-C-Einstieg in den
Seam.

## Review (Phase 5, Stage 2 – Cold Review via Subagent)

Cold-Review (frischer Subagent, task id `ses_fee2d37a0ffeN9mMSMm6QXx1Cc`): **APPROVE-WITH-NOTES**. Der Review hat die
Stale-Discard-Chronologie (kein TOCTOU), die close/destroy-Reihenfolge und die Ownership-/Scope-Grenze unabhängig
verifiziert (keine verbotenen Dateien angefasst) und die Testaussagen als nicht-vakant bestätigt.

Befunde und Disposition:

- **[SHOULD-FIX] `CodeHighlightSession.run()` und `CodeHighlightPipeline` sind heute kein Produktionspfad** –
  `CodeRenderable` zäunt dieselbe Invariante inline über `revise`/`isCurrent`/`source.highlight` selbst (Code.ts:471/
  492/525/546); zwei Implementierungen derselben Invariante koexistieren. **Disposition: bewusstes Staging**, im
  Ergebnistext und per Kommentar an `run()` dokumentiert. Der vollständige Fix (Produktion treibt `run()` mit einem
  Pipeline-Objekt, Streaming-`onChunks`-Semantik in einen Commit-Payload überführen) ist der Loop-C-Refactor am Seam
  und gehört dort hin – nicht in diesen kleinen, verhaltensgleichen Übergabe-Commit (würde das No-Regression-Kriterium
  riskieren).
- **[NIT] `snapshotId = generation` (Lesen) statt altem `++`-Bump** (Code.ts:457). Heute sicher, weil der Single-
  Flight-Guard `_highlightLoopActive` (Code.ts:741-755) nie zwei konkurrierende Läufe erlaubt; Hinweis für Loop C, wenn
  zukünftig parallelisiert wird, beim Lauf-Eintritt defensiv zu `revise`n.
- **[NIT] Code.test.ts:1457/1479-Casts sind rein typtypisch; Assertion blieb schwach, aber vorbestehend** (Spy auf
  ein nicht am Renderable liegendes `requestPartialRender`). Nicht Aufgabe dieses Commits.
