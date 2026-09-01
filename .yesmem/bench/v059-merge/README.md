# v0.5.9-Merge Performance-Vergleich (225e532f perf.6 vs 9c10158b merge)

Host-Load 7.4–7.5 (Desktop-GUI), Policy-Budget (≤4) verletzt → Gates formal UNCLEAR/FAIL.
Last-normalisierte Auswertung (Metrik × Lref/L_pair, 200ms-Loadavg-Sampler, 200ms-Auflösung):

- CPU cold-1000: mainThread d50 +0.2% [CI -16.9,+21.5], updateToStyled d50 +1.6% — neutral
- CPU warm-1000-append100: mainThread d50 -6.45%, updateToStyled d50 -6.76% — KANDIDAT SCHNELLER
- Startup import: d50 +2.4% [CI -7.8,+7.9] — neutral (CI um Null)
- Startup TTFM: d50 +1.7%, d95 -1.6%, d99 -5.0% — Tails schneller
- workerCpu: 5.879 vs 5.880 ms — identisch
- Korrektheit: alle Pairs PASS, identische frame/spans/chunks-SHA256

Urteil: keine Performance-Regression durch den v0.5.9-Merge; warmes Streaming tendenziell schneller.
Formale Zertifizierung (max-load=4) bei ruhigem Host nachholen:
  bun scripts/wave3-startup-gate.ts --baseline-root=<perf.6-worktree> --candidate-root=. --baseline-revision=225e532f --candidate-revision=9c10158b --pairs=12
