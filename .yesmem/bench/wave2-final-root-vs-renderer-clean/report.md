# Cold-import / TTFMF — `wave2-final-root-vs-renderer-clean`

Generiert 2026-08-17T21:06:51.375Z · Commit `f7169b794ecb6ef10700505e8fb465d4c7eb0b55`

Rohdaten: `raw.ndjson` (1 append-only row(s)).

## Messungen

| Commit  | Runtime | Szenario       | import p50/p95/p99 ms    | TTFMF p50/p95/p99 ms        |
| ------- | ------- | -------------- | ------------------------ | --------------------------- |
| f7169b7 | bun     | renderer-entry | 29.351 / 40.011 / 43.451 | 148.026 / 181.982 / 190.128 |

## Gate: wave1 vs candidate (acceptance)

wave1 → candidate; 95% familywise bootstrap CI upper bound <= 3% for importMs and ttfmMs.

Szenarien: Baseline `root` → Candidate `renderer-entry`.

| Metrik   | gepaarte Änderung |      nominales CI | familienweises CI | Gate |
| -------- | ----------------: | ----------------: | ----------------: | ---- |
| importMs |           -82.20% | -82.81% … -81.61% | -82.90% … -81.53% | PASS |
| ttfmMs   |           -16.44% | -19.15% … -14.00% | -19.59% … -13.69% | PASS |

Gesamt: **PASS**. Reihenfolge: 15/15.

## Gate-Provenienz

- Baseline: wave1 (home/user/projects/opentui/.worktrees/wave2-baseline).
- Source: candidate clean (e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855); baseline clean (e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855).
- Entdeckte Native-SHAs: candidate c38439b63cb3f951b7f90251d5e34832e35ac271e278d4729408d18a82c50da2; baseline e7e9764462f2ee7f2c808856b60101ff659c6bda4a1df7cf235e418cf481a15c.
- Gate-Pinning: home/user/projects/opentui/.worktrees/wave2-baseline/packages/core/node_modules; SHA e7e9764462f2ee7f2c808856b60101ff659c6bda4a1df7cf235e418cf481a15c; 1890 exportierte Symbole.
- Host: AMD Ryzen 7 PRO 7840U w/ Radeon 780M Graphics; Load 2.53/2.82/4.14; Governor powersave; Intel-Pstate unbekannt.
- Protokoll: Seed 4145453945; Warmup 3; 30 Paare; 20000 Bootstrap-Samples.
- Lifecycle-Probe: opentui.nativeLoaded → opentui.rendererCreated → opentui.terminalSetupStarted → opentui.firstOutputWrite → opentui.firstJsRender → opentui.firstNativeCommit → opentui.destroyStarted → opentui.destroyCompleted; Destroy 22.371 ms.

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
