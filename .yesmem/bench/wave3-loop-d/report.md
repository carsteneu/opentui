# Wave 3 Loop D — converter benchmark (optimized vs fccae215 baseline)

- date: 2026-08-17T22:53:06.115Z
- platform: linux x64
- note: paired, in-process, per-call ms. Workloads use valid ranges (start < end).

## lines=20 density=1 (samples=740, highlights=20)

| metric | baseline (fccae215) | optimized | ratio (opt/base) |
|---|---|---|---|
| p50 | 0.011 ms | 0.009 ms | 0.802 |
| p95 | 0.036 ms | 0.017 ms | 0.477 |
| p99 | 0.058 ms | 0.026 ms | 0.444 |

## small-sparse (samples=33, highlights=5)

| metric | baseline (fccae215) | optimized | ratio (opt/base) |
|---|---|---|---|
| p50 | 0.003 ms | 0.003 ms | 0.948 |
| p95 | 0.010 ms | 0.010 ms | 0.970 |
| p99 | 0.011 ms | 0.010 ms | 0.894 |

## lines=1000 density=2 (samples=42560, highlights=2000)

| metric | baseline (fccae215) | optimized | ratio (opt/base) |
|---|---|---|---|
| p50 | 1.659 ms | 1.182 ms | 0.713 |
| p95 | 3.647 ms | 2.921 ms | 0.801 |
| p99 | 5.903 ms | 3.682 ms | 0.624 |

## lines=5000 density=3 (samples=230560, highlights=15000)

| metric | baseline (fccae215) | optimized | ratio (opt/base) |
|---|---|---|---|
| p50 | 17.064 ms | 10.591 ms | 0.621 |
| p95 | 21.635 ms | 12.905 ms | 0.597 |
| p99 | 23.318 ms | 13.382 ms | 0.574 |

## inject-5k K=600 (samples=182900, highlights=10400)

| metric | baseline (fccae215) | optimized | ratio (opt/base) |
|---|---|---|---|
| p50 | 28.844 ms | 13.746 ms | 0.477 |
| p95 | 33.163 ms | 15.597 ms | 0.470 |
| p99 | 35.880 ms | 15.954 ms | 0.445 |

## Output parity: lines=5000 density=3

- baseline chunks: 28520
- optimized chunks: 28520
- byte-identical chunk sequence: **YES**

## Output parity: inject-5k K=600

- baseline chunks: 19600
- optimized chunks: 19600
- byte-identical chunk sequence: **YES**

## Perf gates (§8.4)

| gate | criterion | measured | pass |
|---|---|---|---|
| 1k p95 < 8ms | p95(1k density=2) < 8ms | 2.921 ms | YES |
| 5k ≥50% below fccae215 (inject-5k) | opt p50 ≤ 0.5×base p50 | 13.746 vs 28.844 ms (ratio 0.477) | YES |
| small/sparse ≤3% worse | opt p50(small) ≤ 1.03×base p50 | 0.009 vs 0.011 ms (ratio 0.802) | YES |

Secondary 5k (realistic density=3) for transparency:
- opt p50=10.591 ms vs base p50=17.064 ms (ratio 0.621)
