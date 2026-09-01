# Wave 3 Startup-Safety Gate (Loop B, per-arm native)

- generated: 2026-08-31T20:19:56.373Z
- baseline: `225e532fe0caf0fe6db3b94cb5fe1510e3341e61` (/tmp/opentui-premerge-baseline), native `acedba3878182a8b3e58c172a59df5bc448619c99e7b1da8c93d5dde6ec1d144`
- candidate: `9c10158b137ec75157d557cb21cb85311e4cfca1` (/home/chief/projects/opentui/.worktrees/fastpatchv2), native `d8473e0a9857e8aacd53c6efad0b302ccb402c987f8034aa556ed14aadab22f6`
- scenario: renderer-entry → renderer-entry; import + TTFMF (first native commit)
- Bun: 1.4.0; protocol: 12 balanced pairs, 3 warmups, 20000 bootstrap samples
- load: start 7.45/6.24/5.57; peak 7.45 (1-min); end 7.41/6.25/5.58; hostLoadExceeded=false
- CIs are familywise-corrected across 6 comparisons (2 metrics x p50/p95/p99), alpha=0.05: confidence 99.17% per comparison (Bonferroni-style /6).

| Metric | Baseline p50/p95/p99 | Candidate p50/p95/p99 | Paired p50 (CI) | p95 (CI) | p99 (CI) | p50/p95 budget (≤+3%) | p99 budget (≤+5%) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Import | 31.902 ms / 34.643 ms / 35.461 ms | 32.764 ms / 34.650 ms / 35.385 ms | +2.70% [-3.85%, +6.92%] | +0.02% [-6.99%, +6.84%] | -0.21% [-6.19%, +6.97%] | +6.92% / +6.84% | +6.97% |
| TTFMF | 44.903 ms / 49.930 ms / 52.415 ms | 45.775 ms / 49.116 ms / 49.774 ms | +1.94% [-1.30%, +8.97%] | -1.63% [-11.28%, +7.33%] | -5.04% [-11.28%, +7.33%] | +8.97% / +7.33% | +7.33% |

- Wave-3 Startup gate (p50/p95 familywise upper ≤ +3%, p99 ≤ +5%): **FAIL**
