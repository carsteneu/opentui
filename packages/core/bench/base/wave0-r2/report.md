# Cold-import / TTFMF report — artifact `wave0-r2`

Generiert am 2026-08-16T17:42:59.421Z · Commit `1363b3e9597de2ddc1c2853a1bab4202df1bce7b` · base `2cd44364513f59a7a5937ef257042ddb0fca4fb7` · node


## Rohdaten

`raw.ndjson` (append-only) — `3` rows.

## Baselines (Med / p95 / p99 / RME %)

| Row | Runtime | Scenario | importMs | ttfmMs |
| --- | --- | --- | --- | --- |
| 1363b3e | bun | root | 286.162 / 361.421 / 379.057 / 4.79% | 305.156 / 385.273 / 404.653 / 4.76% |
| 1363b3e | bun | zig | 187.603 / 339.594 / 346.186 / 9.01% | 214.627 / 380.87 / 394.827 / 8.66% |
| 1363b3e | node | dist | 58.818 / 75.324 / 115.906 / 6.93% | 58.818 / 75.324 / 115.906 / 6.93% |

## Gate (acceptance): fastpatch vs branch-disabled (<= 3%)

- fastpatch median: 226.513 ms; branch-disabled median: 227.19 ms
- overhead median: 0% — **PASS**

## Gate: disabled vs enabled (<= 3%)

- disabled median: 221.464 ms; enabled median: 218.705 ms
- overhead median: 0.23% — **PASS**

## Limitationen (dokumentiert, Review-R2)

- Request-Ursachen (rAF/requestPartial/timer/live/request) werden zur Frame-Zeit
  heuristisch zugeordnet (hadAnimation/hadPartialRequest/Followup-Flag/_isRunning),
  nicht am Anforderungsursprung gespeichert. Genau eine Quelle pro Frame,
  Summe == frame.total (getestet), aber Einzelzuordnung ist heuristisch.
- firstOutputWrite wird am Native-Commit abgeleitet (echtes Memory-Buffer-Flag
  _bufferedOutputMemory + Terminal-Setup), nicht an einem individuellen Write-
  Callback beobachtet. Approximation des Write-Sinks; offene Limitation.
- frame.promote.partialToFull zählt nur den kanonischen Promote-Pfad
  (Partial-Render hob eine normale Invalidation aus). Andere immediateRerender-
  Stellen sind Full-Render-Nachläufe/Request-Marker, keine echten Promotes
  (Code-Inspektion Review-R2); keine zusätzlichen Zähler gesetzt.
- Bun-Prozess-Cold-Import hat intrinsisches RME ~4-9 % (Heavy-Tail p99 ≈ 2×
  Median, Scheduler-Rauschen); RME < 3 % ist mit dieser Methode nicht erreichbar.
  Das gepaarte Akzeptanz-Gate ist davon unberührt (Paar-Differenz koppelt Drift aus).
- Node-Baseline misst ausschließlich den Dist-Cold-Import (kein Render/Telemetrie
  unter Node, src-Hooks sind bun-only).
