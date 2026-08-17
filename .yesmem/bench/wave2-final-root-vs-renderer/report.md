# Cold-import / TTFMF — `wave2-final-root-vs-renderer`

Generiert 2026-08-17T15:21:34.700Z · Commit `77ec7569657f04ee65eef7db1bf9a2c751383426`

Rohdaten: `raw.ndjson` (1 append-only row(s)).

## Messungen

| Commit  | Runtime | Szenario       | import p50/p95/p99 ms    | TTFMF p50/p95/p99 ms        |
| ------- | ------- | -------------- | ------------------------ | --------------------------- |
| 77ec756 | bun     | renderer-entry | 31.571 / 41.479 / 47.561 | 155.245 / 193.050 / 206.075 |

## Gate: wave1 vs candidate (acceptance)

wave1 → candidate; 95% familywise bootstrap CI upper bound <= 3% for importMs and ttfmMs.

Szenarien: Baseline `root` → Candidate `renderer-entry`.

| Metrik   | gepaarte Änderung |      nominales CI | familienweises CI | Gate |
| -------- | ----------------: | ----------------: | ----------------: | ---- |
| importMs |           -80.57% | -81.25% … -79.88% | -81.35% … -79.78% | PASS |
| ttfmMs   |           -14.92% | -16.89% … -12.86% | -17.18% … -12.54% | PASS |

Gesamt: **PASS**. Reihenfolge: 15/15.

## Gate-Provenienz

- Baseline: wave1 (home/user/projects/opentui/.worktrees/wave2-baseline).
- Source: candidate clean (e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855); baseline clean (e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855).
- Entdeckte Native-SHAs: candidate e7e9764462f2ee7f2c808856b60101ff659c6bda4a1df7cf235e418cf481a15c; baseline e7e9764462f2ee7f2c808856b60101ff659c6bda4a1df7cf235e418cf481a15c.
- Gate-Pinning: home/user/projects/opentui/.worktrees/wave2-baseline/packages/core/node_modules; SHA e7e9764462f2ee7f2c808856b60101ff659c6bda4a1df7cf235e418cf481a15c; 1890 exportierte Symbole.
- Host: AMD Ryzen 7 PRO 7840U w/ Radeon 780M Graphics; Load 15.56/14.21/16.9; Governor performance; Intel-Pstate unbekannt.
- Protokoll: Seed 2011985257; Warmup 3; 30 Paare; 20000 Bootstrap-Samples.
- Lifecycle-Probe: opentui.nativeLoaded → opentui.rendererCreated → opentui.terminalSetupStarted → opentui.firstOutputWrite → opentui.firstJsRender → opentui.firstNativeCommit → opentui.destroyStarted → opentui.destroyCompleted; Destroy 22.159 ms.

## Grenzen

- `minimal` ist ein interner, reiner Import-Messpunkt für `Renderable.ts`, kein
  zugesagter Package-Subpath. Der unterstützte Minimal-Entrypoint bleibt B1.
- `renderer-entry` misst den öffentlichen granularen Renderer-Subpath bis zu
  einem tatsächlich nativ committed Textframe. `renderable-entry` bleibt ein
  reiner Import-Messpunkt und meldet deshalb keine TTFMF.
- `dist` und Node messen in Welle 0 nur den Paketimport und melden deshalb
  keine TTFMF. Source- und Dist-Module werden in keinem Arm vermischt.
- `firstOutputWrite` wird an einem tatsächlich aufgerufenen TypeScript-/Feed-
  Sink beobachtet. Ein vollständig nativer direkter Prozess-stdout-Write ist aus
  JavaScript heraus weiterhin nicht einzeln beobachtbar.
- Eine Framequelle wird am ersten Request-Ursprung gespeichert. Bei mehreren
  koaleszierten Ursachen beschreibt sie absichtlich den ersten Auslöser.
- `frame.promote.partialToFull` zählt den kanonischen Partial-zu-Full-Pfad;
  Full-Render-Nachläufe sind keine zusätzlichen Promotions.
