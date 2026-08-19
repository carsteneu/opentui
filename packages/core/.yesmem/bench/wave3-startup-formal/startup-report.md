# Wave 3 Startup-Safety Gate (Loop B, per-arm native)

- generated: 2026-08-19T16:11:14.075Z
- baseline: `fccae2158d5c98949fc050913b918621af918111` (home/user/projects/opentui/.worktrees/wave3-baseline), native `e7e9764462f2ee7f2c808856b60101ff659c6bda4a1df7cf235e418cf481a15c`
- candidate: `b416a75d6847692eda25c63d9c870b0c3ecb36a2` (home/user/projects/opentui/.worktrees/wave3-integration), native `c5c69aaad20d06abf10e0646e7c606ac4ef70df81bc5f33ff646a5b16b9fede0`
- scenario: renderer-entry → renderer-entry; import + TTFMF (first native commit)
- Bun: 1.3.14; protocol: 30 balanced pairs, 3 warmups, 20000 bootstrap samples
- load: start 7.73/7.19/7.42; peak 7.73 (1-min); end 6.71/7/7.36; hostLoadExceeded=true
- CIs are familywise-corrected across 6 comparisons (2 metrics x p50/p95/p99), alpha=0.05: confidence 99.17% per comparison (Bonferroni-style /6).

| Metric | Baseline p50/p95/p99 | Candidate p50/p95/p99 | Paired p50 (CI) | p95 (CI) | p99 (CI) | p50/p95 budget (≤+3%) | p99 budget (≤+5%) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Import | 43.110 ms / 55.993 ms / 56.948 ms | 41.163 ms / 53.744 ms / 56.470 ms | -4.52% [-12.10%, +2.14%] | -4.02% [-21.69%, +5.88%] | -0.84% [-14.72%, +5.88%] | +2.14% / +5.88% | +5.88% |
| TTFMF | 198.823 ms / 238.776 ms / 240.481 ms | 189.444 ms / 234.731 ms / 249.833 ms | -4.72% [-11.11%, -0.97%] | -1.69% [-14.07%, +6.83%] | +3.89% [-12.85%, +6.15%] | -0.97% / +6.83% | +6.15% |

- Wave-3 Startup gate (p50/p95 familywise upper ≤ +3%, p99 ≤ +5%): **UNCLEAR**
