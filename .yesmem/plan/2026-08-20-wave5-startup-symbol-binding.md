# Wave-5: Startup-Symbol-Binding (Hebel 1 — gestaffelte FFI-Bindung)

Datum: 2026-08-20 · Status: GEPLANT · Basis: fastpatch HEAD (post-Wave-4, 7180050f+)

## 1. Ziel

TTFMF (time-to-first-native-frame) dramatisch senken durch gestaffelte Symbol-Bindung in
`zig.ts`: Beim `resolveRenderLib()` nur die Symbole binden, die Konstruktion + erster Frame
wirklich brauchen (CORE-Gruppe); die restlichen Symbole deferred binden (Proxy-Fallback bei
Bedarf + Hintergrund-Vollbindung nach erstem Commit).

Primärziel (Probe-Pfad, kalt): TTFMF p50 ≤ 90 ms (aktuell ~168–175 ms; −45 bis −50 %).
Floor-Gate (Startup-Gate, gepaart): TTFMF p50 ≤ −25 % mit CI, das die 0 ausschließt.
Nicht-Ziel: Import-Block (~43 ms, Hebel 2, eigene Folge-Welle); R-02-Formalzertifizierung
(bleibt an Load-Fenster gebunden).

## 2. Evidenzbasis (gemessen 2026-08-20, /tmp/opencode/startup-breakdown3.ts, 4 Kaltläufe)

| Phase | ms | Anteil |
|---|---|---|
| import renderer-entry | ~43 | 25 % |
| dlopen + 395-Symbol-Wrapper | ~110–114 | 65 % |
| Renderer-Ctor (Lib geladen) | ~5 | 3 % |
| erster Frame | ~4–5 | 3 % |

Skalierungsbeweis (dlopen-micro/scale, gleiche Lib, varying Tabellengröße):
1 Symbol = 1,7 ms · 50 = 16,1 ms · 200 = 57,2 ms · 395 = 102,5 ms ⇒ ~0,27 ms/Symbol,
linear in der Wrapper-Generierung (bun:ffi), NICHT im Lib-Laden (Roh-dlopen 2 ms) und
NICHT in der Dateigröße (stripped 5,5 MB statt 21 MB: keine Änderung).
Wave-2-Artefakt (Learning 85373): „lean binding groups" wurde als NO-OP dokumentiert, weil
unbeweisbar — heute bewiesen: der Effekt existiert und ist der dominante TTFMF-Block.

Kaltmess-Probe für die Abnahme (in Repo übernehmen): scripts/wave5-startup-breakdown.ts
(import/zigImport/coreBind/deferredBind/ctor/firstFrame-Zerlegung, 1 Prozess pro Lauf).

## 3. Design

### 3.1 Symbol-Tabellen-Split (nur zig.ts, kein Zig-ABI-Change)

Die Deskriptor-Tabelle in `getOpenTUILib()` (zig.ts:289 ff., 395 Einträge) wird in Gruppen
zerlegt — Deskriptoren bleiben byte-identisch, nur Gruppierung:

- **CORE** (~30–60 Symbole, empirisch per Trace bestimmt, §4 M1): alles was
  FFIRenderLib-Ctor braucht (setLogCallback, createEventSink, ICC-Retain, …) plus
  First-Frame-Pfad (Renderable-Create/Attach, Buffer-Create/Append, renderFrame,
  Committed-Reads, Destroy).
- **DEFERRED-Gruppen** nach Subsystem (textbuffer-tail, events/sinks, audio, image,
  clipboard, yoga-callbacks, span-feed, …) — nur Organisation, keine Descriptor-Änderung.

### 3.2 Bindungs-Strategie

1. `getOpenTUILib()` dlopent NUR die CORE-Tabelle (erwartet ~10–16 ms statt 102 ms).
2. `FFIRenderLib.opentui.symbols` wird durch einen **stabilen Proxy** ersetzt:
   - CORE-Symbole liegen nach dem ersten dlopen bereit (kein Trap-Miss im Hot Path).
   - Trap-Miss auf ein DEFERRED-Symbol ⇒ Einzel-/Gruppen-Bindung via erneuten dlopen
     gleicher Path+Eintrag, Ergebnis gecacht (bun cachet das OS-dlopen; inkrementeller
     Cost nur für NEUE Symbole — messtechnisch belegt, §2).
   - Selbstheilend: kein Symbol kann „fehlen", schlimmstenfalls zahlt ein First-Call die
     Bindung (~0,3 ms) — Korrektheit bleibt garantiert.
3. **Hintergrund-Vollbindung**: nach erstem成功的 native Commit (renderer-Hook nach
   `mark("opentui.firstFrame")`-Äquivalent oder `requestIdleCallback`-Fallback) wird die
   Resttabelle gebunden; danach ist der Proxy pass-through (kein Trap mehr, Hot Path
   wieder direkt — via Flag-Swap auf das echte symbols-Objekt).
4. `mark("opentui.nativeLoaded")`-Telemetrie wird um `opentui.coreBound` /
   `opentui.fullBound` ergänzt (opt-in, kein Root-Export-Leak — Invariante aus
   Renderable.ts-Wiki beachten).

### 3.3 Nicht-Ändern

- Keine Zig-Änderungen (reine JS-Bindungsreihenfolge) ⇒ Native-SHA unverändert pro Arm.
- Keine RenderLib-Interface-Änderung; alle Konsumenten (renderer.ts, text-buffer.ts,
  edit-buffer.ts, NativeSpanFeed.ts, Renderables) bleiben unberührt.
- Node-Pfad: in M1 verifizieren, welche Laufzeit test:js:node nutzt; falls eigenes
  Binding, dort eager lassen (Node-Start ist nicht Ziel dieser Welle) und nur
  dokumentieren — Portabilitäts-Invariante (bun/node-Intersection) nicht brechen.

## 4. Meilensteine (TDD, ein Loop)

### M1 — Trace & CORE-Definition (Analysis, kommuniert als Evidence)
- Instrumentierter Kaltstart (Proxy, der Symbol-Zugriffe bis zum ersten Commit loggt) über
  den Startup-Probe-Pfad (renderer-entry + createTestRenderer + TextRenderable + renderOnce).
- Output: `packages/core/.yesmem/bench/wave5-core-symbols.txt` + Trace-JSON (committed).
- CORE = Ctor-Symbole ∪ First-Frame-Symbole (Trace), plus defensive Puffer für
  ScrollBox-/Partial-Pfad des ersten Frames.
- RED-Test #1 (neu `src/tests/zig-symbol-binding.test.ts`): Assert CORE-Tabelle ⊇
  Trace-Symbolmenge (Fixture gegen committed Trace) — fällt zuerst, weil es die CORE-Liste
  noch nicht gibt.

### M2 — Implementierung Split + Proxy + Hintergrund-Vollbindung
- GRÜN-Test #1; zusätzliche Tests:
  - #2 Trap-Miss bindet DEFERRED-Symbol korrekt (Aufruf Ergebnis identisch zum eager Bind).
  - #3 Nach Vollbindung ist Proxy pass-through (Flag-Swap beweisbar via
    Object-Identity-Check im Test).
  - #4 dispose/destroy verhält sich unverändert (Lifecycle-Invariante).
- Lokale Gates: fokussierte Suite + `bun run test:js` voll (die Native-Suiten laufen
  automatisch durch den neuen Pfad — größte Absicherung).

### M3 — Messung & Abnahme
- Startup-Breakdown-Probe (neu in scripts/): coreBind ≤ 20 ms, TTFMF p50 ≤ 90 ms (kalt,
  5 Prozesse).
- Startup-Gate A/B (Baseline fastpatch pre-Wave-5 vs. Kandidat): TTFMF p50 paired ≤ −25 %,
  CI ohne 0; Import-Budgets ≤ +3 % unverändert.
- CPU-Gate n=10 (Streaming-Szenarien): kein Rückschritt außerhalb Budgets (Proxy-Kosten
  im Hot Path prüfen — nach Vollbindung pass-through, daher erwartbar ~0).
- `bun run test:js` + `test:dist` + fmt/lint grün; tsc-noEmit für node-test.
- Report `.yesmem/wave5-startup-binding-results.md` + Ledger §11.4 + ggf. R-02-Update.

## 5. Abnahme / Gates Übersicht

| Gate | Kriterium |
|---|---|
| CORE-Bindungskosten (Probe) | ≤ 20 ms kalt (aktuell 102 ms für 395) |
| TTFMF Probe p50 | ≤ 90 ms (−~50 %) |
| Startup-Gate paired TTFMF p50 | ≤ −25 %, CI schließt 0 aus |
| Startup-Gate Import p50/p95 | ≤ +3 % (Budget unverändert) |
| CPU-Gate | innerhalb Budgets (kein Proxy-Regress) |
| test:js / test:dist / fmt / lint | grün |

## 6. Risiken & Gegenmaßnahmen

- **Proxy im Hot Path**: nach Vollbindung Flag-Swap auf direktes symbols-Objekt (Test #3);
  CPU-Gate überwacht. Vor Vollbindung zahlen nur nicht-CORE-Aufrufe einen Trap (~ns).
- **Verschenktes CORE-Symbol** (Segfault-artige Überraschung unmöglich gemacht durch
  Selbstheilungs-Proxy; Worst Case +0,3 ms beim First-Call).
- **Reentrancy**: Bindung passiert JS-seitig vor dem Call, nicht in nativen Callbacks.
- **Worker/Threads**: render-thread nutzt resolveRenderLib im selben Prozess — Proxy ist
  Single-Lib-Singleton, Thread-safety durch JS-Single-Thread des Bindungspfads gegeben;
  in M2 einmalig per renderThread-Smoke verifizieren.
- **Node-Laufzeit**: nur betroffen falls getOpenTUILib geteilt — M1 klärt; sonst eager.

## 7. Loop-Topologie & Worktree

- **Ein Loop** (ein Seam, zig.ts + Tests + Probe-Script): Worktree
  `.worktrees/wave5-startup-binding`, Branch `yesloop/wave5-startup-binding`, abgespalten
  von fastpatch HEAD (7180050f-Basis; exaktes SHA beim Abspalten vom Koordinator fixieren).
- Build-Hinweis im Briefing: zig 0.16.0-PATH (nur falls native neu gebaut wird — für diese
  Welle nicht nötig, JS-only).
- Merge & Ledger & formale Verifikation: Koordinator (wie Wave-4-Muster).
- Optional parallel (disjunkt, nur bei Bedarf): E1-O(N)-JS-Scan im culled Pfad
  (Renderable.ts) als zweiter Loop — NICHT Teil dieses Plans, separater Auftrag.

## 8. Evidenz-Vertrag

Alle Artefakte unter `packages/core/.yesmem/bench/wave5-*` mit Provenanz (Commit,
Native-SHA, Bun-Version, Load), committed; Rohdaten ungeschönt; INVALIDATION bei
Kontamination (Last > 4 zum Messzeitpunkt ⇒ als UNCLEAR markieren, nicht als PASS).

## 9. Eskalation an Koordinator

- CORE-Set > 120 Symbole (dann stimmt die Kostenannahme nicht mehr).
- Proxy-Kosten im CPU-Gate sichtbar (> +3 % Mainthread).
- Node-Pfad brechen würde (dann Node eager lassen und nur Bun-Split ausliefern).
