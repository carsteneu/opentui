# Wave 3 CPU/E2E Real-Worker Gate (Loop B, disjoint main-thread)

- generated: 2026-08-31T20:19:53.724Z
- baseline: `225e532fe0caf0fe6db3b94cb5fe1510e3341e61` (/tmp/opentui-premerge-baseline)
- candidate: `9c10158b137ec75157d557cb21cb85311e4cfca1` (/home/chief/projects/opentui/.worktrees/fastpatchv2)
- native policy: per-arm (baseline `acedba3878182a8b3e58c172a59df5bc448619c99e7b1da8c93d5dde6ec1d144`, candidate `d8473e0a9857e8aacd53c6efad0b302ccb402c987f8034aa556ed14aadab22f6`)
- Bun: 1.4.0; probe node: v26.3.0
- protocol: 30 balanced pairs, 3 fresh-process warmups/arm/scenario, 20000 bootstrap samples
- load: start 5.93/5.75/5.38; peak 7.82 (1-min); end 7.45/6.24/5.57; hostLoadExceeded=false

Measurement: disjoint main-thread stages (contentUpdate, workerPost, converter, safeAppend, textbuffer) via external seams; workerWait and workerCpu reported separately and excluded; updateToStyledCommitMs is the full wall time to the styled native commit.

## Results (paired, familywise per scenario across its 2 primary metrics)

Familywise control is applied per (scenario): the 2 primary metrics in a scenario share the Bonferroni-style /2 widening; the 2 scenarios are evaluated independently, so the effective comparison count is 4 (2 scenarios x 2 metrics).

| Scenario | Metric | Baseline p50/p95/p99 | Candidate p50/p95/p99 | Paired (95% CI) | Familywise upper | p99 change |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| cold-1000 | mainThreadSumMs | 67.952 ms / 76.209 ms / 79.656 ms | 67.877 ms / 76.376 ms / 80.005 ms | +1.76% [-1.54%, +5.18%] | +5.71% | +0.44% |
| cold-1000 | updateToStyledCommitMs | 224.022 ms / 241.237 ms / 247.861 ms | 224.699 ms / 241.602 ms / 244.087 ms | +0.99% [-1.19%, +3.16%] | +3.49% | -1.52% |
| warm-1000-append100 | mainThreadSumMs | 28.253 ms / 37.194 ms / 37.953 ms | 27.273 ms / 33.348 ms / 33.847 ms | -3.42% [-8.31%, +1.75%] | +2.52% | -10.82% |
| warm-1000-append100 | updateToStyledCommitMs | 54.936 ms / 65.364 ms / 66.102 ms | 53.077 ms / 61.224 ms / 61.770 ms | -2.18% [-5.64%, +1.44%] | +1.96% | -6.55% |

## Worker (separate, not in main-thread sum)

- workerWait baseline p50/p95/p99: 81.073 ms / 162.814 ms / 171.945 ms
- workerWait candidate p50/p95/p99: 81.172 ms / 164.563 ms / 172.162 ms
- workerCpu baseline median ~ 5.851 ms (streaming path diagnostic)
- workerCpu candidate median ~ 5.859 ms (streaming path diagnostic)

## Verdict

- measurement validity (disjoint, worker-excluded, styled native commit): **PASS** (every sample PASS, digests identical)
- regression safety (familywise upper <= +3% and p99 <= +5%): **FAIL**
- Wave-3 -30% primary target (familywise upper <= -30%): **NOT MET in isolated Loop B** (partial main-thread sum; full claim requires B+D integration: layout.render/native.commit spans live in Loop D)
- gate result: **FAIL**
