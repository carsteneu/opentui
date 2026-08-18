# Wave 3 clean-host Real-Worker Gate

- generated: 2026-08-18T12:10:10.736Z
- baseline: `fccae2158d5c98949fc050913b918621af918111` (home/user/projects/opentui/.worktrees/wave3-clean-baseline)
- candidate: `6ec90b97d72606fc98761417304c8039048bbc06` (home/user/projects/opentui/.worktrees/wave3-clean-candidate)
- native SHA: `e7e9764462f2ee7f2c808856b60101ff659c6bda4a1df7cf235e418cf481a15c`
- Bun: 1.3.14; Node host: v24.3.0
- protocol: 30 balanced pairs, 3 fresh-process warmups/arm/scenario, 20000 bootstrap samples
- load: start 7.59/7.81/8.86; end 15.28/14.06/11.62

## Results

| Scenario | Metric | Baseline p50/p95/p99 | Candidate p50/p95/p99 | Paired change (95% CI) | Familywise upper | p95 change |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| cold-1000 | update→styled native commit | 1704.186 ms / 2643.493 ms / 2697.858 ms | 1545.473 ms / 2992.592 ms / 3094.009 ms | -0.02% [-6.68%, +6.68%] | +7.69% | +13.21% |
| cold-1000 | converter | 32.643 ms / 66.322 ms / 76.013 ms | 32.317 ms / 61.408 ms / 74.755 ms | -4.92% [-19.08%, +11.52%] | n/a | -7.41% |
| warm-1000-append100 | update→styled native commit | 1473.736 ms / 2274.566 ms / 2436.154 ms | 1464.943 ms / 2162.783 ms / 2187.999 ms | +0.34% [-8.73%, +10.94%] | +12.48% | -4.91% |
| warm-1000-append100 | converter | 32.726 ms / 52.628 ms / 85.676 ms | 29.956 ms / 53.086 ms / 55.880 ms | -12.64% [-25.88%, +2.53%] | n/a | +0.87% |

## Verdict

- styled/output/chunk parity: **PASS** (all paired digests identical)
- update→styled-commit regression budget (familywise upper <= +3%): **FAIL**
- update→styled-commit -30% primary wall target: **FAIL**
- pure main-thread CPU -30%: **UNCLEAR** — the current production path records no stage spans; total process CPU includes worker CPU and is diagnostic only.
- overall §13.1: **FAIL/UNCLEAR** until both wall and pure main-thread criteria are measurable.

Raw data: `raw.ndjson`.
