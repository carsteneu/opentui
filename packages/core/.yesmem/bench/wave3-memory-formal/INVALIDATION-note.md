## Ehrliche Einordnung: formaler Memory n=30 (wave3-memory-formal, 2026-08-19 23:38)

Dieser Lauf ist als *belastbarer* Gate **NICHT zertifizierbar** — Load-Pollution im Baseline-Arm.

| | Candidate | Baseline |
|---|---|---|
| p99-Mittel erste 10 Runs | 194.4 ms | **1506.5 ms** |
| p99-Mittel restliche Runs | 91.9 ms | 822.1 ms |
| Median | 93.1 ms | **852.8 ms** |

- Die saubere Loop-C-2-Lauf-Indikation zeigte Baseline-p99 ≈ **96 ms** (Candidate ≈ 96 ms, Δ +2.66 %).
- Der formale Lauf wurde in einem 19-min-Fenster mit hoher/oszillierender Host-Load gefahren; der
  Baseline-Arm lief tendenziell in den lauteren Abschnitten und zeigt ~9× aufgeblähte p99.
- Der rechnerische "delta = −89.08 % / PASS" ist ein Artefakt des Median-Vergleichs gegen die
  kontaminierte Baseline und gilt therefore **nicht als Regressionsgewinn**.
- Schlussfolgerung: Rolling-Memory bleibt auf Basis der *sauberen* Indikation **kein Rückschritt**
  (Loop-C-Absolutgates PASS, p99-Indikation innerhalb +5 %), aber das formale −89 % wird **zurückgezogen**.
- Ein zertifizierbares formales Memory-A/B erfordert ein ruhiges Messfenster (Load ≤ ~2–4) und
  denselben gepaarten Messvertrag ohne einseitige Load-Kovariation.
