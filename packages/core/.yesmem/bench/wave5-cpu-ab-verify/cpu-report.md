# Wave 3 CPU/E2E Real-Worker Gate (Loop B, disjoint main-thread)

- generated: 2026-08-20T12:12:22.688Z
- baseline: `13dc719306083c90040470ff401b3f29bee3dffb` (home/user/projects/opentui/.worktrees/fastpatch)
- candidate: `c43c3bd5f855b4f93fe67f8520d10eb9c3a29785` (home/user/projects/opentui/.worktrees/wave5-startup-binding)
- native policy: per-arm (baseline `a2709a93cfdd55a04691a5d5c93918bc37c5f8d70faf970051e22276c3e541c8`, candidate `553180957522fcdf2558e899e6d97562555fff238d68d62861a563040008f5cd`)
- Bun: 1.3.14; probe node: v24.3.0
- protocol: 10 balanced pairs, 2 fresh-process warmups/arm/scenario, 20000 bootstrap samples
- load: start 8.44/3.73/2.94; peak 8.44 (1-min); end 7.33/3.98/3.05; hostLoadExceeded=true

Measurement: disjoint main-thread stages (contentUpdate, workerPost, converter, safeAppend, textbuffer) via external seams; workerWait and workerCpu reported separately and excluded; updateToStyledCommitMs is the full wall time to the styled native commit.

## Results (paired, familywise per scenario across its 2 primary metrics)

Familywise control is applied per (scenario): the 2 primary metrics in a scenario share the Bonferroni-style /2 widening; the 2 scenarios are evaluated independently, so the effective comparison count is 4 (2 scenarios x 2 metrics).

| Scenario | Metric | Baseline p50/p95/p99 | Candidate p50/p95/p99 | Paired (95% CI) | Familywise upper | p99 change |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| cold-1000 | mainThreadSumMs | 109.444 ms / 156.061 ms / 159.993 ms | 102.498 ms / 130.530 ms / 140.393 ms | -7.42% [-23.13%, +13.46%] | +16.92% | -12.25% |
| cold-1000 | updateToStyledCommitMs | 374.634 ms / 466.211 ms / 479.646 ms | 489.832 ms / 558.001 ms / 565.330 ms | +31.57% [+10.29%, +55.62%] | +58.75% | +17.86% |
| warm-1000-append100 | mainThreadSumMs | 37.786 ms / 65.919 ms / 80.120 ms | 43.864 ms / 59.626 ms / 63.652 ms | +8.59% [-10.20%, +28.61%] | +31.51% | -20.55% |
| warm-1000-append100 | updateToStyledCommitMs | 67.810 ms / 120.300 ms / 148.611 ms | 83.686 ms / 113.177 ms / 119.585 ms | +13.38% [-3.90%, +33.36%] | +36.07% | -19.53% |

## Worker (separate, not in main-thread sum)

- workerWait baseline p50/p95/p99: 134.804 ms / 290.970 ms / 345.675 ms
- workerWait candidate p50/p95/p99: 171.480 ms / 424.617 ms / 456.006 ms
- workerCpu baseline median ~ 7.634 ms (streaming path diagnostic)
- workerCpu candidate median ~ 8.470 ms (streaming path diagnostic)

## Verdict

- measurement validity (disjoint, worker-excluded, styled native commit): **PASS** (every sample PASS, digests identical)
- regression safety (familywise upper <= +3% and p99 <= +5%): **UNCLEAR**
- Wave-3 -30% primary target (familywise upper <= -30%): **NOT MET in isolated Loop B** (partial main-thread sum; full claim requires B+D integration: layout.render/native.commit spans live in Loop D)
- gate result: **UNCLEAR**
