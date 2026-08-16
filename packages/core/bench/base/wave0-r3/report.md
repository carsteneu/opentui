# Cold-import / TTFMF report — artifact `wave0-r3`

Generiert am 2026-08-16T17:57:19.959Z · Commit `fa9627dedeffa9f6c8c341f255786aff3d428920` · base `2cd44364513f59a7a5937ef257042ddb0fca4fb7` · node


## Rohdaten

`raw.ndjson` (append-only) — `3` rows.

## Baselines (Med / p95 / p99 / RME %)

| Row | Runtime | Scenario | importMs | ttfmMs |
| --- | --- | --- | --- | --- |
| fa9627d | bun | root | 590.081 / 664.646 / 691.74 / 2.84% | 630.192 / 709.418 / 731.706 / 2.76% |
| fa9627d | bun | zig | 288.314 / 411.868 / 431.263 / 6.05% | 330.919 / 470.033 / 478.572 / 5.68% |
| fa9627d | node | dist | 96.192 / 123.683 / 141.087 / 5.71% | 96.192 / 123.683 / 141.087 / 5.71% |

## Gate (acceptance): fastpatch vs branch-disabled (<= 3%)

- fastpatch median: 585.47 ms; branch-disabled median: 619.721 ms
- overhead median: 1.69% — **PASS**

## Gate: disabled vs enabled (<= 3%)

- disabled median: 375.546 ms; enabled median: 376.835 ms
- overhead median: 0.02% — **PASS**

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
