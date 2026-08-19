# Wave 3 Startup-Safety Gate (Loop B, per-arm native)

- generated: 2026-08-19T10:06:47.181Z
- baseline: `fccae2158d5c98949fc050913b918621af918111` (home/user/projects/opentui/.worktrees/wave3-baseline), native `e7e9764462f2ee7f2c808856b60101ff659c6bda4a1df7cf235e418cf481a15c`
- candidate: `11b1fdec1d56282237bd068f798fa139a66deb19` (home/user/projects/opentui/.worktrees/wave3-textbuffer-tail), native `deacf8067c0078664c30931020172bfcf2f601549816fe4a849e5d042da73804`
- scenario: renderer-entry → renderer-entry; import + TTFMF (first native commit)
- Bun: 1.3.14; protocol: 2 balanced pairs, 0 warmups, 1000 bootstrap samples
- load: start 6.19/7.69/7.49; end 6.19/7.69/7.49; hostLoadExceeded=true

| Metric | Baseline p50/p95/p99 | Candidate p50/p95/p99 | Paired p50 (CI) | p95 (CI) | p99 (CI) | p50/p95 budget (≤+3%) | p99 budget (≤+5%) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Import | 39.799 ms / 42.324 ms / 42.548 ms | 38.414 ms / 39.282 ms / 39.360 ms | -3.48% [-3.48%, -3.48%] | -7.19% [-7.19%, -7.19%] | -7.49% [-7.49%, -7.49%] | -3.48% / -7.19% | -7.49% |
| TTFMF | 159.049 ms / 163.519 ms / 163.916 ms | 161.223 ms / 162.164 ms / 162.247 ms | +1.37% [+1.37%, +1.37%] | -0.83% [-0.83%, -0.83%] | -1.02% [-1.02%, -1.02%] | +1.37% / -0.83% | -1.02% |

- Wave-3 Startup gate (p50/p95 familywise upper ≤ +3%, p99 ≤ +5%): **UNCLEAR**
