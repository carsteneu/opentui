# Wave 3 Loop D — converter benchmark (optimized vs fastpatch baseline (2cd44364))

- date: 2026-08-18T08:14:27.986Z
- platform: linux x64
- note: paired, in-process, per-call ms. Workloads use valid ranges (start < end).

## lines=20 density=1 (samples=740, highlights=20)

| metric | baseline (fastpatch 2cd44364) | optimized | ratio (opt/base) |
| ------ | ----------------------------- | --------- | ---------------- |
| p50    | 0.020 ms                      | 0.009 ms  | 0.469            |
| p95    | 0.051 ms                      | 0.018 ms  | 0.348            |
| p99    | 0.100 ms                      | 0.042 ms  | 0.416            |

## small-sparse (samples=33, highlights=5)

| metric | baseline (fastpatch 2cd44364) | optimized | ratio (opt/base) |
| ------ | ----------------------------- | --------- | ---------------- |
| p50    | 0.004 ms                      | 0.003 ms  | 0.761            |
| p95    | 0.015 ms                      | 0.010 ms  | 0.690            |
| p99    | 0.017 ms                      | 0.012 ms  | 0.687            |

## lines=1000 density=2 (samples=42560, highlights=2000)

| metric | baseline (fastpatch 2cd44364) | optimized | ratio (opt/base) |
| ------ | ----------------------------- | --------- | ---------------- |
| p50    | 2.591 ms                      | 3.055 ms  | 1.179            |
| p95    | 5.171 ms                      | 5.488 ms  | 1.061            |
| p99    | 6.551 ms                      | 6.187 ms  | 0.944            |

## lines=5000 density=3 (samples=230560, highlights=15000)

| metric | baseline (fastpatch 2cd44364) | optimized | ratio (opt/base) |
| ------ | ----------------------------- | --------- | ---------------- |
| p50    | 39.575 ms                     | 25.677 ms | 0.649            |
| p95    | 48.550 ms                     | 42.933 ms | 0.884            |
| p99    | 50.779 ms                     | 47.751 ms | 0.940            |

## inject-5k K=600 (samples=182900, highlights=10400)

| metric | baseline (fastpatch 2cd44364) | optimized | ratio (opt/base) |
| ------ | ----------------------------- | --------- | ---------------- |
| p50    | 79.997 ms                     | 17.151 ms | 0.214            |
| p95    | 92.328 ms                     | 50.332 ms | 0.545            |
| p99    | 98.085 ms                     | 51.843 ms | 0.529            |

## Output parity: lines=5000 density=3

- baseline chunks: 28520
- optimized chunks: 28520
- byte-identical chunk sequence: **YES**

## Output parity: inject-5k K=600

- baseline chunks: 19600
- optimized chunks: 19600
- byte-identical chunk sequence: **YES**

## Perf gates (§8.4)

| gate                                         | criterion                      | measured                          | pass |
| -------------------------------------------- | ------------------------------ | --------------------------------- | ---- |
| 1k p95 < 8ms                                 | p95(1k density=2) < 8ms        | 5.488 ms                          | YES  |
| 5k ≥50% below fastpatch 2cd44364 (inject-5k) | opt p50 ≤ 0.5×base p50         | 17.151 vs 79.997 ms (ratio 0.214) | YES  |
| small/sparse ≤3% worse                       | opt p50(small) ≤ 1.03×base p50 | 0.009 vs 0.020 ms (ratio 0.469)   | YES  |

Secondary 5k (realistic density=3) for transparency:

- opt p50=25.677 ms vs base p50=39.575 ms (ratio 0.649)
