# Upstream-Merge-Playbook (fastpatch ⟵ origin/main)

Gilt ab Stand: Wave-7 (Merge v0.5.5, Commit fd4003d0). Reihenfolge einhalten —
jeder Schritt hat einen Beweis, erst dann weiter.

## 0. Vorbedingungen

- `git fetch origin` im Hauptrepo; Scope bestimmen: `git log --oneline fastpatch..origin/main`
  und `git diff --stat fastpatch...origin/main` (welche Pakete/Dateien?).
- Merge-Base prüfen: `git merge-base fastpatch origin/main`. Unsere Wellen-Symbole
  (s. §2) waren im Merge-Base NIE vorhanden — upstream „entfernt" sie nicht, sie
  tauchen nur als Konflikt auf, weil wir sie hinzugefügt haben. NIEMALS ours/theirs
  pauschal über die Symboltabelle laufen lassen.
- Mess-Arme unangetastet lassen: keine Native-Kopien in Worktree-node_modules
  (Hardlink-Falle, s. Ledger/Gotchas — beim Merge irrelevant, aber falls parallel
  gemessen wird: rm+cp mit eigenen Inodes, nie cp auf Hardlink-Ziele).

## 1. Merge anstoßen

```bash
cd .worktrees/fastpatch
git merge origin/main   # Konflikte ERWARTET in: packages/core/src/zig.ts,
                        # packages/core/src/renderer/console.ts, package.json,
                        # .gitignore, .oxfmtrc.json — ggf. mehr
```

## 2. zig.ts — Symboltabelle (höchstes Risiko)

- `opentuiSymbolDefs` = 411 Entries (Stand v0.5.5-Merge): 395 unsere (inkl.
  `renderRetained`, `renderPartial`, `textBufferAppendStyledText`,
  `rendererHasActiveImageState`) + 16 embeddedTerminal + ptr→buffer-Deskriptoren.
- Upstream-Neuerungen übernehmen: neue Symbole ergänzen, Deskriptor-Typwechsel
  (`ptr`→`buffer`, neue Bool-Parameter wie `flushInput` bei `destroyRenderer`)
  in UNSERE Tabelle überführen. Die Staged-Binding-Struktur (CORE 78 /
  DEFERRED Rest, createStagedSymbolLibrary) bleibt unangetastet.
- **KEINE Skripte über die Tabelle laufen lassen.** Wave-7-Vorfall: ein
  Python-Lösungsskript zerstörte die Tabelle still (16 statt 411 Entries,
  durch lstrip('{') ging eine geöffnete Klammer verloren). Rettung war
  `git checkout -m <datei>` (Re-Konfliktierung) + hunks einzeln `ours`.
- Verifikation nach JEDEM Schritt (Pflicht):
  ```bash
  node -e "const t=require('./packages/core/src/zig.ts')" 2>/dev/null || true
  # robuster: Entry-Count + Dupes direkt prüfen:
  grep -c '^\s\+\w*:' packages/core/src/zig.ts   # Grobzahl
  rg -c 'embeddedTerminal' packages/core/src/zig.ts
  rg -c 'renderRetained|renderPartial|textBufferAppendStyledText|rendererHasActiveImageState' packages/core/src/zig.ts
  # und: keine Symbol-Dupes (JS-Objekt-Literal => letzter gewinnt still)
  ```

## 3. console.ts (R-07 × Upstream-Gate)

Upstream hat ein `OTUI_USE_CONSOLE`-Env-Gate, wir den Capture-Refcount für
zwei Overlay-Renderer. Kombinierte Semantik (Stand v0.5.5-Merge): Env-Gate
prüft VOR dem Zähler-Exit — Refcount entscheidet die Freigabe, das Gate kann
sie nur verhindern. Beide Testsuiten behalten (unser Strand-/Refcount-Test +
upstream Env-Gate-Test); erwartete Suite-Größe nach v0.5.5: 71.

## 4. Meta-Dateien

- `package.json` (root), `.gitignore`, `.oxfmtrc.json`: upstream-Layout
  übernehmen, ABER unsere Teile erhalten: wave3-Gate-Skripte in
  packages/core/package.json `scripts`, `.yesmem/`-Ignores.
- Versions-Schema: Workspace-Pakete tragen `0.5.6-perf.N`; die Plattform-Dep-
  Pins (`@opentui/core-linux-x64` etc. in packages/core/package.json) bleiben
  auf dem upstream-NPM-Stand gepinnt (Prerelease-Artefakte existieren nicht
  auf npm — Bump bricht Installation).
- `bun.lock`: bei reinem Merge i.d.R. unverändert; KEIN `bun install` mit
  Netz nötig, es lief schon in ein 300s-Timeout ohne Effekt.

## 5. Native-Build (Layout seit v0.5.5)

```bash
cd packages/core && bun run build:native   # Zig 0.16 nötig; liegt jetzt unter
# packages/native/ (Quellen) → packages/native/lib/x86_64-linux/libopentui.so
```
Runtime-Resolver findet die .so automatisch. Nach dem Build Symbolfamilien
verifizieren: `nm -D` auf unsere Wellen-Symbole (renderRetained etc.),
embeddedTerminal-Familie und die Kern-Render-Familie.

## 6. Verifikationskette (vollständig, in dieser Reihenfolge)

Alle Befehle ab `packages/core/` (außer test:js — root).

1. `bun run build:lib` (dts) — grün
2. `bun run build:native` — grün, nm-Check (§5)
3. `bun run test:js` (root) — voll, erwartet 5.725+/0 (Zahl wächst mit upstream-Tests)
4. Fokussuite binding/entrypoints/console — grün (Stand v0.5.5: 82/0):
   ```bash
   bun test src/tests/zig-symbol-binding.test.ts \
             src/tests/package-entrypoints.test.ts \
             src/tests/entrypoint-import-graph.test.ts \
             src/tests/renderer.console-startup.test.ts
   ```
5. oxfmt + oxlint — grün (sonst nachbessern, das ist ok)
6. Root-Export-Snapshot: `src/tests/__snapshots__/root-export-surface.json`
   — nur legitime neue upstream-Exporte als Delta (v0.5.5: +EmbeddedTerminalRenderable).
   Snapshot-Datei aktualisieren, Delta in der Commit-Message begründen.
7. Startup-Gate GEPAART pre-Merge vs. merged (n=12 reicht als
   Regress-Beweis): TTFMF-Delta mit CI, CI darf 0 einschließen; Load
   protokollieren. (Formale n=30 bleibt R-03-parked.)

## 6a. Werkzeug-Index (Pfade)

**Gates / Mess-Skripte** (packages/core, via package.json-Aliase):
- `bun run bench:wave3:startup-gate` → scripts/wave3-startup-gate.ts
  (gepaartes Startup-A/B, Bootstrap-CI; verwendet in Schritt 7)
- `bun run bench:wave3:cpu-gate` → scripts/wave3-clean-gate-cpu.ts
  (gepaartes Streaming-CPU-A/B cold/warm)
- `bun run bench:wave3:memory:ab` → scripts/wave3-memory-ab.ts
  (Eventloop-p99; VOR formaler Nutzung Load-Guard lesen — Ledger-Warnung)
- `bun scripts/wave5-startup-breakdown.ts --native-path=<abs .so>`
  (Startup-Zerlegung Import/Core-Bind/TTFMF; Native-Pfad angeben)
- `bun scripts/wave5-stream-trace.ts` (Trace-Modus: Symbol-Zugriffe
  der primären Workloads → CORE-Abdeckungs-Check)

**Dokumente:**
- `.yesmem/performance-regression-ledger.md` — Abnahmen §11.1–11.6,
  Risiko-Register R-01…R-09, GOTCHAs (Mess-Arm-Hardlinks, Load-Pollution)
- `PERFORMANCE.md` (Repo-Root, EN, öffentlich) — Wellen-Report mit
  Headline-Zahlen; nur bei neuen Gates aktualisieren
- `.yesmem/upstream-merge-playbook.md` — dieses Dokument
- Rohdaten/Evidence: `.yesmem/bench/` (root) und
  `packages/core/.yesmem/bench/` — pro Run: raw.ndjson, report.md,
  summary.json; Provenanz (Revs, nativeSha256, Load) steckt im NDJSON-Header

**Verifikations-Ziele:**
- Symboltabelle: packages/core/src/zig.ts (opentuiSymbolDefs, 411 Entries)
- Staged-Binding-Struktur: createStagedSymbolLibrary in zig.ts
  (Tests: src/tests/zig-symbol-binding.test.ts)
- Entry-Split: src/renderer-entry.ts / src/zig-entry.ts + obige
  Entrypoint-Tests
- Export-Surface: src/tests/__snapshots__/root-export-surface.json

## 7. Publish-Hygiene (seit Scrub 2026-08-20)

- Neue Bench-Rohdaten unter `.yesmem/**/bench/` enthalten wieder lokale
  absolute Pfade + Hostnamen. VOR jedem Push auf den öffentlichen Fork:
  `git grep -iE '<lokaler-user>|<hostname>'` gegen den zu pushenden Stand.
  Scrub-Werkzeug: git-filter-repo --replace-text (Standalone-Skript per curl,
  pip scheitert an PEP 668), Ablauf und Fallen im YesMem-Learning
  „SCRUB ABGESCHLOSSEN 2026-08-20".
- Commit-Identität ist die öffentliche (carsten <ce@papoo.de>) — ok.
- Force-Push nur nach History-Rewrite, danach lokalen Branch + Tags auf die
  neuen SHAs ziehen (reset --hard + Tag-Refetch), sonst pusht der nächste
  normale Push die alten Blobs zurück.

## 8. Abnahme

Ledger-Eintrag `.yesmem/performance-regression-ledger.md` §11.x (n+1):
Datum/Run-ID, Candidate-/Basis-SHAs, Upstream-Umfang, Konfliktlösungen,
Verifikationskette mit Ergebnissen, Gesamturteil, offene Abweichungen.
Danach: Push, ggf. Tag/Prerelease (Schema v0.5.6-perf.N+1 — Notes-Datei,
PERFORMANCE.md-Zahlen nur bei neuen Gates aktualisieren).
