# Wave 3 CPU/E2E Real-Worker Gate (Loop B, disjoint main-thread)

- generated: 2026-08-20T10:03:56.465Z
- baseline: `8816eebd9decda4af6c352b6c4caf7a28b12e21b` (home/user/projects/opentui/.worktrees/wave4-ab-baseline)
- candidate: `7180050fd0dc19c0ba8666c7a907015eca9b11d7` (home/user/projects/opentui/.worktrees/fastpatch)
- native policy: per-arm (baseline `bd37f680099d96d8f9c89a5d128521dd2ac7c51bc10f93dbff531f9e51a8edf4`, candidate `a2709a93cfdd55a04691a5d5c93918bc37c5f8d70faf970051e22276c3e541c8`)
- Bun: 1.3.14; probe node: v24.3.0
- protocol: 10 balanced pairs, 2 fresh-process warmups/arm/scenario, 20000 bootstrap samples
- load: start 4.89/3.77/2.83; peak 5.06 (1-min); end 4.45/3.79/2.86; hostLoadExceeded=true

Measurement: disjoint main-thread stages (contentUpdate, workerPost, converter, safeAppend, textbuffer) via external seams; workerWait and workerCpu reported separately and excluded; updateToStyledCommitMs is the full wall time to the styled native commit.

## Results (paired, familywise per scenario across its 2 primary metrics)

Familywise control is applied per (scenario): the 2 primary metrics in a scenario share the Bonferroni-style /2 widening; the 2 scenarios are evaluated independently, so the effective comparison count is 4 (2 scenarios x 2 metrics).

| Scenario | Metric | Baseline p50/p95/p99 | Candidate p50/p95/p99 | Paired (95% CI) | Familywise upper | p99 change |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| cold-1000 | mainThreadSumMs | 67.726 ms / 78.136 ms / 81.093 ms | 73.930 ms / 85.979 ms / 90.359 ms | +6.80% [-0.17%, +14.49%] | +15.56% | +11.43% |
| cold-1000 | updateToStyledCommitMs | 250.905 ms / 285.801 ms / 292.774 ms | 281.630 ms / 320.814 ms / 321.424 ms | +6.89% [+0.89%, +13.93%] | +15.13% | +9.79% |
| warm-1000-append100 | mainThreadSumMs | 37.184 ms / 43.641 ms / 44.821 ms | 34.956 ms / 39.525 ms / 40.121 ms | -5.18% [-11.12%, +1.20%] | +2.07% | -10.49% |
| warm-1000-append100 | updateToStyledCommitMs | 66.706 ms / 77.200 ms / 80.664 ms | 60.790 ms / 68.263 ms / 68.972 ms | -6.06% [-10.96%, -0.63%] | +0.21% | -14.49% |

## Worker (separate, not in main-thread sum)

- workerWait baseline p50/p95/p99: 101.156 ms / 205.487 ms / 216.328 ms
- workerWait candidate p50/p95/p99: 96.498 ms / 241.129 ms / 243.565 ms
- workerCpu baseline median ~ 7.498 ms (streaming path diagnostic)
- workerCpu candidate median ~ 7.015 ms (streaming path diagnostic)

## Verdict

- measurement validity (disjoint, worker-excluded, styled native commit): **PASS** (every sample PASS, digests identical)
- regression safety (familywise upper <= +3% and p99 <= +5%): **UNCLEAR**
- Wave-3 -30% primary target (familywise upper <= -30%): **NOT MET in isolated Loop B** (partial main-thread sum; full claim requires B+D integration: layout.render/native.commit spans live in Loop D)
- gate result: **UNCLEAR**
