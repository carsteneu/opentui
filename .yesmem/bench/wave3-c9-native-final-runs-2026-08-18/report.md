# Wave 3 clean-host Real-Worker Gate

- generated: 2026-08-18T16:54:23.754Z
- baseline: `fcf1cb70659c9b39b0b7d9f3168e2d894b16a0b3` (home/user/projects/opentui/.worktrees/wave3-consumer-bridge)
- candidate: `11b1fdec1d56282237bd068f798fa139a66deb19` (home/user/projects/opentui/.worktrees/wave3-textbuffer-tail)
- native policy: `per-arm`
- baseline native SHA: `e7e9764462f2ee7f2c808856b60101ff659c6bda4a1df7cf235e418cf481a15c`
- candidate native SHA: `deacf8067c0078664c30931020172bfcf2f601549816fe4a849e5d042da73804`
- Bun: 1.3.14; Node host: v24.3.0
- protocol: 30 balanced pairs, 3 fresh-process warmups/arm/scenario, 20000 bootstrap samples
- load: start 6.45/7.62/7.81; end 12.93/9.73/8.56

## Results

| Scenario            | Metric                        |                    Baseline p50/p95/p99 |                Candidate p50/p95/p99 |     Paired change (95% CI) | Familywise upper | p95 change |
| ------------------- | ----------------------------- | --------------------------------------: | -----------------------------------: | -------------------------: | ---------------: | ---------: |
| cold-1000           | update→styled native commit   | 1059.895 ms / 1454.841 ms / 1594.719 ms | 439.579 ms / 550.660 ms / 601.198 ms | -59.43% [-61.08%, -57.53%] |          -57.23% |    -62.15% |
| cold-1000           | post-run converter diagnostic |       17.747 ms / 27.587 ms / 32.474 ms |    22.861 ms / 39.144 ms / 41.815 ms | +28.86% [+17.28%, +40.96%] |              n/a |    +41.89% |
| warm-1000-append100 | update→styled native commit   |  872.224 ms / 1315.084 ms / 1387.803 ms | 105.486 ms / 167.311 ms / 175.709 ms | -87.58% [-88.58%, -86.45%] |          -86.29% |    -87.28% |
| warm-1000-append100 | post-run converter diagnostic |       15.237 ms / 20.088 ms / 21.095 ms |    16.372 ms / 30.184 ms / 33.290 ms |  +16.52% [+5.16%, +29.18%] |              n/a |    +50.26% |

## Verdict

- styled/output/chunk parity: **PASS** (all paired digests identical)
- update→styled-commit regression budget (familywise upper <= +3%): **PASS**
- update→styled-commit -30% primary wall target: **PASS**
- converter rows: **DIAGNOSTIC** — sampled after the stateful render pipeline; the isolated C3 converter gate remains authoritative.
- pure main-thread CPU -30%: **UNCLEAR** — the current production path records no stage spans; total process CPU includes worker CPU and is diagnostic only.
- overall §13.1: **UNCLEAR** until both wall and pure main-thread criteria are measurable.

Raw data: `raw.ndjson`.
