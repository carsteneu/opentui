# Wave 3 CPU/E2E Real-Worker Gate (Loop B, disjoint main-thread)

- generated: 2026-08-20T12:41:24.324Z
- baseline: `13dc719306083c90040470ff401b3f29bee3dffb` (home/user/projects/opentui/.worktrees/fastpatch)
- candidate: `271fd0bb8bc4a2dfd68c8168481e6d19d0fd3068` (home/user/projects/opentui/.worktrees/wave5-startup-binding)
- native policy: per-arm (baseline `a2709a93cfdd55a04691a5d5c93918bc37c5f8d70faf970051e22276c3e541c8`, candidate `553180957522fcdf2558e899e6d97562555fff238d68d62861a563040008f5cd`)
- Bun: 1.3.14; probe node: v24.3.0
- protocol: 10 balanced pairs, 2 fresh-process warmups/arm/scenario, 20000 bootstrap samples
- load: start 2.73/4.36/3.9; peak 6.05 (1-min); end 5.35/4.87/4.1; hostLoadExceeded=true

Measurement: disjoint main-thread stages (contentUpdate, workerPost, converter, safeAppend, textbuffer) via external seams; workerWait and workerCpu reported separately and excluded; updateToStyledCommitMs is the full wall time to the styled native commit.

## Results (paired, familywise per scenario across its 2 primary metrics)

Familywise control is applied per (scenario): the 2 primary metrics in a scenario share the Bonferroni-style /2 widening; the 2 scenarios are evaluated independently, so the effective comparison count is 4 (2 scenarios x 2 metrics).

| Scenario | Metric | Baseline p50/p95/p99 | Candidate p50/p95/p99 | Paired (95% CI) | Familywise upper | p99 change |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| cold-1000 | mainThreadSumMs | 103.488 ms / 159.865 ms / 170.075 ms | 100.696 ms / 151.402 ms / 160.920 ms | -1.70% [-18.87%, +20.69%] | +23.80% | -5.38% |
| cold-1000 | updateToStyledCommitMs | 392.861 ms / 595.169 ms / 626.077 ms | 513.672 ms / 703.511 ms / 717.405 ms | +27.71% [+11.11%, +50.55%] | +54.17% | +14.59% |
| warm-1000-append100 | mainThreadSumMs | 59.284 ms / 88.949 ms / 90.725 ms | 54.813 ms / 88.514 ms / 88.837 ms | -0.80% [-12.70%, +12.99%] | +14.55% | -2.08% |
| warm-1000-append100 | updateToStyledCommitMs | 111.166 ms / 150.782 ms / 151.260 ms | 97.481 ms / 158.411 ms / 163.306 ms | -0.87% [-12.51%, +12.48%] | +14.47% | +7.96% |

## Worker (separate, not in main-thread sum)

- workerWait baseline p50/p95/p99: 138.665 ms / 391.393 ms / 467.484 ms
- workerWait candidate p50/p95/p99: 179.973 ms / 561.426 ms / 576.842 ms
- workerCpu baseline median ~ 7.456 ms (streaming path diagnostic)
- workerCpu candidate median ~ 6.346 ms (streaming path diagnostic)

## Verdict

- measurement validity (disjoint, worker-excluded, styled native commit): **PASS** (every sample PASS, digests identical)
- regression safety (familywise upper <= +3% and p99 <= +5%): **UNCLEAR**
- Wave-3 -30% primary target (familywise upper <= -30%): **NOT MET in isolated Loop B** (partial main-thread sum; full claim requires B+D integration: layout.render/native.commit spans live in Loop D)
- gate result: **UNCLEAR**
