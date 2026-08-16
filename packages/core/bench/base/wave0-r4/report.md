# Cold-import / TTFMF — `wave0-r4`

Generiert 2026-08-16T18:45:42.645Z · Commit `cc1cb032c88325dbd6ac628cec8ed9c65cb7d83d`

Rohdaten: `raw.ndjson` (5 append-only row(s)).

## Messungen

| Commit  | Runtime | Szenario | import p50/p95/p99 ms       | TTFMF p50/p95/p99 ms        |
| ------- | ------- | -------- | --------------------------- | --------------------------- |
| cc1cb03 | bun     | root     | 435.704 / 625.631 / 673.767 | 460.972 / 676.153 / 729.404 |
| cc1cb03 | bun     | minimal  | 303.768 / 367.176 / 382.124 | 303.768 / 367.176 / 382.124 |
| cc1cb03 | bun     | zig      | 306.293 / 374.115 / 378.759 | 350.981 / 419.316 / 426.761 |
| cc1cb03 | bun     | dist     | 350.285 / 407.562 / 407.644 | 350.285 / 407.562 / 407.644 |
| cc1cb03 | node    | dist     | 123.031 / 130.085 / 130.257 | 123.031 / 130.085 / 130.257 |

## Gate: fastpatch vs branch-disabled (acceptance)

fastpatch → branch-disabled; 95% familywise bootstrap CI upper bound <= 3% for importMs and ttfmMs.

| Metrik   | gepaarte Änderung |    nominales CI | familienweises CI | Gate |
| -------- | ----------------: | --------------: | ----------------: | ---- |
| importMs |             0.69% | -8.66% … 10.53% |  -10.06% … 11.92% | FAIL |
| ttfmMs   |             1.06% | -8.04% … 10.67% |   -9.18% … 12.17% | FAIL |

Gesamt: **FAIL**. Reihenfolge: 15/15.

## Gate: telemetry disabled vs enabled (informational)

disabled → enabled; 95% familywise bootstrap CI upper bound <= 3% for importMs and ttfmMs.

| Metrik   | gepaarte Änderung |    nominales CI | familienweises CI | Gate |
| -------- | ----------------: | --------------: | ----------------: | ---- |
| importMs |            -6.01% | -15.69% … 4.48% |   -16.92% … 6.08% | FAIL |
| ttfmMs   |            -6.36% | -15.78% … 4.01% |   -17.00% … 5.35% | FAIL |

Gesamt: **FAIL**. Reihenfolge: 15/15.

## Gate-Provenienz

- Source: candidate dirty, explizit erlaubt (d8cc5435c393db31a09a62ad2ad26db153043ac0313674205f500778d94038b0); fastpatch clean (e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855).
- Entdeckte Native-SHAs: candidate e7e9764462f2ee7f2c808856b60101ff659c6bda4a1df7cf235e418cf481a15c; fastpatch c38439b63cb3f951b7f90251d5e34832e35ac271e278d4729408d18a82c50da2.
- Gate-Pinning: home/user/projects/opentui/.worktrees/fastpatch/packages/core/node_modules; SHA c38439b63cb3f951b7f90251d5e34832e35ac271e278d4729408d18a82c50da2; 1890 exportierte Symbole.
- Host: AMD Ryzen 7 PRO 7840U w/ Radeon 780M Graphics; Load 8.54/8.14/5.44; Governor powersave; Intel-Pstate unbekannt.
- Protokoll: Seed 3237998146; Warmup 3; 30 Paare; 20000 Bootstrap-Samples.
- Lifecycle-Probe: opentui.nativeLoaded → opentui.importReady → opentui.rendererCreated → opentui.terminalSetupStarted → opentui.firstOutputWrite → opentui.firstJsRender → opentui.firstNativeCommit → opentui.destroyStarted → opentui.destroyCompleted; Destroy 24.255 ms.

## Grenzen

- `minimal` ist ein interner, reiner Import-Messpunkt für `Renderable.ts`, kein
  zugesagter Package-Subpath. Der unterstützte Minimal-Entrypoint bleibt B1.
- `dist` und Node messen in Welle 0 nur den Paketimport; TTFMF entspricht dort
  der Importgrenze. Source- und Dist-Module werden in keinem Arm vermischt.
- `firstOutputWrite` wird an einem tatsächlich aufgerufenen TypeScript-/Feed-
  Sink beobachtet. Ein vollständig nativer direkter Prozess-stdout-Write ist aus
  JavaScript heraus weiterhin nicht einzeln beobachtbar.
- Eine Framequelle wird am ersten Request-Ursprung gespeichert. Bei mehreren
  koaleszierten Ursachen beschreibt sie absichtlich den ersten Auslöser.
- `frame.promote.partialToFull` zählt den kanonischen Partial-zu-Full-Pfad;
  Full-Render-Nachläufe sind keine zusätzlichen Promotions.
