# Wave 3 Startup-Safety Gate (Loop B, per-arm native)

- generated: 2026-08-20T10:05:34.610Z
- baseline: `8816eebd9decda4af6c352b6c4caf7a28b12e21b` (home/user/projects/opentui/.worktrees/wave4-ab-baseline), native `bd37f680099d96d8f9c89a5d128521dd2ac7c51bc10f93dbff531f9e51a8edf4`
- candidate: `7180050fd0dc19c0ba8666c7a907015eca9b11d7` (home/user/projects/opentui/.worktrees/fastpatch), native `a2709a93cfdd55a04691a5d5c93918bc37c5f8d70faf970051e22276c3e541c8`
- scenario: renderer-entry → renderer-entry; import + TTFMF (first native commit)
- Bun: 1.3.14; protocol: 16 balanced pairs, 1 warmups, 20000 bootstrap samples
- load: start 4.06/3.88/2.99; peak 4.06 (1-min); end 4.06/3.88/3; hostLoadExceeded=true
- CIs are familywise-corrected across 6 comparisons (2 metrics x p50/p95/p99), alpha=0.05: confidence 99.17% per comparison (Bonferroni-style /6).

| Metric | Baseline p50/p95/p99 | Candidate p50/p95/p99 | Paired p50 (CI) | p95 (CI) | p99 (CI) | p50/p95 budget (≤+3%) | p99 budget (≤+5%) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Import | 52.945 ms / 58.849 ms / 60.316 ms | 55.462 ms / 57.754 ms / 58.941 ms | +4.75% [-5.06%, +10.44%] | -1.86% [-7.44%, +5.95%] | -2.28% [-7.34%, +5.71%] | +10.44% / +5.95% | +5.71% |
| TTFMF | 251.246 ms / 268.685 ms / 277.305 ms | 258.465 ms / 272.710 ms / 274.592 ms | +2.87% [-1.74%, +6.49%] | +1.50% [-5.56%, +8.25%] | -0.98% [-5.00%, +8.25%] | +6.49% / +8.25% | +8.25% |

- Wave-3 Startup gate (p50/p95 familywise upper ≤ +3%, p99 ≤ +5%): **UNCLEAR**
