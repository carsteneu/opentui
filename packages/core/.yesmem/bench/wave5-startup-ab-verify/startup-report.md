# Wave 3 Startup-Safety Gate (Loop B, per-arm native)

- generated: 2026-08-20T12:11:31.885Z
- baseline: `13dc719306083c90040470ff401b3f29bee3dffb` (home/user/projects/opentui/.worktrees/fastpatch), native `a2709a93cfdd55a04691a5d5c93918bc37c5f8d70faf970051e22276c3e541c8`
- candidate: `c43c3bd5f855b4f93fe67f8520d10eb9c3a29785` (home/user/projects/opentui/.worktrees/wave5-startup-binding), native `553180957522fcdf2558e899e6d97562555fff238d68d62861a563040008f5cd`
- scenario: renderer-entry → renderer-entry; import + TTFMF (first native commit)
- Bun: 1.3.14; protocol: 16 balanced pairs, 1 warmups, 20000 bootstrap samples
- load: start 5.37/2.63/2.57; peak 7.92 (1-min); end 7.92/3.39/2.81; hostLoadExceeded=true
- CIs are familywise-corrected across 6 comparisons (2 metrics x p50/p95/p99), alpha=0.05: confidence 99.17% per comparison (Bonferroni-style /6).

| Metric | Baseline p50/p95/p99 | Candidate p50/p95/p99 | Paired p50 (CI) | p95 (CI) | p99 (CI) | p50/p95 budget (≤+3%) | p99 budget (≤+5%) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Import | 88.272 ms / 122.169 ms / 131.987 ms | 96.358 ms / 128.210 ms / 155.931 ms | +9.16% [-15.69%, +37.13%] | +4.94% [-24.65%, +58.31%] | +18.14% [-24.65%, +52.48%] | +37.13% / +58.31% | +52.48% |
| TTFMF | 467.161 ms / 626.610 ms / 628.054 ms | 171.891 ms / 241.803 ms / 307.571 ms | -63.21% [-68.36%, -46.44%] | -61.41% [-70.86%, -35.88%] | -51.03% [-70.55%, -36.85%] | -46.44% / -35.88% | -36.85% |

- Wave-3 Startup gate (p50/p95 familywise upper ≤ +3%, p99 ≤ +5%): **UNCLEAR**
