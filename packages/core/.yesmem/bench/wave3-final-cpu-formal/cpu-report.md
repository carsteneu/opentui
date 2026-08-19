# Wave 3 CPU/E2E Real-Worker Gate (Loop B, disjoint main-thread)

- generated: 2026-08-19T16:10:46.595Z
- baseline: `fccae2158d5c98949fc050913b918621af918111` (home/user/projects/opentui/.worktrees/wave3-baseline)
- candidate: `b416a75d6847692eda25c63d9c870b0c3ecb36a2` (home/user/projects/opentui/.worktrees/wave3-integration)
- native policy: per-arm (baseline `e7e9764462f2ee7f2c808856b60101ff659c6bda4a1df7cf235e418cf481a15c`, candidate `c5c69aaad20d06abf10e0646e7c606ac4ef70df81bc5f33ff646a5b16b9fede0`)
- Bun: 1.3.14; probe node: v24.3.0
- protocol: 30 balanced pairs, 3 fresh-process warmups/arm/scenario, 20000 bootstrap samples
- load: start 6.3/6.69/7.33; peak 8.68 (1-min); end 7.77/7.16/7.42; hostLoadExceeded=true

Measurement: disjoint main-thread stages (contentUpdate, workerPost, converter, safeAppend, textbuffer) via external seams; workerWait and workerCpu reported separately and excluded; updateToStyledCommitMs is the full wall time to the styled native commit.

## Results (paired, familywise per scenario across its 2 primary metrics)

Familywise control is applied per (scenario): the 2 primary metrics in a scenario share the Bonferroni-style /2 widening; the 2 scenarios are evaluated independently, so the effective comparison count is 4 (2 scenarios x 2 metrics).

| Scenario | Metric | Baseline p50/p95/p99 | Candidate p50/p95/p99 | Paired (95% CI) | Familywise upper | p99 change |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| cold-1000 | mainThreadSumMs | 582.802 ms / 861.886 ms / 927.419 ms | 99.813 ms / 142.576 ms / 148.588 ms | -83.03% [-83.89%, -82.12%] | -81.99% | -83.98% |
| cold-1000 | updateToStyledCommitMs | 817.236 ms / 1183.462 ms / 1260.213 ms | 333.506 ms / 503.792 ms / 520.988 ms | -59.67% [-61.22%, -58.25%] | -58.05% | -58.66% |
| warm-1000-append100 | mainThreadSumMs | 649.514 ms / 955.390 ms / 1006.234 ms | 45.335 ms / 76.429 ms / 91.063 ms | -92.93% [-93.31%, -92.50%] | -92.44% | -90.95% |
| warm-1000-append100 | updateToStyledCommitMs | 686.189 ms / 1005.247 ms / 1066.149 ms | 80.498 ms / 150.643 ms / 165.029 ms | -88.09% [-88.76%, -87.31%] | -87.20% | -84.52% |

## Worker (separate, not in main-thread sum)

- workerWait baseline p50/p95/p99: 137.498 ms / 303.867 ms / 364.422 ms
- workerWait candidate p50/p95/p99: 148.361 ms / 297.078 ms / 369.185 ms
- workerCpu baseline median ~ 0.000 ms (streaming path diagnostic)
- workerCpu candidate median ~ 7.250 ms (streaming path diagnostic)

## Verdict

- measurement validity (disjoint, worker-excluded, styled native commit): **PASS** (every sample PASS, digests identical)
- regression safety (familywise upper <= +3% and p99 <= +5%): **UNCLEAR**
- Wave-3 -30% primary target (familywise upper <= -30%): **PASS** (partial main-thread sum; full claim requires B+D integration: layout.render/native.commit spans live in Loop D)
- gate result: **UNCLEAR**
