# Wave 3 clean-host Real-Worker Gate

> **Korrektur 2026-08-18:** `warm-1000-append100` änderte in diesem Lauf bei jedem Update die erste Zeile und war
> deshalb ein Full-Replacement-/Coalescing-Workload, kein monotoner Append. Seine Zahlen sind für Append-Claims
> ungültig. `cold-1000`, die Rohdaten und die Funktionsparität bleiben gültig; siehe `validity.md`.

- generated: 2026-08-18T13:03:04.959Z
- baseline: `6ec90b97d72606fc98761417304c8039048bbc06` (home/user/projects/opentui/.worktrees/wave3-clean-candidate)
- candidate: `8655d4c2d0abf33556b498727e9b6306a74fd5cc` (home/user/projects/opentui/.worktrees/wave3-bridge-candidate)
- native SHA: `e7e9764462f2ee7f2c808856b60101ff659c6bda4a1df7cf235e418cf481a15c`
- Bun: 1.3.14; Node host: v24.3.0
- protocol: 30 balanced pairs, 3 fresh-process warmups/arm/scenario, 20000 bootstrap samples
- load: start 10.37/11.27/11.08; end 10.98/11.39/11.28

## Results

| Scenario            | Metric                      |                   Baseline p50/p95/p99 |                   Candidate p50/p95/p99 |   Paired change (95% CI) | Familywise upper | p95 change |
| ------------------- | --------------------------- | -------------------------------------: | --------------------------------------: | -----------------------: | ---------------: | ---------: |
| cold-1000           | update→styled native commit | 988.639 ms / 1789.705 ms / 1938.722 ms | 1061.850 ms / 1652.518 ms / 1767.177 ms |  +0.07% [-6.61%, +7.08%] |           +7.96% |     -7.67% |
| cold-1000           | converter                   |      16.131 ms / 38.417 ms / 40.623 ms |       19.771 ms / 31.890 ms / 35.718 ms | +9.23% [-6.23%, +25.92%] |              n/a |    -16.99% |
| warm-1000-append100 | update→styled native commit | 841.248 ms / 1449.878 ms / 1583.953 ms |  847.063 ms / 1207.039 ms / 1328.810 ms | -1.37% [-10.12%, +7.48%] |           +8.58% |    -16.75% |
| warm-1000-append100 | converter                   |      12.406 ms / 31.322 ms / 37.243 ms |       13.400 ms / 23.130 ms / 33.577 ms | +1.75% [-7.52%, +12.09%] |              n/a |    -26.15% |

## Verdict

- styled/output/chunk parity: **PASS** (all paired digests identical)
- update→styled-commit regression budget (familywise upper <= +3%): **FAIL**
- update→styled-commit -30% primary wall target: **FAIL**
- pure main-thread CPU -30%: **UNCLEAR** — the current production path records no stage spans; total process CPU includes worker CPU and is diagnostic only.
- overall §13.1: **FAIL/UNCLEAR** until both wall and pure main-thread criteria are measurable.

Raw data: `raw.ndjson`.
