# Wave 3 CPU/E2E Real-Worker Gate (Loop B, disjoint main-thread)

- generated: 2026-08-20T10:05:02.444Z
- baseline: `8816eebd9decda4af6c352b6c4caf7a28b12e21b` (home/user/projects/opentui/.worktrees/wave4-ab-baseline)
- candidate: `7180050fd0dc19c0ba8666c7a907015eca9b11d7` (home/user/projects/opentui/.worktrees/fastpatch)
- native policy: per-arm (baseline `bd37f680099d96d8f9c89a5d128521dd2ac7c51bc10f93dbff531f9e51a8edf4`, candidate `a2709a93cfdd55a04691a5d5c93918bc37c5f8d70faf970051e22276c3e541c8`)
- Bun: 1.3.14; probe node: v24.3.0
- protocol: 10 balanced pairs, 2 fresh-process warmups/arm/scenario, 20000 bootstrap samples
- load: start 4.43/3.85/2.92; peak 4.99 (1-min); end 4.53/3.94/2.98; hostLoadExceeded=true

Measurement: disjoint main-thread stages (contentUpdate, workerPost, converter, safeAppend, textbuffer) via external seams; workerWait and workerCpu reported separately and excluded; updateToStyledCommitMs is the full wall time to the styled native commit.

## Results (paired, familywise per scenario across its 2 primary metrics)

Familywise control is applied per (scenario): the 2 primary metrics in a scenario share the Bonferroni-style /2 widening; the 2 scenarios are evaluated independently, so the effective comparison count is 4 (2 scenarios x 2 metrics).

| Scenario | Metric | Baseline p50/p95/p99 | Candidate p50/p95/p99 | Paired (95% CI) | Familywise upper | p99 change |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| cold-1000 | mainThreadSumMs | 78.652 ms / 91.529 ms / 92.902 ms | 80.961 ms / 99.417 ms / 99.574 ms | +5.50% [-4.78%, +16.72%] | +18.60% | +7.18% |
| cold-1000 | updateToStyledCommitMs | 293.738 ms / 335.235 ms / 337.637 ms | 302.400 ms / 370.490 ms / 382.522 ms | +2.62% [-3.27%, +8.50%] | +9.30% | +13.29% |
| warm-1000-append100 | mainThreadSumMs | 43.269 ms / 51.752 ms / 53.622 ms | 43.234 ms / 59.817 ms / 64.326 ms | +5.30% [-7.75%, +19.61%] | +21.54% | +19.96% |
| warm-1000-append100 | updateToStyledCommitMs | 73.413 ms / 100.736 ms / 108.073 ms | 73.464 ms / 107.804 ms / 110.312 ms | +3.22% [-9.26%, +15.87%] | +17.42% | +2.07% |

## Worker (separate, not in main-thread sum)

- workerWait baseline p50/p95/p99: 121.974 ms / 240.689 ms / 251.267 ms
- workerWait candidate p50/p95/p99: 117.929 ms / 255.411 ms / 277.958 ms
- workerCpu baseline median ~ 7.720 ms (streaming path diagnostic)
- workerCpu candidate median ~ 7.936 ms (streaming path diagnostic)

## Verdict

- measurement validity (disjoint, worker-excluded, styled native commit): **PASS** (every sample PASS, digests identical)
- regression safety (familywise upper <= +3% and p99 <= +5%): **UNCLEAR**
- Wave-3 -30% primary target (familywise upper <= -30%): **NOT MET in isolated Loop B** (partial main-thread sum; full claim requires B+D integration: layout.render/native.commit spans live in Loop D)
- gate result: **UNCLEAR**
