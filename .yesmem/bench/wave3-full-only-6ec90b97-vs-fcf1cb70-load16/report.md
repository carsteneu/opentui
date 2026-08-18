# Wave 3 clean-host Real-Worker Gate

> **Korrektur 2026-08-18:** `warm-1000-append100` änderte in diesem Lauf bei jedem Update die erste Zeile und war
> deshalb ein Full-Replacement-/Coalescing-Workload, kein monotoner Append. Seine Zahlen sind für Append-Claims
> ungültig. `cold-1000`, die Rohdaten und die Funktionsparität bleiben gültig; siehe `validity.md`.

- generated: 2026-08-18T13:15:20.518Z
- baseline: `6ec90b97d72606fc98761417304c8039048bbc06` (home/user/projects/opentui/.worktrees/wave3-clean-candidate)
- candidate: `fcf1cb70659c9b39b0b7d9f3168e2d894b16a0b3` (home/user/projects/opentui/.worktrees/wave3-consumer-bridge)
- native SHA: `e7e9764462f2ee7f2c808856b60101ff659c6bda4a1df7cf235e418cf481a15c`
- Bun: 1.3.14; Node host: v24.3.0
- protocol: 30 balanced pairs, 3 fresh-process warmups/arm/scenario, 20000 bootstrap samples
- load: start 7.3/10.36/11.05; end 12.73/10.83/11

## Results

| Scenario            | Metric                      |                    Baseline p50/p95/p99 |                  Candidate p50/p95/p99 |    Paired change (95% CI) | Familywise upper | p95 change |
| ------------------- | --------------------------- | --------------------------------------: | -------------------------------------: | ------------------------: | ---------------: | ---------: |
| cold-1000           | update→styled native commit | 1043.302 ms / 1570.636 ms / 1721.614 ms | 986.464 ms / 1587.474 ms / 1659.801 ms |   -0.22% [-7.06%, +7.39%] |           +8.44% |     +1.07% |
| cold-1000           | converter                   |       14.280 ms / 32.311 ms / 43.975 ms |      14.962 ms / 38.971 ms / 42.834 ms |  +1.46% [-9.21%, +13.48%] |              n/a |    +20.61% |
| warm-1000-append100 | update→styled native commit |  822.984 ms / 1344.939 ms / 1385.685 ms | 822.245 ms / 1272.265 ms / 1409.539 ms |  -2.27% [-12.25%, +8.21%] |           +9.54% |     -5.40% |
| warm-1000-append100 | converter                   |       12.582 ms / 34.021 ms / 35.721 ms |      12.791 ms / 32.324 ms / 36.423 ms | -5.02% [-20.10%, +12.23%] |              n/a |     -4.99% |

## Verdict

- styled/output/chunk parity: **PASS** (all paired digests identical)
- update→styled-commit regression budget (familywise upper <= +3%): **FAIL**
- update→styled-commit -30% primary wall target: **FAIL**
- pure main-thread CPU -30%: **UNCLEAR** — the current production path records no stage spans; total process CPU includes worker CPU and is diagnostic only.
- overall §13.1: **FAIL/UNCLEAR** until both wall and pure main-thread criteria are measurable.

Raw data: `raw.ndjson`.
